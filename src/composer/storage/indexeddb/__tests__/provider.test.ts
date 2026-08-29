import { IDBFactory as FDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createFixtureDocument } from "../../../__tests__/fixtures";
import { createSequentialIdFactory } from "../../../../shared/id-factory";
import { cloneJson } from "../../../../shared/json";
import { isCompositionLifecycleStore, type CompositionRecord } from "../../../library";
import { COMPOSITION_SCHEMA_VERSION } from "../../../model/types";
import { createIndexedDbCompositionProvider } from "../provider";
import { COMPOSER_DATABASE_NAME, COMPOSER_DATABASE_VERSION, COMPOSER_META_KEYS, COMPOSITIONS_STORE_NAME, META_STORE_NAME } from "../types";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function provider(factory: IDBFactory | null) {
  return createIndexedDbCompositionProvider({
    idbFactory: factory,
    idFactory: createSequentialIdFactory("composition"),
    initialDocument: createFixtureDocument,
    now: () => T1,
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inspect(factory: IDBFactory): Promise<{ records: unknown[]; meta: unknown[] }> {
  const db = await requestResult(factory.open(COMPOSER_DATABASE_NAME));
  const transaction = db.transaction([COMPOSITIONS_STORE_NAME, META_STORE_NAME], "readonly");
  const records = await requestResult(transaction.objectStore(COMPOSITIONS_STORE_NAME).getAll());
  const meta = await requestResult(transaction.objectStore(META_STORE_NAME).getAll());
  db.close();
  return { records, meta };
}

function record(id: string): CompositionRecord {
  const document = createFixtureDocument();
  document.id = id;
  document.name = id;
  return { id, createdAt: T1, updatedAt: T2, document };
}

describe("IndexedDB composition provider", () => {
  it("creates only the clean current database and seeds the injected document", async () => {
    const factory = new FDBFactory();
    const currentProvider = provider(factory);
    const initialized = await currentProvider.initialization.initialize();
    expect(initialized).toMatchObject({ status: "ready", summaries: [{ id: "composition-1", name: "Product overview" }] });
    const stored = await inspect(factory);
    expect(stored.records).toHaveLength(1);
    expect(stored.meta).toEqual(expect.arrayContaining([
      { key: COMPOSER_META_KEYS.schema, databaseVersion: COMPOSER_DATABASE_VERSION, recordSchemaVersion: COMPOSITION_SCHEMA_VERSION },
      { key: COMPOSER_META_KEYS.initialization, state: "ready", initializedAt: T1, recordId: "composition-1" },
    ]));
  });

  it("supports current-schema CRUD without silently recreating data after clear", async () => {
    const factory = new FDBFactory();
    const currentProvider = provider(factory);
    const initialized = await currentProvider.initialization.initialize();
    if (initialized.status !== "ready") throw new Error("provider did not initialize");
    await currentProvider.store.put(record("second"));
    expect((await currentProvider.store.list()).map(({ id }) => id)).toEqual(["second", "composition-1"]);
    expect(await currentProvider.store.get("second")).toMatchObject({ status: "loaded", record: { id: "second" } });
    expect(await currentProvider.store.delete("second")).toBe(true);
    await currentProvider.store.clear();
    expect(await currentProvider.store.list()).toEqual([]);
    expect(await provider(factory).initialization.initialize()).toMatchObject({ status: "ready", summaries: [] });
  });

  it("quarantines future records and preserves their exact stored value", async () => {
    const factory = new FDBFactory();
    const currentProvider = provider(factory);
    const initialized = await currentProvider.initialization.initialize();
    if (initialized.status !== "ready") throw new Error("provider did not initialize");
    const future = cloneJson(record("future")) as unknown as Record<string, unknown>;
    (future.document as Record<string, unknown>).schemaVersion = COMPOSITION_SCHEMA_VERSION + 1;
    const db = await requestResult(factory.open(COMPOSER_DATABASE_NAME));
    await requestResult(db.transaction(COMPOSITIONS_STORE_NAME, "readwrite").objectStore(COMPOSITIONS_STORE_NAME).put(future));
    db.close();
    expect(await currentProvider.store.get("future")).toEqual({ status: "future-schema", foundSchemaVersion: COMPOSITION_SCHEMA_VERSION + 1, raw: future });
    expect((await inspect(factory)).records).toContainEqual(future);
    await expect(currentProvider.initialization.retry()).resolves.toMatchObject({
      status: "recovery-required",
      recovery: { kind: "quarantined", reason: "future-schema", sourcePreserved: true },
    });
    await expect(currentProvider.initialization.startFresh()).resolves.toMatchObject({
      status: "ready",
      summaries: [{ id: "composition-2" }],
    });
    expect((await inspect(factory)).records).not.toContainEqual(future);
  });

  it("quarantines malformed current data without rewriting it", async () => {
    const factory = new FDBFactory();
    const currentProvider = provider(factory);
    const initialized = await currentProvider.initialization.initialize();
    if (initialized.status !== "ready") throw new Error("provider did not initialize");
    const malformed = { id: "broken", createdAt: T1, updatedAt: T1, document: { schemaVersion: 2 } };
    const db = await requestResult(factory.open(COMPOSER_DATABASE_NAME));
    await requestResult(db.transaction(COMPOSITIONS_STORE_NAME, "readwrite").objectStore(COMPOSITIONS_STORE_NAME).put(malformed));
    db.close();

    await expect(currentProvider.initialization.retry()).resolves.toMatchObject({
      status: "recovery-required",
      recovery: { kind: "quarantined", reason: "malformed", sourcePreserved: true },
    });
    expect((await inspect(factory)).records).toContainEqual(malformed);
  });

  it("keeps dependency scans and source mutations provider-atomic", async () => {
    const factory = new FDBFactory();
    const currentProvider = provider(factory);
    const initialized = await currentProvider.initialization.initialize();
    if (initialized.status !== "ready") throw new Error("provider did not initialize");
    const store = currentProvider.store;
    expect(isCompositionLifecycleStore(store)).toBe(true);
    if (!isCompositionLifecycleStore(store)) throw new Error("missing lifecycle capability");
    const source = record("source");
    source.document.publication = { kind: "global-template", outlet: { id: "main", label: "Main", target: { parentId: source.document.root[0]!.id, slotId: "content" } } };
    await store.put(source);
    const consumer = record("consumer");
    consumer.document.binding = { sourceRecordId: source.id, outletId: "main" };
    await store.put(consumer);
    expect(await store.deleteWithDependencyCheck(source.id)).toMatchObject({ status: "blocked", dependents: [{ summary: { id: "consumer" } }] });
    expect(await store.unpublishWithDependencyCheck(source.id)).toMatchObject({ status: "blocked" });
    await store.delete(consumer.id);
    expect(await store.deleteWithDependencyCheck(source.id)).toEqual({ status: "deleted" });
  });

  it("reports unavailable storage and rejects a newer physical database", async () => {
    await expect(provider(null).initialization.initialize()).resolves.toMatchObject({ status: "error", error: { code: "unavailable" } });
    const factory = new FDBFactory();
    const newer = await requestResult(factory.open(COMPOSER_DATABASE_NAME, COMPOSER_DATABASE_VERSION + 1));
    newer.close();
    await expect(provider(factory).initialization.initialize()).resolves.toMatchObject({ status: "error", error: { code: "unsupported-version", retryable: false } });
  });
});
