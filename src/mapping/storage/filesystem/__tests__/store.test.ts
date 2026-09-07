// The Mapping provider contract, exercised against the filesystem store. See
// `src/mapping/__tests__/mapping.test.ts`. Assertions are ported from there
// wherever the concept survives the move (CRUD, idempotent seed, quarantine,
// immutable createdAt); the tests that follow them cover what only a
// filesystem store can get wrong.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMappingRecord } from "../../../model";
import type { MappingRecord } from "../../../model";
import { createTransactionalRecordStore } from "../../../../shared/node-fs";
import { createFilesystemMappingStore, FilesystemMappingStore } from "../store";
import { MAPPING_FILESYSTEM_LAYOUT, MAPPING_META_RECORD_ID } from "../types";

const stamp = "2026-01-01T00:00:00.000Z";

function mapping(id: string, name = id): MappingRecord {
  return createMappingRecord({
    id,
    name,
    contentModel: { providerId: "content", recordId: "articles" },
    composition: { providerId: "files", recordId: "landing" },
    createdAt: stamp,
  });
}

const sandboxes: string[] = [];

async function sandbox(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-mapping-fs-")));
  sandboxes.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function setup(): Promise<{ root: string; store: FilesystemMappingStore }> {
  const root = await sandbox();
  const store = await createFilesystemMappingStore({ mappingsRoot: root });
  return { root, store };
}

async function pointer(root: string): Promise<{ generation: number }> {
  return JSON.parse(await fs.readFile(join(root, "current.json"), "utf8")) as { generation: number };
}

async function liveRecordFiles(root: string): Promise<string[]> {
  return (await fs.readdir(join(root, "generations", String((await pointer(root)).generation)))).sort();
}

/** Commit one record through the record store, bypassing every Mapping rule. */
async function importRecord(root: string, id: string, value: unknown): Promise<void> {
  const records = await createTransactionalRecordStore<"initialize" | "list" | "transact">({
    root,
    schemaVersion: 1,
    errors: {
      isError: (candidate: unknown) => candidate instanceof Error,
      create: (_operation, code, message) => Object.assign(new Error(message), { code }),
      rethrow: (_operation, code, message, cause): never => { throw Object.assign(new Error(message), { code, cause }); },
    },
    rootLabel: "Mapping records root",
    ownerLabel: "Mapping",
    recordLabel: "mapping record",
    phases: { initialize: "initialize", snapshot: "list", commit: "transact" },
  });
  await records.commit((before) => ({
    records: [
      ...before.records.filter((record) => record.id !== id),
      { id, json: `${JSON.stringify(value, null, 2)}\n` },
    ],
    result: null,
  }));
}

describe("Mapping filesystem store", () => {
  it("supports CRUD, deterministic idempotent seed, and startFresh reseeding", async () => {
    const { store } = await setup();
    const seeded = mapping("article-landing");
    expect(await store.initialize()).toEqual({ status: "ready", summaries: [] });
    await store.seed({ mappings: [seeded] });
    expect(await store.initialize()).toMatchObject({ status: "ready", summaries: [{ id: seeded.id }] });

    await store.seed({ mappings: [{ ...seeded, document: { ...seeded.document, name: "Changed" } }] });
    expect(await store.get(seeded.id)).toMatchObject({ status: "loaded", record: { document: { name: "article-landing" } } });

    await store.put({ ...seeded, updatedAt: "2026-01-02T00:00:00.000Z", document: { ...seeded.document, name: "Updated" } });
    expect(await store.list()).toMatchObject([{ name: "Updated" }]);

    expect(await store.delete(seeded.id)).toBe(true);
    expect(await store.delete(seeded.id)).toBe(false);

    await store.put(seeded);
    expect(await store.startFresh()).toEqual({ status: "ready", summaries: [] });
  });

  it("keeps createdAt immutable on update", async () => {
    const { store } = await setup();
    const record = mapping("article-landing");
    await store.put(record);
    await expect(store.put({ ...record, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }))
      .rejects.toMatchObject({ code: "validation", retryable: false });
  });

  it("rejects duplicate seed ids before any record write", async () => {
    const { root, store } = await setup();
    const duplicate = mapping("duplicate");
    await expect(store.seed({ mappings: [duplicate, duplicate] })).rejects.toMatchObject({ code: "validation" });
    expect(await liveRecordFiles(root)).toEqual(["meta.json"]);
  });

  it("reserves the metadata record id for storage", async () => {
    const { store } = await setup();
    await expect(store.put(mapping("meta"))).rejects.toMatchObject({ code: "validation" });
  });

  it("quarantines malformed/future records until explicit startFresh", async () => {
    const { root, store } = await setup();
    await store.put(mapping("kept"));
    await importRecord(root, "bad", { id: "bad", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 999 } });

    const recovery = await store.initialize();
    expect(recovery).toMatchObject({
      status: "recovery-required",
      summaries: [{ id: "kept" }],
      recovery: { reason: "future-schema", sourcePreserved: true, affectedRecordIds: ["bad"] },
    });
    await expect(store.list()).rejects.toMatchObject({ code: "validation" });
    await expect(store.put(mapping("kept"))).rejects.toMatchObject({ code: "validation" });
    await expect(store.delete("kept")).rejects.toMatchObject({ code: "validation" });
    await expect(store.clear()).rejects.toMatchObject({ code: "validation" });

    expect(await store.startFresh()).toEqual({ status: "ready", summaries: [] });
  });

  it("revalidates every read and reports invalid records without discarding them", async () => {
    const { root, store } = await setup();
    await importRecord(root, "invalid", { id: "invalid", createdAt: stamp, updatedAt: "not-a-date", document: {} });
    expect(await store.get("invalid")).toMatchObject({ status: "invalid" });
  });
});

describe("Mapping filesystem layout and stale-token rejection", () => {
  it("refuses a store whose layout marker does not match, and re-shapes nothing", async () => {
    const { root, store } = await setup();
    await store.put(mapping("kept"));
    await importRecord(root, MAPPING_META_RECORD_ID, { layout: { ...MAPPING_FILESYSTEM_LAYOUT, layoutVersion: 2 } });

    await expect(createFilesystemMappingStore({ mappingsRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
    await expect(store.list()).rejects.toMatchObject({ code: "unsupported-version" });
    expect(await liveRecordFiles(root)).toEqual(["kept.json", "meta.json"]);
  });

  it("refuses a store with records but no layout marker at all", async () => {
    const root = await sandbox();
    // Bypass the store entirely: write a record directly without ever
    // stamping the marker, unlike every path that goes through `open()`.
    await importRecord(root, "stray", { id: "stray" });
    await expect(createFilesystemMappingStore({ mappingsRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
  });

  it("rejects a stale mutation token in a batch and leaves the store untouched", async () => {
    const { root, store } = await setup();
    const stale = await store.snapshot();
    await store.put(mapping("a"));
    const current = await store.snapshot();
    const generation = (await pointer(root)).generation;

    await expect(store.applyTransaction({
      expectedMutationToken: stale.mutationToken,
      steps: [{ operation: "delete", payload: { id: "a" } }],
    })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.snapshot()).toEqual(current);
    expect((await pointer(root)).generation).toBe(generation);
  });

  it("applies every step of a batch atomically", async () => {
    const { store } = await setup();
    await store.put(mapping("a"));
    const before = await store.snapshot();

    const result = await store.applyTransaction({
      expectedMutationToken: before.mutationToken,
      steps: [
        { operation: "put", payload: { record: mapping("b") } },
        { operation: "delete", payload: { id: "a" } },
      ],
    });
    expect(result.records.map((record) => record.id)).toEqual(["b"]);
    expect((await store.readAll()).map((record) => record.id)).toEqual(["b"]);
  });

  it("rolls back the whole batch when one step is invalid", async () => {
    const { store } = await setup();
    await store.put(mapping("a"));
    const before = await store.snapshot();

    await expect(store.applyTransaction({
      expectedMutationToken: before.mutationToken,
      steps: [
        { operation: "delete", payload: { id: "a" } },
        { operation: "put", payload: { record: { ...mapping("b"), id: "meta" } } },
      ],
    })).rejects.toMatchObject({ code: "validation" });
    expect(await store.snapshot()).toEqual(before);
  });

  it("detects a concurrent write across independent store handles", async () => {
    const { root, store } = await setup();
    const other = await createFilesystemMappingStore({ mappingsRoot: root });
    const captured = await store.snapshot();

    await other.put(mapping("new"));
    const observed = await store.snapshot();
    expect(observed.mutationToken).not.toBe(captured.mutationToken);
    expect(observed.records).toHaveLength(1);
  });
});
