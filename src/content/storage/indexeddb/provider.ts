import {
  CONTENT_PROVIDERS,
  ContentPersistenceError,
} from "../../library";
import type {
  ContentInitializationOutcome,
  ContentPersistenceErrorCode,
  ContentPersistenceOperation,
  ContentProvider,
  ContentRecoveryOutcome,
} from "../../library";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_MODEL_SCHEMA_VERSION } from "../../model";
import { IndexedDbContentStore } from "./store";
import {
  CONTENT_DATABASE_NAME,
  CONTENT_DATABASE_VERSION,
  CONTENT_ENTRIES_STORE_NAME,
  CONTENT_ENTRY_MODEL_CREATED_AT_INDEX,
  CONTENT_ENTRY_MODEL_INDEX,
  CONTENT_META_KEYS,
  CONTENT_META_STORE_NAME,
  CONTENT_MODELS_STORE_NAME,
  CONTENT_MODEL_CREATED_AT_INDEX,
} from "./types";
import type { ContentSchemaMeta, IndexedDbContentProviderOptions } from "./types";

export function contentPersistenceError(operation: ContentPersistenceOperation, code: ContentPersistenceErrorCode, message: string, retryable: boolean, cause?: unknown): ContentPersistenceError {
  return new ContentPersistenceError(operation, code, message, retryable, { cause });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException("IndexedDB transaction aborted.", "AbortError"));
    transaction.onerror = () => undefined;
  });
}

function errorName(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && "name" in value && typeof value.name === "string" ? value.name : undefined;
}

export function mapContentOperationalError(operation: ContentPersistenceOperation, mode: IDBTransactionMode, error: unknown): ContentPersistenceError {
  if (error instanceof ContentPersistenceError) return error;
  const aborted = errorName(error) === "AbortError";
  return contentPersistenceError(operation, aborted ? "transaction-failed" : mode === "readonly" ? "read-failed" : "write-failed", aborted ? `IndexedDB ${operation} transaction was aborted.` : `IndexedDB ${operation} request failed.`, true, error);
}

export interface ContentOpenConnection { db: IDBDatabase; invalidated: boolean }

function sameNames(actual: DOMStringList, expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function hasExactPhysicalShape(db: IDBDatabase): boolean {
  if (!sameNames(db.objectStoreNames, [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME, CONTENT_META_STORE_NAME])) return false;
  try {
    const transaction = db.transaction([CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME, CONTENT_META_STORE_NAME], "readonly");
    const models = transaction.objectStore(CONTENT_MODELS_STORE_NAME);
    const entries = transaction.objectStore(CONTENT_ENTRIES_STORE_NAME);
    const meta = transaction.objectStore(CONTENT_META_STORE_NAME);
    return models.keyPath === "id"
      && !models.autoIncrement
      && sameNames(models.indexNames, [CONTENT_MODEL_CREATED_AT_INDEX])
      && JSON.stringify(models.index(CONTENT_MODEL_CREATED_AT_INDEX).keyPath) === JSON.stringify(["createdAt", "id"])
      && !models.index(CONTENT_MODEL_CREATED_AT_INDEX).unique
      && entries.keyPath === "id"
      && !entries.autoIncrement
      && sameNames(entries.indexNames, [CONTENT_ENTRY_MODEL_INDEX, CONTENT_ENTRY_MODEL_CREATED_AT_INDEX])
      && entries.index(CONTENT_ENTRY_MODEL_INDEX).keyPath === "modelId"
      && !entries.index(CONTENT_ENTRY_MODEL_INDEX).unique
      && JSON.stringify(entries.index(CONTENT_ENTRY_MODEL_CREATED_AT_INDEX).keyPath) === JSON.stringify(["modelId", "createdAt", "id"])
      && entries.index(CONTENT_ENTRY_MODEL_CREATED_AT_INDEX).unique
      && meta.keyPath === "key"
      && !meta.autoIncrement
      && meta.indexNames.length === 0;
  } catch {
    return false;
  }
}

export class IndexedDbContentRuntime {
  readonly factory: IDBFactory | null | undefined;
  readonly now: () => string;
  readonly keyRangeFactory: Pick<typeof IDBKeyRange, "bound"> | null | undefined;
  private connection: ContentOpenConnection | undefined;
  private opening: Promise<ContentOpenConnection> | undefined;

  constructor(options: IndexedDbContentProviderOptions) {
    this.factory = options.idbFactory === undefined ? (globalThis as { indexedDB?: IDBFactory }).indexedDB : options.idbFactory;
    this.now = options.now ?? (() => new Date().toISOString());
    this.keyRangeFactory = options.keyRangeFactory === undefined
      ? (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange
      : options.keyRangeFactory;
  }

  async open(operation: ContentPersistenceOperation): Promise<ContentOpenConnection> {
    if (this.connection) {
      if (this.connection.invalidated) throw contentPersistenceError(operation, "versionchange", "Content storage was closed because another context changed its database version.", true);
      return this.connection;
    }
    if (!this.factory) throw contentPersistenceError(operation, "unavailable", "IndexedDB is unavailable in this browser context.", true);
    this.opening ??= this.openDatabase();
    try { return await this.opening; } finally { this.opening = undefined; }
  }

  prepareRetry(): void { if (this.connection?.invalidated) this.connection = undefined; }
  close(): void { this.connection?.db.close(); this.connection = undefined; }

  private openDatabase(): Promise<ContentOpenConnection> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try { request = this.factory!.open(CONTENT_DATABASE_NAME, CONTENT_DATABASE_VERSION); }
      catch (error) { reject(contentPersistenceError("initialize", "unavailable", "Content IndexedDB could not be opened.", true, error)); return; }
      let settled = false;
      let upgradeFailure: ContentPersistenceError | undefined;
      request.onupgradeneeded = (event) => {
        const transaction = request.transaction;
        try {
          if (!transaction || event.oldVersion !== 0) throw contentPersistenceError("initialize", "unsupported-version", `Content database version ${event.oldVersion} is unsupported by this clean build.`, false);
          const models = request.result.createObjectStore(CONTENT_MODELS_STORE_NAME, { keyPath: "id" });
          models.createIndex(CONTENT_MODEL_CREATED_AT_INDEX, ["createdAt", "id"], { unique: false });
          const entries = request.result.createObjectStore(CONTENT_ENTRIES_STORE_NAME, { keyPath: "id" });
          entries.createIndex(CONTENT_ENTRY_MODEL_INDEX, "modelId", { unique: false });
          entries.createIndex(CONTENT_ENTRY_MODEL_CREATED_AT_INDEX, ["modelId", "createdAt", "id"], { unique: true });
          const meta = request.result.createObjectStore(CONTENT_META_STORE_NAME, { keyPath: "key" });
          meta.put({ key: CONTENT_META_KEYS.schema, databaseVersion: CONTENT_DATABASE_VERSION, modelRecordSchemaVersion: CONTENT_MODEL_SCHEMA_VERSION, entryRecordSchemaVersion: CONTENT_ENTRY_SCHEMA_VERSION } satisfies ContentSchemaMeta);
        } catch (error) {
          upgradeFailure = error instanceof ContentPersistenceError ? error : contentPersistenceError("initialize", "transaction-failed", "Content database initialization failed.", true, error);
          try { transaction?.abort(); } catch { /* already aborted */ }
        }
      };
      request.onblocked = () => { if (!settled) { settled = true; reject(contentPersistenceError("initialize", "blocked", "Content storage is blocked by another open context.", true)); } };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        if (upgradeFailure) { reject(upgradeFailure); return; }
        if (request.error?.name === "VersionError") { reject(contentPersistenceError("initialize", "unsupported-version", "This Content database was created by a newer application version.", false, request.error)); return; }
        reject(contentPersistenceError("initialize", "transaction-failed", "Content database opening failed.", true, request.error));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        if (!hasExactPhysicalShape(db)) {
          settled = true;
          db.close();
          reject(contentPersistenceError("initialize", "unsupported-version", "Content database has an unsupported physical schema.", false));
          return;
        }
        settled = true;
        const connection = { db, invalidated: false };
        db.onversionchange = () => { connection.invalidated = true; db.close(); };
        this.connection = connection;
        resolve(connection);
      };
    });
  }
}

function recovery(failures: readonly { id: string; status: "invalid" | "future-schema"; version?: number }[]): ContentRecoveryOutcome {
  const future = failures.find((failure) => failure.status === "future-schema");
  return { kind: "quarantined", reason: future ? "future-schema" : "invalid", sourcePreserved: true, affectedRecordIds: failures.map((failure) => failure.id), ...(future?.version === undefined ? {} : { foundSchemaVersion: future.version }), message: future ? "Content storage contains records from a newer schema. The source data was preserved." : "Content storage contains malformed records. The source data was preserved." };
}

export function createIndexedDbContentProvider(options: IndexedDbContentProviderOptions = {}): ContentProvider {
  const runtime = new IndexedDbContentRuntime(options);
  const store = new IndexedDbContentStore(runtime);
  const initialize = async (): Promise<ContentInitializationOutcome> => {
    try {
      const scan = await store.scanForInitialization();
      if (scan.failures.length) return { status: "recovery-required", models: scan.models, recovery: recovery(scan.failures) };
      if (options.seed) await store.seed(options.seed);
      return { status: "ready", models: await store.listModels() };
    } catch (error) {
      return { status: "error", error: error instanceof ContentPersistenceError ? error : contentPersistenceError("initialize", "unknown", "Content storage initialization failed.", true, error) };
    }
  };
  return {
    descriptor: CONTENT_PROVIDERS.indexeddb,
    store,
    initialization: {
      initialize,
      retry: async () => { runtime.prepareRetry(); return initialize(); },
      startFresh: async () => {
        try { await store.forceClear(); if (options.seed) await store.seed(options.seed); return { status: "ready", models: await store.listModels() }; }
        catch (error) { return { status: "error", error: error instanceof ContentPersistenceError ? error : contentPersistenceError("clear", "unknown", "Starting fresh Content storage failed.", true, error) }; }
      },
    },
  };
}
