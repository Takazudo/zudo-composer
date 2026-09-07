// The Sitemap provider contract, exercised against the filesystem store.
// Assertions are ported from there wherever the concept survives the move
// (CRUD, seed, duplicate-seed rejection, revalidate-every-read, quarantine);
// the tests that follow them cover what only a filesystem store can get wrong.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SITEMAP_SCHEMA_VERSION } from "../../../model";
import type { SitemapRecord } from "../../../library";
import { createTransactionalRecordStore } from "../../../../shared/node-fs";
import { createFilesystemSitemapStore, FilesystemSitemapStore } from "../store";
import { SITEMAP_FILESYSTEM_LAYOUT, SITEMAP_META_RECORD_ID } from "../types";

const stamp = "2026-01-01T00:00:00.000Z";

function record(id: string, updatedAt = stamp): SitemapRecord {
  return {
    id,
    createdAt: stamp,
    updatedAt,
    document: {
      schemaVersion: SITEMAP_SCHEMA_VERSION,
      navigation: { primary: [], footer: [] },
      id,
      name: id,
      root: [{ id: `${id}-home`, title: "Home", source: { kind: "unassigned" }, children: [] }],
    },
  };
}

const sandboxes: string[] = [];

async function sandbox(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-sitemap-fs-")));
  sandboxes.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function setup(): Promise<{ root: string; store: FilesystemSitemapStore }> {
  const root = await sandbox();
  const store = await createFilesystemSitemapStore({ sitemapsRoot: root });
  return { root, store };
}

async function pointer(root: string): Promise<{ generation: number }> {
  return JSON.parse(await fs.readFile(join(root, "current.json"), "utf8")) as { generation: number };
}

async function liveRecordFiles(root: string): Promise<string[]> {
  return (await fs.readdir(join(root, "generations", String((await pointer(root)).generation)))).sort();
}

/** Commit one record through the record store, bypassing every Sitemapper rule. */
async function importRecord(root: string, id: string, value: unknown): Promise<void> {
  const records = await createTransactionalRecordStore<"initialize" | "list" | "transact">({
    root,
    schemaVersion: 1,
    errors: {
      isError: (candidate: unknown) => candidate instanceof Error,
      create: (_operation, code, message) => Object.assign(new Error(message), { code }),
      rethrow: (_operation, code, message, cause): never => { throw Object.assign(new Error(message), { code, cause }); },
    },
    rootLabel: "Sitemap records root",
    ownerLabel: "Sitemap",
    recordLabel: "sitemap record",
    phases: { initialize: "initialize", snapshot: "list", commit: "transact" },
  });
  await records.commit((before) => ({
    records: [
      ...before.records.filter((entry) => entry.id !== id),
      { id, json: `${JSON.stringify(value, null, 2)}\n` },
    ],
    result: null,
  }));
}

describe("Sitemap filesystem store", () => {
  it("seeds multiple records atomically, preserves edits, and snapshots the collection", async () => {
    const { store } = await setup();
    await store.seed([record("alpha"), record("beta")]);
    expect(await store.initialize()).toMatchObject({ status: "ready", summaries: expect.any(Array) });
    await store.put({ ...record("alpha", "2026-01-02T00:00:00.000Z"), document: { ...record("alpha").document, name: "edited" } });
    await store.seed([record("alpha"), record("beta")]);
    expect((await store.readAll()).find(({ id }) => id === "alpha")!.document.name).toBe("edited");
  });

  it("rejects duplicate seed ids before any record write", async () => {
    const { root, store } = await setup();
    const duplicate = record("duplicate");
    await expect(store.seed([duplicate, duplicate])).rejects.toMatchObject({ code: "validation" });
    expect(await liveRecordFiles(root)).toEqual(["meta.json"]);
  });

  it("reserves the metadata record id for storage", async () => {
    const { store } = await setup();
    await expect(store.put(record("meta"))).rejects.toMatchObject({ code: "validation" });
  });

  it("supports create, read, update, duplicate, delete, and clear", async () => {
    const { store } = await setup();
    await store.put(record("alpha"));
    expect(await store.get("alpha")).toMatchObject({ status: "loaded" });

    await store.put({ ...record("alpha", "2026-01-03T00:00:00.000Z"), document: { ...record("alpha").document, name: "updated" } });
    expect(await store.get("alpha")).toMatchObject({ status: "loaded", record: { updatedAt: "2026-01-03T00:00:00.000Z", document: { name: "updated" } } });

    await store.put(record("copy", "2026-01-02T00:00:00.000Z"));
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: "alpha", pageCount: 1 }),
      expect.objectContaining({ id: "copy", pageCount: 1 }),
    ]);
    expect(await store.delete("missing")).toBe(false);
    expect(await store.delete("alpha")).toBe(true);
    expect(await store.get("alpha")).toEqual({ status: "not-found", id: "alpha" });
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("revalidates every read and returns invalid/future-schema outcomes", async () => {
    const { root, store } = await setup();
    const invalid = { ...record("invalid"), updatedAt: "not-a-date" };
    await importRecord(root, "invalid", invalid);
    expect(await store.get("invalid")).toEqual({
      status: "invalid",
      issue: expect.objectContaining({ code: "invalid-updated-at" }),
      raw: invalid,
    });

    const future = { ...record("future"), document: { ...record("future").document, schemaVersion: SITEMAP_SCHEMA_VERSION + 1 } };
    await importRecord(root, "future", future);
    expect(await store.get("future")).toEqual({
      status: "future-schema",
      foundSchemaVersion: SITEMAP_SCHEMA_VERSION + 1,
      raw: future,
    });
    await expect(store.list()).rejects.toMatchObject({ name: "SitemapPersistenceError", operation: "list", code: "validation", retryable: false });
  });

  it("returns recovery-aware initialize/startFresh outcomes with summaries", async () => {
    const { root, store } = await setup();
    await store.put(record("valid"));
    const future = { ...record("future"), document: { ...record("future").document, schemaVersion: SITEMAP_SCHEMA_VERSION + 1 } };
    await importRecord(root, "future", future);

    expect(await store.initialize()).toMatchObject({
      status: "recovery-required",
      summaries: [expect.objectContaining({ id: "valid" })],
      recovery: { reason: "future-schema", sourcePreserved: true, affectedRecordIds: ["future"] },
    });
    expect(await store.startFresh()).toMatchObject({ status: "ready", summaries: [] });
    expect(await store.list()).toEqual([]);
  });

  it("quarantines invalid records until explicit startFresh, rejecting every mutation meanwhile", async () => {
    const { root, store } = await setup();
    await store.put(record("kept"));
    await importRecord(root, "bad", { ...record("bad"), updatedAt: "not-a-date" });

    await expect(store.list()).rejects.toMatchObject({ code: "validation" });
    await expect(store.put(record("kept"))).rejects.toMatchObject({ code: "validation" });
    await expect(store.delete("kept")).rejects.toMatchObject({ code: "validation" });
    await expect(store.clear()).rejects.toMatchObject({ code: "validation" });

    expect(await store.startFresh()).toEqual({ status: "ready", summaries: [] });
  });
});

describe("Sitemap filesystem layout and stale-token rejection", () => {
  it("refuses a store whose layout marker does not match, and re-shapes nothing", async () => {
    const { root, store } = await setup();
    await store.put(record("kept"));
    await importRecord(root, SITEMAP_META_RECORD_ID, { layout: { ...SITEMAP_FILESYSTEM_LAYOUT, layoutVersion: 2 } });

    await expect(createFilesystemSitemapStore({ sitemapsRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
    await expect(store.list()).rejects.toMatchObject({ code: "unsupported-version" });
    expect(await liveRecordFiles(root)).toEqual(["kept.json", "meta.json"]);
  });

  it("refuses a store with records but no layout marker at all", async () => {
    const root = await sandbox();
    // Bypass the store entirely: write a record directly without ever
    // stamping the marker, unlike every path that goes through `open()`.
    await importRecord(root, "stray", { id: "stray" });
    await expect(createFilesystemSitemapStore({ sitemapsRoot: root })).rejects.toMatchObject({ code: "unsupported-version" });
  });

  it("rejects a stale mutation token in a batch and leaves the store untouched", async () => {
    const { root, store } = await setup();
    const stale = await store.snapshot();
    await store.put(record("a"));
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
    await store.put(record("a"));
    const before = await store.snapshot();

    const result = await store.applyTransaction({
      expectedMutationToken: before.mutationToken,
      steps: [
        { operation: "put", payload: { record: record("b") } },
        { operation: "delete", payload: { id: "a" } },
      ],
    });
    expect(result.records.map((entry) => entry.id)).toEqual(["b"]);
    expect((await store.readAll()).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("detects a concurrent write across independent store handles", async () => {
    const { root, store } = await setup();
    const other = await createFilesystemSitemapStore({ sitemapsRoot: root });
    const captured = await store.snapshot();

    await other.put(record("new"));
    const observed = await store.snapshot();
    expect(observed.mutationToken).not.toBe(captured.mutationToken);
    expect(observed.records).toHaveLength(1);
  });
});
