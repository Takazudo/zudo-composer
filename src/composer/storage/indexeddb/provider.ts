import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  compareCompositionSummariesNewestFirst,
  createCompositionRecord,
  loadCompositionRecord,
  summarizeComposition,
  validateCompositionRecord,
} from "../../library";
import type {
  CompositionInitializationOutcome,
  CompositionDependent,
  CompositionDeleteOutcome,
  CompositionLoadOutcome,
  CompositionPersistenceOperation,
  CompositionProvider,
  CompositionRecord,
  CompositionStore,
  CompositionSummary,
  CompositionUnpublishOutcome,
} from "../../library";
import { createUuidIdFactory } from "../../../shared/id-factory";
import { cloneJson } from "../../../shared/json";
import { COMPOSITION_SCHEMA_VERSION } from "../../model/types";
import {
  COMPOSER_DATABASE_NAME,
  COMPOSER_DATABASE_VERSION,
  COMPOSER_META_KEYS,
  COMPOSITIONS_STORE_NAME,
  META_STORE_NAME,
  UPDATED_AT_INDEX_NAME,
} from "./types";
import type {
  ComposerMetaRecord,
  IndexedDbCompositionProviderOptions,
  InitializationMeta,
} from "./types";

function persistenceError(
  operation: CompositionPersistenceOperation,
  code: ConstructorParameters<typeof CompositionPersistenceError>[1],
  message: string,
  retryable: boolean,
  cause?: unknown,
): CompositionPersistenceError {
  return new CompositionPersistenceError(operation, code, message, retryable, { cause });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException("IndexedDB transaction aborted.", "AbortError"));
    transaction.onerror = () => undefined;
  });
}

function errorName(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("name" in value)) return undefined;
  return typeof value.name === "string" ? value.name : undefined;
}

function mapOperationalError(
  operation: CompositionPersistenceOperation,
  mode: IDBTransactionMode,
  error: unknown,
): CompositionPersistenceError {
  if (error instanceof CompositionPersistenceError) return error;
  const aborted = errorName(error) === "AbortError";
  return persistenceError(
    operation,
    aborted ? "transaction-failed" : mode === "readonly" ? "read-failed" : "write-failed",
    aborted
      ? `IndexedDB ${operation} transaction was aborted.`
      : `IndexedDB ${operation} request failed.`,
    true,
    error,
  );
}

interface OpenConnection {
  db: IDBDatabase;
  invalidated: boolean;
}

class IndexedDbProviderRuntime {
  readonly factory: IDBFactory | null | undefined;
  readonly idFactory;
  readonly now: () => string;
  readonly initialDocument: IndexedDbCompositionProviderOptions["initialDocument"];
  readonly seedRecords: readonly CompositionRecord[] | undefined;
  connection: OpenConnection | undefined;
  opening: Promise<OpenConnection> | undefined;

  constructor(options: IndexedDbCompositionProviderOptions) {
    this.factory =
      options.idbFactory === undefined
        ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
        : options.idbFactory;
    this.idFactory = options.idFactory ?? createUuidIdFactory();
    this.now = options.now ?? (() => new Date().toISOString());
    this.initialDocument = options.initialDocument;
    this.seedRecords = options.seed;
  }

  async open(operation: CompositionPersistenceOperation): Promise<OpenConnection> {
    if (this.connection) {
      if (this.connection.invalidated) {
        throw persistenceError(
          operation,
          "versionchange",
          "Composer storage was closed because another context changed its database version. Retry to reopen it.",
          true,
        );
      }
      return this.connection;
    }
    if (!this.factory) {
      throw persistenceError(operation, "unavailable", "IndexedDB is unavailable.", true);
    }
    if (!this.opening) this.opening = this.openDatabase();
    try {
      return await this.opening;
    } finally {
      this.opening = undefined;
    }
  }

  prepareRetry(): void {
    if (this.connection?.invalidated) this.connection = undefined;
  }

  createSeedRecords(): readonly CompositionRecord[] {
    if (this.seedRecords) return cloneJson(this.seedRecords);
    if (!this.initialDocument) {
      throw persistenceError("initialize", "validation", "Composer provider requires an initialDocument or seed records.", false);
    }
    const record = createCompositionRecord(this.initialDocument(), {
      idFactory: this.idFactory,
      now: this.now,
    });
    const validation = validateCompositionRecord(record);
    if (!validation.ok) {
      throw persistenceError("initialize", "validation", validation.issue.message, false);
    }
    return [validation.record];
  }

  private openDatabase(): Promise<OpenConnection> {
    return new Promise<OpenConnection>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.open(COMPOSER_DATABASE_NAME, COMPOSER_DATABASE_VERSION);
      } catch (error) {
        reject(persistenceError("initialize", "unavailable", "IndexedDB could not be opened.", true, error));
        return;
      }
      let settled = false;
      let upgradeFailure: CompositionPersistenceError | undefined;

      request.onupgradeneeded = (event) => {
        const transaction = request.transaction;
        try {
          if (!transaction || event.oldVersion !== 0) {
            throw persistenceError(
              "initialize",
              "unsupported-version",
              `Composer database version ${event.oldVersion} is not supported by this clean build.`,
              false,
            );
          }
          const compositions = request.result.createObjectStore(COMPOSITIONS_STORE_NAME, { keyPath: "id" });
          compositions.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt", { unique: false });
          const meta = request.result.createObjectStore(META_STORE_NAME, { keyPath: "key" });
          meta.put({
            key: COMPOSER_META_KEYS.schema,
            databaseVersion: COMPOSER_DATABASE_VERSION,
            recordSchemaVersion: COMPOSITION_SCHEMA_VERSION,
          } satisfies ComposerMetaRecord);
        } catch (error) {
          upgradeFailure =
            error instanceof CompositionPersistenceError
              ? error
              : persistenceError("initialize", "transaction-failed", "Composer database initialization failed.", true, error);
          try {
            transaction?.abort();
          } catch {
            // Already aborted.
          }
        }
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(persistenceError("initialize", "blocked", "Composer storage is blocked by another open tab.", true));
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        if (upgradeFailure) return reject(upgradeFailure);
        const error = request.error;
        if (error?.name === "VersionError") {
          reject(persistenceError(
            "initialize",
            "unsupported-version",
            "This Composer database was created by a newer application version.",
            false,
            error,
          ));
          return;
        }
        reject(persistenceError("initialize", "transaction-failed", "Composer database opening failed.", true, error));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) return db.close();
        settled = true;
        const connection: OpenConnection = { db, invalidated: false };
        db.onversionchange = () => {
          connection.invalidated = true;
          db.close();
        };
        this.connection = connection;
        resolve(connection);
      };
    });
  }
}

function dependentFromRecord(record: CompositionRecord): CompositionDependent | undefined {
  const binding = record.document.binding;
  return binding === undefined
    ? undefined
    : { summary: summarizeComposition(record), binding: cloneJson(binding) };
}

class IndexedDbCompositionStore implements CompositionStore {
  readonly provider = COMPOSITION_PROVIDERS.indexeddb;

  constructor(private readonly runtime: IndexedDbProviderRuntime) {}

  async hasInitializationMeta(): Promise<boolean> {
    const connection = await this.runtime.open("initialize");
    const transaction = connection.db.transaction(META_STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(META_STORE_NAME).get(COMPOSER_META_KEYS.initialization));
    await transactionComplete(transaction);
    return value !== undefined;
  }

  async markInitialized(recordId: string): Promise<void> {
    const connection = await this.runtime.open("initialize");
    const transaction = connection.db.transaction(META_STORE_NAME, "readwrite");
    transaction.objectStore(META_STORE_NAME).put({ key: COMPOSER_META_KEYS.initialization, state: "ready", initializedAt: this.runtime.now(), recordId } satisfies InitializationMeta);
    await transactionComplete(transaction);
  }

  async initializationOutcome(): Promise<CompositionInitializationOutcome> {
    const records = await this.run("initialize", "readonly", (store) =>
      requestResult(store.getAll()) as Promise<unknown[]>,
    );
    const summaries: CompositionSummary[] = [];
    for (const raw of records) {
      const loaded = loadCompositionRecord(raw);
      if (loaded.status === "future-schema") {
        return {
          status: "recovery-required",
          recovery: {
            kind: "quarantined",
            reason: "future-schema",
            foundSchemaVersion: loaded.foundSchemaVersion,
            sourcePreserved: true,
            message: "Composer storage contains data written by a newer schema. Start fresh only if discarding it is intentional.",
          },
        };
      }
      if (loaded.status !== "loaded") {
        return {
          status: "recovery-required",
          recovery: {
            kind: "quarantined",
            reason: loaded.status === "invalid" && loaded.issue.code === "unsafe-id" ? "unsafe-id" : "malformed",
            sourcePreserved: true,
            message: "Composer storage contains malformed current-schema data. It was preserved without modification.",
          },
        };
      }
      summaries.push(summarizeComposition(loaded.record));
    }
    return { status: "ready", summaries: summaries.sort(compareCompositionSummariesNewestFirst) };
  }

  async list(): Promise<readonly CompositionSummary[]> {
    const records = await this.run("list", "readonly", (store) =>
      requestResult(store.getAll()) as Promise<CompositionRecord[]>,
    );
    return records
      .map((raw) => {
        const loaded = loadCompositionRecord(raw);
        if (loaded.status !== "loaded") {
          throw persistenceError(
            "list",
            "validation",
            "Composer storage contains a record that cannot be listed safely.",
            false,
          );
        }
        return summarizeComposition(loaded.record);
      })
      .sort(compareCompositionSummariesNewestFirst);
  }

  async get(id: string): Promise<CompositionLoadOutcome> {
    const raw = await this.run("get", "readonly", (store) => requestResult(store.get(id)));
    return raw === undefined ? { status: "not-found", id } : loadCompositionRecord(raw);
  }

  async readAll(): Promise<readonly CompositionRecord[]> {
    const records = await this.run("list", "readonly", (store) => requestResult(store.getAll()) as Promise<unknown[]>);
    return records.map((raw) => {
      const loaded = loadCompositionRecord(raw);
      if (loaded.status !== "loaded") throw persistenceError("list", "validation", "Composer storage contains a record that cannot be snapshotted safely.", false);
      return cloneJson(loaded.record);
    });
  }

  async seed(records: readonly CompositionRecord[]): Promise<void> {
    const validated: CompositionRecord[] = [];
    const ids = new Set<string>();
    for (const record of records) {
      const result = validateCompositionRecord(record);
      if (!result.ok) throw persistenceError("put", "validation", result.issue.message, false);
      if (ids.has(result.record.id)) throw persistenceError("put", "validation", `Duplicate seed Composition id "${result.record.id}".`, false);
      ids.add(result.record.id);
      validated.push(result.record);
    }
    await this.run("put", "readwrite", async (store) => {
      const existingRaw = await requestResult(store.getAll()) as unknown[];
      const merged = new Map<string, CompositionRecord>();
      for (const raw of existingRaw) {
        const loaded = loadCompositionRecord(raw);
        if (loaded.status !== "loaded") throw persistenceError("put", "validation", "Invalid Composer data was preserved. Use startFresh to discard it explicitly.", false);
        merged.set(loaded.record.id, loaded.record);
      }
      for (const record of validated) if (!merged.has(record.id)) merged.set(record.id, record);
      for (const record of merged.values()) {
        const binding = record.document.binding;
        if (!binding) continue;
        const source = merged.get(binding.sourceRecordId);
        if (!source || source.document.binding || source.document.publication?.kind !== "global-template" || source.document.publication.outlet.id !== binding.outletId) {
          throw persistenceError("put", "conflict", `Seed Composition "${record.id}" has an unresolved Global-template binding.`, false);
        }
      }
      for (const record of validated) if (!existingRaw.some((raw) => (raw as { id?: unknown })?.id === record.id)) await requestResult(store.add(cloneJson(record)));
    });
  }

  async put(record: CompositionRecord): Promise<import("../../library").CompositionSaveOutcome> {
    const validation = validateCompositionRecord(record);
    if (!validation.ok) {
      throw persistenceError("put", "validation", validation.issue.message, false);
    }
    await this.run("put", "readwrite", async (store) => {
      await this.assertBindingTransition(store, validation.record);
      await requestResult(store.put(validation.record));
    });
    return { canonical: { status: "saved" }, derived: { status: "current", records: [] } };
  }

  async delete(id: string): Promise<boolean> {
    const outcome = await this.deleteWithDependencyCheck(id);
    return outcome.status === "deleted";
  }

  /**
   * Read the candidate source and every canonical binding in the SAME
   * read-write transaction. IndexedDB's transaction serialization means a
   * consumer inserted by another tab either appears in this scan or waits
   * until this source mutation completes; there is no list-then-delete race.
   */
  async deleteWithDependencyCheck(id: string): Promise<CompositionDeleteOutcome> {
    return this.run("delete", "readwrite", async (store) => {
      const sourceRequest = store.get(id);
      const recordsRequest = store.getAll();
      const [rawSource, rawRecords] = await Promise.all([
        requestResult(sourceRequest),
        requestResult(recordsRequest) as Promise<CompositionRecord[]>,
      ]);
      if (rawSource === undefined) return { status: "not-found" };

      const source = loadCompositionRecord(rawSource);
      if (source.status !== "loaded") {
        throw persistenceError(
          "delete",
          "validation",
          "Composer storage contains a source record that cannot be deleted safely.",
          false,
        );
      }
      if (source.record.document.publication?.kind === "global-template") {
        const dependents = this.dependentsFromRecords(rawRecords, source.record.id);
        if (dependents.length > 0) return { status: "blocked", dependents };
      }
      await requestResult(store.delete(id));
      return { status: "deleted" };
    });
  }

  /**
   * Publication removal follows the same transaction discipline as deletion.
   * Pattern/ordinary records have no consumers, while a Global template is
   * rechecked immediately before the one-record replacement is queued.
   */
  async unpublishWithDependencyCheck(id: string): Promise<CompositionUnpublishOutcome> {
    return this.run("put", "readwrite", async (store) => {
      const sourceRequest = store.get(id);
      const recordsRequest = store.getAll();
      const [rawSource, rawRecords] = await Promise.all([
        requestResult(sourceRequest),
        requestResult(recordsRequest) as Promise<CompositionRecord[]>,
      ]);
      if (rawSource === undefined) return { status: "not-found" };

      const source = loadCompositionRecord(rawSource);
      if (source.status !== "loaded") {
        throw persistenceError(
          "put",
          "validation",
          "Composer storage contains a source record that cannot be unpublished safely.",
          false,
        );
      }
      const publication = source.record.document.publication;
      if (publication === undefined) return { status: "not-published" };
      if (publication.kind === "global-template") {
        const dependents = this.dependentsFromRecords(rawRecords, source.record.id);
        if (dependents.length > 0) return { status: "blocked", dependents };
      }

      const document = cloneJson(source.record.document);
      delete document.publication;
      const next: CompositionRecord = {
        ...source.record,
        updatedAt: this.runtime.now(),
        document,
      };
      const validation = validateCompositionRecord(next);
      if (!validation.ok) {
        throw persistenceError("put", "validation", validation.issue.message, false);
      }
      await requestResult(store.put(validation.record));
      return { status: "unpublished" };
    });
  }

  /** IndexedDB commits the one replacement record atomically with its transaction. */
  async saveLifecycleRecord(record: CompositionRecord): Promise<void> {
    await this.put(record);
  }

  async clear(): Promise<void> {
    await this.run("clear", "readwrite", async (store) => {
      const records = await requestResult(store.getAll()) as CompositionRecord[];
      for (const raw of records) {
        const source = loadCompositionRecord(raw);
        if (source.status !== "loaded") {
          throw persistenceError(
            "clear",
            "validation",
            "Composer storage contains a record that cannot be cleared safely.",
            false,
          );
        }
        if (source.record.document.publication?.kind !== "global-template") continue;
        const dependents = this.dependentsFromRecords(records, source.record.id);
        if (dependents.length > 0) {
          throw persistenceError(
            "clear",
            "blocked",
            "Cannot clear Composer storage while a Global template still has bound consumers. Detach or remove bindings individually first.",
            false,
          );
        }
      }
      await requestResult(store.clear());
    });
  }

  async forceClear(): Promise<void> {
    await this.run("clear", "readwrite", async (store) => {
      await requestResult(store.clear());
    });
  }

  private dependentsFromRecords(
    records: readonly CompositionRecord[],
    sourceRecordId: string,
  ): CompositionDependent[] {
    const dependents: CompositionDependent[] = [];
    for (const raw of records) {
      const loaded = loadCompositionRecord(raw);
      if (loaded.status !== "loaded") {
        throw persistenceError(
          "delete",
          "validation",
          "Composer storage contains a record that prevents dependency-safe source mutation.",
          false,
        );
      }
      if (loaded.record.id === sourceRecordId || loaded.record.document.binding?.sourceRecordId !== sourceRecordId) {
        continue;
      }
      const dependent = dependentFromRecord(loaded.record);
      if (dependent) dependents.push(dependent);
    }
    return dependents.sort((a, b) => compareCompositionSummariesNewestFirst(a.summary, b.summary));
  }

  /**
   * A new/changing binding is a relationship creation, not an ordinary draft
   * save. Validate it in the same transaction that writes the consumer so a
   * consumer queued behind a successful source deletion cannot commit an
   * orphan. Existing bindings intentionally remain saveable when their source
   * is externally unavailable; those use the explicit broken-binding flow.
   */
  private async assertBindingTransition(store: IDBObjectStore, next: CompositionRecord): Promise<void> {
    const binding = next.document.binding;
    if (!binding) return;

    const rawPrevious = await requestResult(store.get(next.id));
    if (rawPrevious !== undefined) {
      const previous = loadCompositionRecord(rawPrevious);
      if (previous.status !== "loaded") {
        throw persistenceError(
          "put",
          "validation",
          "Composer storage contains a consumer record that cannot be updated safely.",
          false,
        );
      }
      const priorBinding = previous.record.document.binding;
      if (
        priorBinding?.sourceRecordId === binding.sourceRecordId
        && priorBinding.outletId === binding.outletId
      ) {
        return;
      }
    }

    if (binding.sourceRecordId === next.id) {
      throw persistenceError("put", "conflict", "A Composition cannot bind to itself as a Global template.", false);
    }
    const rawSource = await requestResult(store.get(binding.sourceRecordId));
    if (rawSource === undefined) {
      throw persistenceError(
        "put",
        "conflict",
        "The selected Global template is no longer available. Refresh the template list and try again.",
        true,
      );
    }
    const source = loadCompositionRecord(rawSource);
    if (
      source.status !== "loaded"
      || source.record.document.binding !== undefined
      || source.record.document.publication?.kind !== "global-template"
      || source.record.document.publication.outlet.id !== binding.outletId
    ) {
      throw persistenceError(
        "put",
        "conflict",
        "The selected Global template changed before this consumer could be saved.",
        true,
      );
    }
  }

  private async run<T>(
    operation: CompositionPersistenceOperation,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const connection = await this.runtime.open(operation);
    if (connection.invalidated) {
      throw persistenceError(
        operation,
        "versionchange",
        "Composer storage changed version in another context. Retry to reopen it.",
        true,
      );
    }
    let transaction: IDBTransaction;
    try {
      transaction = connection.db.transaction(COMPOSITIONS_STORE_NAME, mode);
    } catch (error) {
      throw mapOperationalError(operation, mode, error);
    }
    const done = transactionComplete(transaction);
    try {
      const value = await action(transaction.objectStore(COMPOSITIONS_STORE_NAME));
      await done;
      return value;
    } catch (error) {
      void done.catch(() => undefined);
      throw mapOperationalError(operation, mode, error);
    }
  }
}


export function createIndexedDbCompositionProvider(
  options: IndexedDbCompositionProviderOptions,
): CompositionProvider {
  const runtime = new IndexedDbProviderRuntime(options);
  const store = new IndexedDbCompositionStore(runtime);

  const initialize = async (): Promise<CompositionInitializationOutcome> => {
    try {
      await runtime.open("initialize");
      const scanned = await store.initializationOutcome();
      if (scanned.status !== "ready" || await store.hasInitializationMeta()) return scanned;
      const seed = runtime.createSeedRecords();
      await store.seed(seed);
      await store.markInitialized(seed[0]?.id ?? "empty-seed");
      return store.initializationOutcome();
    } catch (error) {
      return {
        status: "error",
        error:
          error instanceof CompositionPersistenceError
            ? error
            : persistenceError("initialize", "unknown", "Composer storage initialization failed.", true, error),
      };
    }
  };

  return {
    descriptor: COMPOSITION_PROVIDERS.indexeddb,
    store,
    initialization: {
      initialize,
      retry: async () => {
        runtime.prepareRetry();
        return initialize();
      },
      startFresh: async () => {
        try {
          await store.forceClear();
          const seed = runtime.createSeedRecords();
          await store.seed(seed);
          await store.markInitialized(seed[0]?.id ?? "empty-seed");
          return { status: "ready", summaries: await store.list() };
        } catch (error) {
          return {
            status: "error",
            error:
              error instanceof CompositionPersistenceError
                ? error
                : persistenceError("initialize", "unknown", "Starting fresh failed.", true, error),
          };
        }
      },
    },
  };
}
