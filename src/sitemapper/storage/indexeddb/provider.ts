import { SITEMAP_PROVIDERS, SitemapPersistenceError } from "../../library";
import type {
  SitemapInitializationOutcome,
  SitemapPersistenceErrorCode,
  SitemapPersistenceOperation,
  SitemapProvider,
  SitemapRecoveryOutcome,
} from "../../library";
import { SITEMAP_SCHEMA_VERSION } from "../../model";
import { IndexedDbSitemapStore } from "./store";
import {
  META_STORE_NAME,
  SITEMAPPER_DATABASE_NAME,
  SITEMAPPER_DATABASE_VERSION,
  SITEMAPPER_META_KEYS,
  SITEMAPS_STORE_NAME,
  UPDATED_AT_INDEX_NAME,
} from "./types";
import type { IndexedDbSitemapProviderOptions, SitemapSchemaMeta } from "./types";

export function sitemapPersistenceError(
  operation: SitemapPersistenceOperation,
  code: SitemapPersistenceErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): SitemapPersistenceError {
  return new SitemapPersistenceError(operation, code, message, retryable, { cause });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error ?? new DOMException("IndexedDB transaction aborted.", "AbortError"),
    );
    transaction.onerror = () => {
      // The abort event is terminal and carries the useful transaction error.
    };
  });
}

function errorName(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("name" in value)) return undefined;
  return typeof value.name === "string" ? value.name : undefined;
}

export function mapSitemapOperationalError(
  operation: SitemapPersistenceOperation,
  mode: IDBTransactionMode,
  error: unknown,
): SitemapPersistenceError {
  if (error instanceof SitemapPersistenceError) return error;
  const aborted = errorName(error) === "AbortError";
  return sitemapPersistenceError(
    operation,
    aborted ? "transaction-failed" : mode === "readonly" ? "read-failed" : "write-failed",
    aborted
      ? `IndexedDB ${operation} transaction was aborted.`
      : `IndexedDB ${operation} request failed.`,
    true,
    error,
  );
}

export interface SitemapOpenConnection {
  db: IDBDatabase;
  invalidated: boolean;
}

export class IndexedDbSitemapRuntime {
  readonly factory: IDBFactory | null | undefined;
  private connection: SitemapOpenConnection | undefined;
  private opening: Promise<SitemapOpenConnection> | undefined;

  constructor(options: IndexedDbSitemapProviderOptions) {
    this.factory = options.idbFactory === undefined
      ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
      : options.idbFactory;
  }

  async open(operation: SitemapPersistenceOperation): Promise<SitemapOpenConnection> {
    if (this.connection) {
      if (this.connection.invalidated) {
        throw sitemapPersistenceError(
          operation,
          "versionchange",
          "Sitemapper storage was closed because another context changed its database version.",
          true,
        );
      }
      return this.connection;
    }
    if (!this.factory) {
      throw sitemapPersistenceError(
        operation,
        "unavailable",
        "IndexedDB is unavailable in this browser context.",
        true,
      );
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

  private openDatabase(): Promise<SitemapOpenConnection> {
    return new Promise<SitemapOpenConnection>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.open(SITEMAPPER_DATABASE_NAME, SITEMAPPER_DATABASE_VERSION);
      } catch (error) {
        reject(sitemapPersistenceError(
          "initialize",
          "unavailable",
          "IndexedDB could not be opened.",
          true,
          error,
        ));
        return;
      }

      let settled = false;
      let upgradeFailure: SitemapPersistenceError | undefined;
      request.onupgradeneeded = (event) => {
        const transaction = request.transaction;
        try {
          if (!transaction) {
            throw sitemapPersistenceError(
              "initialize",
              "transaction-failed",
              "IndexedDB did not provide an upgrade transaction.",
              true,
            );
          }
          if (event.oldVersion !== 0) {
            throw sitemapPersistenceError(
              "initialize",
              "unsupported-version",
              `Sitemapper database version ${event.oldVersion} is not supported by this clean build.`,
              false,
            );
          }
          const sitemaps = request.result.createObjectStore(SITEMAPS_STORE_NAME, { keyPath: "id" });
          sitemaps.createIndex(UPDATED_AT_INDEX_NAME, "updatedAt", { unique: false });
          const meta = request.result.createObjectStore(META_STORE_NAME, { keyPath: "key" });
          meta.put({
            key: SITEMAPPER_META_KEYS.schema,
            databaseVersion: SITEMAPPER_DATABASE_VERSION,
            recordSchemaVersion: SITEMAP_SCHEMA_VERSION,
          } satisfies SitemapSchemaMeta);
        } catch (error) {
          upgradeFailure = error instanceof SitemapPersistenceError
            ? error
            : sitemapPersistenceError(
                "initialize",
                "transaction-failed",
                "Sitemapper database initialization failed.",
                true,
                error,
              );
          try {
            transaction?.abort();
          } catch {
            // The transaction may already have aborted.
          }
        }
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(sitemapPersistenceError(
          "initialize",
          "blocked",
          "Sitemapper storage is blocked by another open context. Close it and retry.",
          true,
        ));
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        if (upgradeFailure) return reject(upgradeFailure);
        if (request.error?.name === "VersionError") {
          reject(sitemapPersistenceError(
            "initialize",
            "unsupported-version",
            "This Sitemapper database was created by a newer application version.",
            false,
            request.error,
          ));
          return;
        }
        reject(sitemapPersistenceError(
          "initialize",
          "transaction-failed",
          "Sitemapper database opening failed.",
          true,
          request.error,
        ));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        const connection = { db, invalidated: false };
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

function recoveryFromScan(
  scan: Awaited<ReturnType<IndexedDbSitemapStore["scanForInitialization"]>>,
): SitemapRecoveryOutcome {
  const future = scan.failures.find((failure) => failure.outcome.status === "future-schema");
  return {
    kind: "quarantined",
    reason: future ? "future-schema" : "invalid",
    sourcePreserved: true,
    affectedRecordIds: scan.failures.map((failure) => failure.id),
    ...(future?.outcome.status === "future-schema"
      ? { foundSchemaVersion: future.outcome.foundSchemaVersion }
      : {}),
    message: future
      ? "Stored Sitemap data uses a newer schema and remains unchanged. Start fresh only if deleting it is intentional."
      : "Stored Sitemap data is invalid and remains unchanged. Start fresh only if deleting it is intentional.",
  };
}

/** Creates the browser-only Sitemap provider. */
export function createIndexedDbSitemapProvider(
  options: IndexedDbSitemapProviderOptions = {},
): SitemapProvider & { descriptor: typeof SITEMAP_PROVIDERS.indexeddb } {
  const runtime = new IndexedDbSitemapRuntime(options);
  const store = new IndexedDbSitemapStore(runtime);

  const initialize = async (): Promise<SitemapInitializationOutcome> => {
    try {
      await runtime.open("initialize");
      const scan = await store.scanForInitialization();
      if (scan.failures.length === 0 && options.seed) await store.seed(options.seed);
      return scan.failures.length === 0
        ? { status: "ready", summaries: await store.list() }
        : {
            status: "recovery-required",
            summaries: scan.summaries,
            recovery: recoveryFromScan(scan),
          };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof SitemapPersistenceError
          ? error
          : sitemapPersistenceError(
              "initialize",
              "unknown",
              "Sitemapper storage initialization failed.",
              true,
              error,
            ),
      };
    }
  };

  return {
    descriptor: SITEMAP_PROVIDERS.indexeddb,
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
          if (options.seed) await store.seed(options.seed);
          return { status: "ready", summaries: await store.list() };
        } catch (error) {
          return {
            status: "error",
            error: error instanceof SitemapPersistenceError
              ? error
              : sitemapPersistenceError(
                  "initialize",
                  "unknown",
                  "Starting a fresh Sitemap library failed.",
                  true,
                  error,
                ),
          };
        }
      },
    },
  };
}
