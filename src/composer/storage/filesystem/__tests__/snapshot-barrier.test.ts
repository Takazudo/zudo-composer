import { mkdtemp, readFile, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { createFixtureDocument } from "../../../__tests__/fixtures";
import { createFilesystemCompositionStore } from "../index";
import { COMMIT_UNCERTAIN, withMutationBarrier } from "../../../../shared/node-fs";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(operations?: Parameters<typeof createFilesystemCompositionStore>[0]["operations"]) {
  const root = await mkdtemp(join(tmpdir(), "composition-read-barrier-")); roots.push(root);
  const store = await createFilesystemCompositionStore({ compositionsRoot: root, provideJsx: () => "jsx", operations });
  const record = { id: "a", createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:05.000Z", document: { ...createFixtureDocument(), id: "a" } };
  await store.put(record, "jsx");
  return { root, store, record };
}
it("holds an exact detached snapshot and excludes foreign writers until callback finishes", async () => {
  const { root, store, record } = await fixture();
  const before = await store.snapshot();
  await store.withSnapshotBarrier(async snapshot => {
    expect(snapshot).toEqual(before);
    await expect(withMutationBarrier(root, async () => undefined)).rejects.toThrow();
    snapshot.records[0]!.document.name = "callback-only";
  });
  expect((await store.snapshot()).records).toEqual([record]);
  await withMutationBarrier(root, async () => undefined);
});
it("releases its read-only Composition lock even when a foreign commit is uncertain", async () => {
  const { root, store } = await fixture();
  const error = Object.assign(new Error("Content response lost"), { [COMMIT_UNCERTAIN]: true });
  await expect(store.withSnapshotBarrier(async () => { throw error; })).rejects.toBe(error);
  await expect(readFile(join(root, ".mutation.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(store.snapshot()).resolves.toHaveProperty("mutationToken");
});
it("retains the lock if Composition journal recovery itself becomes uncertain before callback", async () => {
  let armed = false;
  const { root, store, record } = await fixture({ rename: async (from, to) => {
    if (armed && to.endsWith("composition-a.tsx")) throw new Error("derived file failure");
    return rename(from, to);
  } });
  const expectedSnapshotToken = await store.mutationToken(); armed = true;
  await expect(store.commitReviewedEdit({ operationId: "barrier-proof", planDigest: "a".repeat(64), expectedSnapshotToken,
    changes: [{ candidate: { ...record, updatedAt: "2026-01-03T00:00:00.000Z" }, jsx: "next" }], receipt: { ok: true } })).rejects.toMatchObject({ code: "commit-uncertain" });
  // Explicit disposable-fixture recovery; no writer remains.
  await unlink(join(root, ".mutation.lock"));
  let invoked = false;
  await expect(store.withSnapshotBarrier(async () => { invoked = true; })).rejects.toThrow();
  expect(invoked).toBe(false);
  await expect(readFile(join(root, ".mutation.lock"))).resolves.toBeDefined();
});
