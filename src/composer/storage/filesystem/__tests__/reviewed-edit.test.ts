import { fork } from "node:child_process";
import { mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureDocument } from "../../../__tests__/fixtures";
import type { CompositionRecord } from "../../../library";
import { createFilesystemCompositionStore, type FilesystemCompositionStoreOptions } from "../index";
import { COMMIT_UNCERTAIN, createTransactionalRecordStore, MutationBarrierError, withMutationBarrier } from "../../../../shared/node-fs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const record = (): CompositionRecord => ({ id: "a", createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:05.000Z", document: { ...createFixtureDocument(), id: "a" } });
async function setup(operations?: FilesystemCompositionStoreOptions["operations"]) {
  const root = await mkdtemp(join(tmpdir(), "reviewed-composition-")); roots.push(root);
  const store = await createFilesystemCompositionStore({ compositionsRoot: root, provideJsx: () => "old JSX", operations });
  await store.put(record(), "old JSX");
  const candidate = record(); candidate.updatedAt = "2026-01-03T03:04:05.000Z";
  const input = { operationId: "edit-one", planDigest: "a".repeat(64), expectedSnapshotToken: await store.mutationToken(), changes: [{ candidate, jsx: "new JSX" }], receipt: { changed: "a", operationId: "edit-one" } };
  return { root, store, input };
}
describe("reviewed Composition transactions", () => {
  it("commits exact pair and durable receipt, retries idempotently and rejects reused identity", async () => {
    const { root, store, input } = await setup();
    expect(await store.commitReviewedEdit(input)).toEqual(input.receipt);
    expect(JSON.parse(await readFile(join(root, "composition-a.composition.json"), "utf8"))).toEqual(input.changes[0]!.candidate);
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe(input.changes[0]!.jsx);
    expect(await store.reviewedEditReceipt(input.operationId)).toEqual(input.receipt);
    expect(await store.commitReviewedEdit(input, async () => { throw new Error("must not repeat checks after commit"); })).toEqual(input.receipt);
    await expect(store.commitReviewedEdit({ ...input, planDigest: "b".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects stale preconditions and recheck failures before any pair or receipt write", async () => {
    const { root, store, input } = await setup();
    await expect(store.commitReviewedEdit({ ...input, expectedSnapshotToken: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.commitReviewedEdit(input, async () => { throw new Error("dependency changed"); })).rejects.toThrow("dependency changed");
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe("old JSX");
    expect(await store.reviewedEditReceipt(input.operationId)).toBeUndefined();
  });
  it("rolls forward interrupted pair before exposing a snapshot after explicit lock recovery", async () => {
    let armed = false;
    const { root, store, input } = await setup({ rename: async (from, to) => {
      if (armed && to.endsWith("composition-a.tsx")) throw new Error("injected derived rename failure");
      return rename(from, to);
    } });
    armed = true;
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "commit-uncertain", operationId: input.operationId });
    await expect(store.snapshot()).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe("old JSX");
    armed = false;
    // Explicit operator recovery, after this test has proved no writer remains.
    await unlink(join(root, ".mutation.lock"));
    expect((await store.snapshot()).records).toEqual([input.changes[0]!.candidate]);
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe(input.changes[0]!.jsx);
    expect(await store.reviewedEditReceipt(input.operationId)).toEqual(input.receipt);
    await expect(readFile(join(root, ".reviewed-edit-journal.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("leaves old pair intact when preparation fails, and recovers a lost receipt write", async () => {
    let failedDestination = "";
    const { root, store, input } = await setup({ rename: async (from, to) => {
      if (failedDestination && to.endsWith(failedDestination)) throw new Error("injected rename failure");
      return rename(from, to);
    } });
    failedDestination = ".reviewed-edit-journal.json";
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "write-failed" });
    expect((await store.snapshot()).records).toEqual([record()]);
    expect(await store.reviewedEditReceipt(input.operationId)).toBeUndefined();
    failedDestination = ".receipt.json";
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "commit-uncertain" });
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe(input.changes[0]!.jsx);
    failedDestination = "";
    await unlink(join(root, ".mutation.lock"));
    expect(await store.reviewedEditReceipt(input.operationId)).toEqual(input.receipt);
  });

  it("retains durable intent when the canonical directory fsync is uncertain", async () => {
    let armed = false;
    let failSync = false;
    const { root, store, input } = await setup({
      rename: async (from, to) => {
        await rename(from, to);
        if (armed && to.endsWith("composition-a.composition.json")) failSync = true;
      },
      open: async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return new Proxy(handle, { get(target, key) {
          if (key === "sync") return async () => { if (failSync) { failSync = false; throw new Error("directory durability unknown"); } await target.sync(); };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      },
    });
    armed = true;
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "commit-uncertain" });
    await expect(store.snapshot()).rejects.toMatchObject({ code: "conflict" });
    armed = false;
    await unlink(join(root, ".mutation.lock"));
    expect(await store.reviewedEditReceipt(input.operationId)).toEqual(input.receipt);
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe(input.changes[0]!.jsx);
  });

  it("publishes several pages under one journal: interruption between pages rolls every page forward or none", async () => {
    let armed = false;
    const root = await mkdtemp(join(tmpdir(), "reviewed-multi-")); roots.push(root);
    const store = await createFilesystemCompositionStore({ compositionsRoot: root, provideJsx: () => "old JSX", operations: { rename: async (from, to) => {
      if (armed && to.endsWith("composition-b.composition.json")) throw new Error("crash between pages");
      return rename(from, to);
    } } });
    const b = { ...record(), id: "b", document: { ...createFixtureDocument(), id: "b" } };
    await store.put(record(), "old JSX"); await store.put(b, "old JSX b");
    const nextA = { ...record(), updatedAt: "2026-02-01T00:00:00.000Z" }, nextB = { ...b, updatedAt: "2026-02-01T00:00:00.000Z" };
    const input = { operationId: "draft-apply", planDigest: "c".repeat(64), expectedSnapshotToken: await store.mutationToken(), changes: [{ candidate: nextA, jsx: "new A" }, { candidate: nextB, jsx: "new B" }], receipt: { pages: ["a", "b"] } };
    armed = true;
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "commit-uncertain", operationId: "draft-apply" });
    // Page A is already published, page B is not: readers must not observe this split.
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe("new A");
    expect(await readFile(join(root, "composition-b.tsx"), "utf8")).toBe("old JSX b");
    await expect(store.snapshot()).rejects.toMatchObject({ code: "conflict" });
    armed = false;
    await unlink(join(root, ".mutation.lock"));
    expect((await store.snapshot()).records).toEqual([nextA, nextB]);
    expect(await readFile(join(root, "composition-b.tsx"), "utf8")).toBe("new B");
    expect(await store.reviewedEditReceipt("draft-apply")).toEqual({ pages: ["a", "b"] });
    expect(await store.commitReviewedEdit(input)).toEqual({ pages: ["a", "b"] });
  });
  it("rejects duplicate or empty multi-page change sets before preparing intent", async () => {
    const { root, store, input } = await setup();
    await expect(store.commitReviewedEdit({ ...input, changes: [] })).rejects.toMatchObject({ code: "validation" });
    await expect(store.commitReviewedEdit({ ...input, changes: [input.changes[0]!, input.changes[0]!] })).rejects.toMatchObject({ code: "validation" });
    await expect(readFile(join(root, ".reviewed-edit-journal.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves unexpected destination edits during recovery", async () => {
    let armed = false;
    const { root, store, input } = await setup({ rename: async (from, to) => {
      if (armed && to.endsWith("composition-a.tsx")) throw new Error("interrupted");
      return rename(from, to);
    } });
    armed = true;
    await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "commit-uncertain" });
    await writeFile(join(root, "composition-a.tsx"), "unexpected external bytes");
    await unlink(join(root, ".mutation.lock")); armed = false;
    await expect(store.snapshot()).rejects.toMatchObject({ code: "commit-uncertain" });
    expect(await readFile(join(root, "composition-a.tsx"), "utf8")).toBe("unexpected external bytes");
  });
  it("refuses another process holding the same writer lock and never steals it", async () => {
    const { root, store, input } = await setup();
    const child = fork("", [], { execArgv: ["--input-type=commonjs", "-e", `const fs=require('node:fs');const p=process.argv[1];fs.writeFileSync(p,'held',{flag:'wx'});process.send('held');process.on('message',()=>{fs.unlinkSync(p);process.exit(0)});`, join(root, ".mutation.lock")], silent: true });
    try {
      await new Promise<void>((resolve, reject) => { child.once("message", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
      await expect(store.commitReviewedEdit(input)).rejects.toMatchObject({ code: "conflict" });
      await expect(store.put(input.changes[0]!.candidate)).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(join(root, ".mutation.lock"), "utf8")).toBe("held");
    } finally { child.send("release"); await new Promise<void>(resolve => child.once("exit", () => resolve())); }
  });
  it("dependency barrier leaves read queue available while rejecting writers", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewed-barrier-")); roots.push(root);
    const records = await createTransactionalRecordStore({
      root, schemaVersion: 1, rootLabel: "Dependency", ownerLabel: "Dependency", recordLabel: "record",
      phases: { initialize: "initialize", snapshot: "snapshot", commit: "commit" },
      errors: {
        isError: value => value instanceof MutationBarrierError,
        create: (_op, code, message, cause) => new MutationBarrierError(code, message, cause),
        rethrow: (_op, code, message, cause): never => { if (cause instanceof MutationBarrierError) throw cause; throw new MutationBarrierError(code, message, cause); },
      },
    });
    await records.commit(() => ({ records: [{ id: "one", json: "{}" }], result: undefined }));
    await withMutationBarrier(root, async () => {
      expect((await records.snapshot()).records).toEqual([{ id: "one", json: "{}" }]);
      await expect(records.commit(() => ({ records: [], result: undefined }))).rejects.toMatchObject({ code: "conflict" });
      await expect(withMutationBarrier(root, async () => undefined)).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(join(root, ".mutation.lock"), "utf8")).toContain("pid");
    });
    await withMutationBarrier(root, async () => undefined);
    await expect(withMutationBarrier(root, async () => {
      throw Object.assign(new Error("downstream commit uncertain"), { [COMMIT_UNCERTAIN]: true });
    })).rejects.toThrow("downstream commit uncertain");
    // This domain was never mutated; only the downstream writer retains its lock.
    await withMutationBarrier(root, async () => undefined);
  });
});
