import { IDBFactory as FDBFactory, IDBKeyRange as FDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../../library";
import type { ContentEntryRecord, ContentModelRecord } from "../../../model";
import { createSampleContentSeed, SAMPLE_CONTENT_IDS } from "../../../sample";
import { createIndexedDbContentProvider, mapContentOperationalError } from "../provider";
import {
  CONTENT_DATABASE_NAME,
  CONTENT_DATABASE_VERSION,
  CONTENT_ENTRIES_STORE_NAME,
  CONTENT_ENTRY_MODEL_CREATED_AT_INDEX,
  CONTENT_ENTRY_MODEL_INDEX,
  CONTENT_META_STORE_NAME,
  CONTENT_MODELS_STORE_NAME,
  CONTENT_MODEL_CREATED_AT_INDEX,
} from "../types";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function complete(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
function model(id = "posts", kind: "collection" | "single" = "collection"): ContentModelRecord { return createContentModelRecord({ name: "Posts", kind, fields: [
  { id: "title", key: "title", label: "Title", required: true, kind: "text" },
  { id: "score", key: "score", label: "Score", required: false, kind: "number" },
] }, { id, timestamp: T1 }); }
function entry(id: string, modelId = "posts", createdAt = T1, values: ContentEntryRecord["values"] = { title: id }): ContentEntryRecord { return createContentEntryRecord(modelId, values, { id, timestamp: createdAt }); }
async function rawPut(factory: IDBFactory, storeName: string, value: unknown): Promise<void> { const db = await request(factory.open(CONTENT_DATABASE_NAME)); const tx = db.transaction(storeName, "readwrite"); tx.objectStore(storeName).put(value); await complete(tx); db.close(); }

describe("IndexedDB Content provider", () => {
  it("creates the dedicated exact physical schema and descriptor", async () => {
    const factory = new FDBFactory(); const provider = createIndexedDbContentProvider({ idbFactory: factory });
    expect(provider.descriptor).toEqual({ id: "content-indexeddb", label: "Browser storage" });
    expect(await provider.initialization.initialize()).toEqual({ status: "ready", models: [] });
    const db = await request(factory.open(CONTENT_DATABASE_NAME));
    expect(db.version).toBe(CONTENT_DATABASE_VERSION);
    expect([...db.objectStoreNames]).toEqual([CONTENT_ENTRIES_STORE_NAME, CONTENT_META_STORE_NAME, CONTENT_MODELS_STORE_NAME]);
    const tx = db.transaction([CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME]);
    expect([...tx.objectStore(CONTENT_MODELS_STORE_NAME).indexNames]).toEqual([CONTENT_MODEL_CREATED_AT_INDEX]);
    expect([...tx.objectStore(CONTENT_ENTRIES_STORE_NAME).indexNames]).toEqual([CONTENT_ENTRY_MODEL_INDEX, CONTENT_ENTRY_MODEL_CREATED_AT_INDEX].sort());
    db.close();
  });

  it("pages a Collection newest-first with a stable exclusive cursor and snapshot-scans once", async () => {
    const provider = createIndexedDbContentProvider({ idbFactory: new FDBFactory(), keyRangeFactory: FDBKeyRange }); await provider.initialization.initialize(); await provider.store.putModel(model());
    for (let index = 0; index < 55; index += 1) await provider.store.putEntry(entry(`entry-${String(index).padStart(3, "0")}`, "posts", new Date(Date.parse(T1) + index * 1000).toISOString()));
    const first = await provider.store.pageEntries("posts");
    expect(first.entries).toHaveLength(50); expect(first.entries[0]!.id).toBe("entry-054"); expect(first.nextCursor).toBeTruthy();
    await provider.store.putEntry(entry("entry-new", "posts", T2));
    const second = await provider.store.pageEntries("posts", { cursor: first.nextCursor });
    expect(second.entries.map(({ id }) => id)).toEqual(["entry-004", "entry-003", "entry-002", "entry-001", "entry-000"]);
    expect(new Set([...first.entries, ...second.entries].map(({ id }) => id)).size).toBe(55);
    const snapshot = await provider.store.scanEntries("posts"); expect(snapshot.count).toBe(56); expect(snapshot.entries).toHaveLength(56);
    await expect(provider.store.pageEntries("posts", { limit: 201 })).rejects.toMatchObject({ code: "validation", retryable: false });
  });

  it("enforces Single cardinality transactionally while allowing updates", async () => {
    const provider = createIndexedDbContentProvider({ idbFactory: new FDBFactory() }); await provider.initialization.initialize(); await provider.store.putModel(model("settings", "single"));
    await provider.store.putEntry(entry("one", "settings")); await provider.store.putEntry({ ...entry("one", "settings"), updatedAt: T2, values: { title: "updated" } });
    await expect(provider.store.putEntry(entry("two", "settings"))).rejects.toMatchObject({ code: "single-cardinality", retryable: false });
    expect(await provider.store.countEntries("settings")).toBe(1);
  });

  it("persists incomplete drafts, permits rename/reorder, and rejects forbidden mutations", async () => {
    const provider = createIndexedDbContentProvider({ idbFactory: new FDBFactory() }); await provider.initialization.initialize(); const original = model(); await provider.store.putModel(original);
    await provider.store.putEntry(entry("draft", "posts", T1, {}));
    expect((await provider.store.scanEntries("posts")).diagnostics).toEqual([expect.objectContaining({ entryId: "draft", fieldId: "title" })]);
    await provider.store.putModel({ ...original, updatedAt: T2, document: { ...original.document, name: "Renamed", fields: [original.document.fields[1]!, { ...original.document.fields[0]!, label: "Headline", key: "headline" }] } });
    expect(await provider.store.getModel("posts")).toMatchObject({ status: "loaded", record: { document: { name: "Renamed", fields: [{ id: "score" }, { id: "title", key: "headline" }] } } });
    await expect(provider.store.putModel({ ...original, document: { ...original.document, kind: "single" } })).rejects.toMatchObject({ code: "immutable-kind" });
    await expect(provider.store.putModel({ ...original, createdAt: T2, updatedAt: T2 })).rejects.toMatchObject({ code: "validation" });
    await provider.store.putEntry(entry("valued", "posts", T1, { title: "Hello" }));
    await expect(provider.store.putEntry(entry("valued", "posts", T2, { title: "Moved" }))).rejects.toMatchObject({ code: "validation" });
    await expect(provider.store.putModel({ ...original, document: { ...original.document, fields: [{ ...original.document.fields[0]!, kind: "markdown" }, original.document.fields[1]!] } })).rejects.toMatchObject({ code: "field-in-use" });
    await expect(provider.store.putModel({ ...original, document: { ...original.document, fields: [original.document.fields[0]!] } })).rejects.toMatchObject({ code: "field-removal-required" });
  });

  it("atomically removes a field definition and scrubs every Entry value", async () => {
    const provider = createIndexedDbContentProvider({ idbFactory: new FDBFactory() }); await provider.initialization.initialize(); await provider.store.putModel(model());
    await provider.store.putEntry(entry("one", "posts", T1, { title: "One", score: 1 })); await provider.store.putEntry(entry("two", "posts", T2, { title: "Two", score: 2 }));
    await provider.store.removeField("posts", "score");
    expect(await provider.store.getModel("posts")).toMatchObject({ status: "loaded", record: { document: { fields: [{ id: "title" }] } } });
    expect((await provider.store.scanEntries("posts")).entries.map(({ values }) => values)).toEqual([{ title: "Two" }, { title: "One" }]);
  });

  it("seeds explicit identities idempotently and recreates them after startFresh", async () => {
    const factory = new FDBFactory(); const seed = createSampleContentSeed(3); const provider = createIndexedDbContentProvider({ idbFactory: factory, seed });
    await provider.initialization.initialize(); await provider.initialization.initialize(); expect(await provider.store.countEntries(SAMPLE_CONTENT_IDS.collection)).toBe(3);
    await provider.initialization.startFresh(); expect((await provider.store.getModel(SAMPLE_CONTENT_IDS.collection))).toMatchObject({ status: "loaded", record: { id: SAMPLE_CONTENT_IDS.collection } });
    expect(await provider.store.countEntries(SAMPLE_CONTENT_IDS.collection)).toBe(3);
  });

  it("preserves malformed/future records until explicit startFresh", async () => {
    const factory = new FDBFactory(); const provider = createIndexedDbContentProvider({ idbFactory: factory }); await provider.initialization.initialize(); await provider.store.putModel(model("valid"));
    const malformed = { ...entry("broken", "valid"), updatedAt: "bad" }; const semantic = entry("semantic", "valid", T1, { "removed-field": "value" }); const future = { ...model("future"), document: { ...model("future").document, schemaVersion: 2 } };
    await rawPut(factory, CONTENT_ENTRIES_STORE_NAME, malformed); await rawPut(factory, CONTENT_ENTRIES_STORE_NAME, semantic); await rawPut(factory, CONTENT_MODELS_STORE_NAME, future);
    expect(await provider.initialization.retry()).toMatchObject({ status: "recovery-required", models: [expect.objectContaining({ id: "valid" })], recovery: { reason: "future-schema", sourcePreserved: true, affectedRecordIds: expect.arrayContaining(["broken", "semantic", "future"]) } });
    expect(await provider.store.getEntry("broken")).toEqual({ status: "invalid", issue: expect.anything(), raw: malformed });
    expect(await provider.store.getEntry("semantic")).toEqual({ status: "invalid", issue: expect.objectContaining({ code: "invalid-value" }), raw: semantic });
    await expect(provider.store.deleteEntry("semantic")).rejects.toMatchObject({ code: "validation", retryable: false });
    await expect(provider.store.clear()).rejects.toMatchObject({ code: "validation", retryable: false });
    expect(await provider.store.getEntry("semantic")).toMatchObject({ status: "invalid" });
    await provider.initialization.startFresh(); expect(await provider.store.listModels()).toEqual([]);
  });

  it("types unavailable, newer physical schema, and versionchange outcomes", async () => {
    expect(await createIndexedDbContentProvider({ idbFactory: null }).initialization.initialize()).toMatchObject({ status: "error", error: { code: "unavailable", retryable: true } });
    const newerFactory = new FDBFactory(); const newer = await request(newerFactory.open(CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION + 1)); newer.close();
    expect(await createIndexedDbContentProvider({ idbFactory: newerFactory }).initialization.initialize()).toMatchObject({ status: "error", error: { code: "unsupported-version", retryable: false } });
    const factory = new FDBFactory(); const provider = createIndexedDbContentProvider({ idbFactory: factory }); await provider.initialization.initialize();
    const upgrade = factory.open(CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION + 1); await request(upgrade); upgrade.result.close();
    await expect(provider.store.listModels()).rejects.toMatchObject({ code: "versionchange", retryable: true });
    expect(await provider.initialization.retry()).toMatchObject({ status: "error", error: { code: "unsupported-version", retryable: false } });
  });

  it("types blocked, request-failure, transaction-abort, and malformed physical-schema outcomes", async () => {
    const blockedRequest = {} as IDBOpenDBRequest;
    const blockedFactory = { open: () => { queueMicrotask(() => blockedRequest.onblocked?.(new Event("blocked") as IDBVersionChangeEvent)); return blockedRequest; } } as unknown as IDBFactory;
    expect(await createIndexedDbContentProvider({ idbFactory: blockedFactory }).initialization.initialize()).toMatchObject({ status: "error", error: { code: "blocked", retryable: true } });

    const failedRequest = { error: new DOMException("failed", "UnknownError") } as IDBOpenDBRequest;
    const failedFactory = { open: () => { queueMicrotask(() => failedRequest.onerror?.(new Event("error"))); return failedRequest; } } as unknown as IDBFactory;
    expect(await createIndexedDbContentProvider({ idbFactory: failedFactory }).initialization.initialize()).toMatchObject({ status: "error", error: { code: "transaction-failed", retryable: true } });
    expect(mapContentOperationalError("get-entry", "readonly", new Error("request"))).toMatchObject({ code: "read-failed", retryable: true });
    expect(mapContentOperationalError("put-entry", "readwrite", new DOMException("aborted", "AbortError"))).toMatchObject({ code: "transaction-failed", retryable: true });

    const malformedFactory = new FDBFactory();
    const malformed = malformedFactory.open(CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION);
    malformed.onupgradeneeded = () => { malformed.result.createObjectStore("wrong"); };
    const malformedDb = await request(malformed); malformedDb.close();
    expect(await createIndexedDbContentProvider({ idbFactory: malformedFactory }).initialization.initialize()).toMatchObject({ status: "error", error: { code: "unsupported-version", retryable: false } });
  });
});
