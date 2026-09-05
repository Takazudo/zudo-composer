import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { subscribePersistenceChanges } from "../../../../shared/persistence-generation";
import { workspaceDatabaseName, workspaceScopedFactory } from "../../../../app/workspace-storage";
import { isSitemapCollectionStore, SitemapPersistenceError } from "../../../library";
import type { SitemapRecord } from "../../../library";
import { SITEMAP_SCHEMA_VERSION } from "../../../model";
import { createIndexedDbSitemapProvider } from "../provider";
import {
  META_STORE_NAME,
  SITEMAPPER_DATABASE_NAME,
  SITEMAPPER_DATABASE_VERSION,
  SITEMAPS_STORE_NAME,
  UPDATED_AT_INDEX_NAME,
} from "../types";

function record(id: string, updatedAt = "2026-01-01T00:00:00.000Z"): SitemapRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    document: {
      schemaVersion: SITEMAP_SCHEMA_VERSION, navigation: { primary: [], footer: [] },
      id,
      name: id,
      root: [{ id: `${id}-home`, title: "Home", source: { kind: "unassigned" }, children: [] }],
    },
  };
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

async function inspectDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return request(factory.open(SITEMAPPER_DATABASE_NAME, SITEMAPPER_DATABASE_VERSION));
}

async function seedRaw(factory: IDBFactory, value: unknown): Promise<void> {
  const db = await inspectDatabase(factory);
  const transaction = db.transaction(SITEMAPS_STORE_NAME, "readwrite");
  transaction.objectStore(SITEMAPS_STORE_NAME).put(value);
  await complete(transaction);
  db.close();
}

describe("IndexedDB Sitemap provider", () => {
  it("coalesces concurrent startFresh recreation and emits exactly one persistence notification", async () => {
    const factory = new FDBFactory(); const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    await provider.initialization.initialize(); await provider.store.put(record("old"));
    const changed = vi.fn(); const stop = subscribePersistenceChanges(changed);
    const deletion = vi.spyOn(factory, "deleteDatabase");
    try {
      const results = await Promise.all([provider.initialization.startFresh(), provider.initialization.startFresh(), provider.initialization.startFresh()]);
      expect(results).toEqual(Array.from({ length: 3 }, () => ({ status: "ready", summaries: [] })));
      expect(deletion).toHaveBeenCalledTimes(1);
      expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith(SITEMAPPER_DATABASE_NAME);
      expect(await provider.store.list()).toEqual([]);
    } finally { stop(); deletion.mockRestore(); }
  });
  it.each([false, true])("preserves old physical/schema metadata until explicit reset (has records: %s)", async (hasRecords) => {
    const factory = new FDBFactory();
    const open = factory.open(SITEMAPPER_DATABASE_NAME, 1);
    const old = { ...record("old"), document: { ...record("old").document, schemaVersion: 2 } };
    open.onupgradeneeded = () => {
      const records = open.result.createObjectStore(SITEMAPS_STORE_NAME, { keyPath: "id" }); records.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt");
      if (hasRecords) records.put(old);
      const meta = open.result.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      meta.put({ key: "schema", databaseVersion: 1, recordSchemaVersion: 2 }); meta.put({ key: "mutation", token: 0 });
    };
    (await request(open)).close();
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    expect(await provider.initialization.initialize()).toMatchObject({ status: "error", error: { code: "unsupported-version" } });
    const preserved = await request(factory.open(SITEMAPPER_DATABASE_NAME, 1));
    expect(await request(preserved.transaction(SITEMAPS_STORE_NAME).objectStore(SITEMAPS_STORE_NAME).getAll())).toEqual(hasRecords ? [old] : []);
    preserved.close();
    expect(await provider.initialization.startFresh()).toEqual({ status: "ready", summaries: [] });
    const current = await inspectDatabase(factory); expect(current.version).toBe(3);
    expect(await request(current.transaction(META_STORE_NAME).objectStore(META_STORE_NAME).get("schema"))).toEqual({ key: "schema", databaseVersion: 3, recordSchemaVersion: 3 });
    current.close();
  });
  it("rejects stale metadata in an empty current physical database on every operation", async () => {
    const factory = new FDBFactory(); const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    await provider.initialization.initialize(); const db = await inspectDatabase(factory);
    const tx = db.transaction(META_STORE_NAME, "readwrite"); tx.objectStore(META_STORE_NAME).put({ key: "schema", databaseVersion: 3, recordSchemaVersion: 2 }); await complete(tx); db.close();
    expect(await provider.initialization.initialize()).toMatchObject({ status: "error", error: { code: "unsupported-version" } });
    await expect(provider.store.put(record("new"))).rejects.toMatchObject({ code: "unsupported-version" });
    expect(await provider.initialization.startFresh()).toMatchObject({ status: "ready" });
    await expect(provider.store.put(record("new"))).resolves.toBeUndefined();
  });
  it("keeps blocked reset pending until deletion completes and notifies the exact workspace database", async () => {
    const rawFactory = new FDBFactory(); const factory = workspaceScopedFactory(rawFactory, () => "sitemap-reset")!;
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory }); await provider.initialization.initialize();
    await provider.store.put(record("old"));
    const blocker = await inspectDatabase(factory); let blocked = false;
    blocker.onversionchange = () => { blocked = true; };
    const changed = vi.fn(); const stop = subscribePersistenceChanges(changed);
    let settled = false;
    const reset = provider.initialization.startFresh().then((result) => { settled = true; return result; });
    await vi.waitFor(() => expect(blocked).toBe(true));
    expect(settled).toBe(false); expect(changed).not.toHaveBeenCalled();
    blocker.close(); expect(await reset).toEqual({ status: "ready", summaries: [] });
    expect(changed).toHaveBeenCalledWith(workspaceDatabaseName(SITEMAPPER_DATABASE_NAME, "sitemap-reset")); stop();
    expect(await provider.store.list()).toEqual([]);
  });
  it("seeds multiple records atomically, preserves edits, and snapshots the collection", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory(), seed: [record("alpha"), record("beta")] });
    expect(await provider.initialization.initialize()).toMatchObject({ status: "ready", summaries: expect.any(Array) });
    expect(isSitemapCollectionStore(provider.store)).toBe(true);
    if (!isSitemapCollectionStore(provider.store)) return;
    await provider.store.put({ ...record("alpha", "2026-01-02T00:00:00.000Z"), document: { ...record("alpha").document, name: "edited" } });
    await provider.store.seed([record("alpha"), record("beta")]);
    expect((await provider.store.readAll()).find(({ id }) => id === "alpha")!.document.name).toBe("edited");
  });

  it("rejects duplicate seed ids before any record write", async () => {
    const factory = new FDBFactory(); const duplicate = record("duplicate");
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory, seed: [duplicate, duplicate] });
    expect(await provider.initialization.initialize()).toMatchObject({ status: "error", error: { code: "validation" } });
    const db = await inspectDatabase(factory); const records = await request(db.transaction(SITEMAPS_STORE_NAME).objectStore(SITEMAPS_STORE_NAME).getAll()); db.close();
    expect(records).toEqual([]);
  });
  it("uses the separate Sitemapper database schema", async () => {
    const factory = new FDBFactory();
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    expect(await provider.initialization.initialize()).toEqual({ status: "ready", summaries: [] });

    const db = await inspectDatabase(factory);
    expect(db.name).toBe("zudo-composer-sitemapper");
    expect([...db.objectStoreNames]).toEqual([META_STORE_NAME, SITEMAPS_STORE_NAME]);
    const transaction = db.transaction(SITEMAPS_STORE_NAME);
    expect([...transaction.objectStore(SITEMAPS_STORE_NAME).indexNames]).toEqual([
      UPDATED_AT_INDEX_NAME,
    ]);
    db.close();
  });

  it("supports create, read, update, duplicate, delete, and clear", async () => {
    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    await provider.initialization.initialize();
    await provider.store.put(record("alpha"));
    expect(await provider.store.get("alpha")).toMatchObject({ status: "loaded" });

    await provider.store.put({
      ...record("alpha", "2026-01-03T00:00:00.000Z"),
      document: { ...record("alpha").document, name: "updated" },
    });
    expect(await provider.store.get("alpha")).toMatchObject({
      status: "loaded",
      record: { updatedAt: "2026-01-03T00:00:00.000Z", document: { name: "updated" } },
    });

    await provider.store.put(record("copy", "2026-01-02T00:00:00.000Z"));
    expect(await provider.store.list()).toEqual([
      expect.objectContaining({ id: "alpha", pageCount: 1 }),
      expect.objectContaining({ id: "copy", pageCount: 1 }),
    ]);
    expect(await provider.store.delete("missing")).toBe(false);
    expect(await provider.store.delete("alpha")).toBe(true);
    expect(await provider.store.get("alpha")).toEqual({ status: "not-found", id: "alpha" });
    await provider.store.clear();
    expect(await provider.store.list()).toEqual([]);
  });

  it("revalidates every read and returns invalid/future-schema outcomes", async () => {
    const factory = new FDBFactory();
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    await provider.initialization.initialize();
    const invalid = { ...record("invalid"), updatedAt: "not-a-date" };
    await seedRaw(factory, invalid);
    expect(await provider.store.get("invalid")).toEqual({
      status: "invalid",
      issue: expect.objectContaining({ code: "invalid-updated-at" }),
      raw: invalid,
    });

    const future = {
      ...record("future"),
      document: { ...record("future").document, schemaVersion: SITEMAP_SCHEMA_VERSION + 1 },
    };
    await seedRaw(factory, future);
    expect(await provider.store.get("future")).toEqual({
      status: "future-schema",
      foundSchemaVersion: SITEMAP_SCHEMA_VERSION + 1,
      raw: future,
    });
    await expect(provider.store.list()).rejects.toMatchObject({
      name: "SitemapPersistenceError",
      operation: "list",
      code: "validation",
      retryable: false,
    });
  });

  it("returns recovery-aware initialize/retry/startFresh outcomes with summaries", async () => {
    const factory = new FDBFactory();
    const provider = createIndexedDbSitemapProvider({ idbFactory: factory });
    await provider.initialization.initialize();
    await provider.store.put(record("valid"));
    const future = {
      ...record("future"),
      document: { ...record("future").document, schemaVersion: SITEMAP_SCHEMA_VERSION + 1 },
    };
    await seedRaw(factory, future);

    expect(await provider.initialization.initialize()).toMatchObject({
      status: "recovery-required",
      summaries: [expect.objectContaining({ id: "valid" })],
      recovery: {
        reason: "future-schema",
        sourcePreserved: true,
        affectedRecordIds: ["future"],
      },
    });
    expect(await provider.initialization.retry()).toMatchObject({
      status: "recovery-required",
      summaries: [expect.objectContaining({ id: "valid" })],
    });

    expect(await provider.initialization.startFresh()).toMatchObject({
      status: "ready",
      summaries: [],
    });
    expect(await provider.store.list()).toEqual([]);

  });

  it("returns typed initialization failures and rejects invalid writes", async () => {
    const unavailable = createIndexedDbSitemapProvider({ idbFactory: null });
    expect(await unavailable.initialization.initialize()).toMatchObject({
      status: "error",
      error: {
        name: "SitemapPersistenceError",
        operation: "initialize",
        code: "unavailable",
        retryable: true,
      },
    });

    const provider = createIndexedDbSitemapProvider({ idbFactory: new FDBFactory() });
    await provider.initialization.initialize();
    await expect(provider.store.put({ ...record("bad"), id: "different" })).rejects.toEqual(
      expect.objectContaining({
        name: "SitemapPersistenceError",
        operation: "put",
        code: "validation",
        retryable: false,
      }),
    );
    await expect(provider.store.put({ ...record("bad"), id: "different" })).rejects.toBeInstanceOf(
      SitemapPersistenceError,
    );
  });
});
