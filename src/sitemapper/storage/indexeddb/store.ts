import {
  compareSitemapSummariesNewestFirst,
  loadSitemapRecord,
  summarizeSitemap,
  validateSitemapRecord,
} from "../../library";
import type {
  SitemapRecordLoadOutcome,
  SitemapPersistenceOperation,
  SitemapRecord,
  SitemapStore,
  SitemapSummary,
} from "../../library";
import type { IndexedDbSitemapRuntime } from "./provider";
import {
  mapSitemapOperationalError,
  requestResult,
  sitemapPersistenceError,
  transactionComplete,
} from "./provider";
import { SITEMAPS_STORE_NAME } from "./types";

interface InitializationFailure {
  id: string;
  outcome: Extract<SitemapRecordLoadOutcome, { status: "invalid" | "future-schema" }>;
}

export interface SitemapInitializationScan {
  summaries: readonly SitemapSummary[];
  failures: readonly InitializationFailure[];
}

export class IndexedDbSitemapStore implements SitemapStore {
  constructor(private readonly runtime: IndexedDbSitemapRuntime) {}

  async list(): Promise<readonly SitemapSummary[]> {
    const scan = await this.scan("list");
    if (scan.failures.length > 0) {
      throw sitemapPersistenceError(
        "list",
        "validation",
        "Sitemapper storage contains records that cannot be listed safely.",
        false,
      );
    }
    return scan.summaries;
  }

  async get(id: string): Promise<SitemapRecordLoadOutcome> {
    const raw = await this.run("get", "readonly", (store) => requestResult(store.get(id)));
    // Re-validation here is intentional even when a previous list succeeded.
    return raw === undefined ? { status: "not-found", id } : loadSitemapRecord(raw);
  }

  async put(record: SitemapRecord): Promise<void> {
    const validation = validateSitemapRecord(record);
    if (!validation.ok) {
      throw sitemapPersistenceError("put", "validation", validation.issue.message, false);
    }
    await this.run("put", "readwrite", async (store) => {
      await requestResult(store.put(validation.record));
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.run("delete", "readwrite", async (store) => {
      const raw = await requestResult(store.get(id));
      if (raw === undefined) return false;
      // Never perform a destructive operation on a record whose envelope can
      // no longer be proven to match the requested key.
      const loaded = loadSitemapRecord(raw);
      if (loaded.status !== "loaded") {
        throw sitemapPersistenceError(
          "delete",
          "validation",
          "The stored Sitemap record is invalid and was preserved.",
          false,
        );
      }
      await requestResult(store.delete(id));
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.run("clear", "readwrite", async (store) => {
      const records = await requestResult(store.getAll());
      for (const record of records) {
        if (loadSitemapRecord(record).status !== "loaded") {
          throw sitemapPersistenceError(
            "clear",
            "validation",
            "Sitemapper storage contains invalid data and was preserved.",
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

  async scanForInitialization(): Promise<SitemapInitializationScan> {
    return this.scan("initialize");
  }

  private async scan(operation: "initialize" | "list"): Promise<SitemapInitializationScan> {
    const records = await this.run(operation, "readonly", (store) => requestResult(store.getAll()));
    const summaries: SitemapSummary[] = [];
    const failures: InitializationFailure[] = [];
    for (let index = 0; index < records.length; index += 1) {
      const raw = records[index];
      const loaded = loadSitemapRecord(raw);
      if (loaded.status === "loaded") {
        summaries.push(summarizeSitemap(loaded.record));
        continue;
      }
      if (loaded.status === "not-found") continue;
      const id = raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string"
        ? raw.id
        : `unknown-${index + 1}`;
      failures.push({ id, outcome: loaded });
    }
    return { summaries: summaries.sort(compareSitemapSummariesNewestFirst), failures };
  }

  private async run<T>(
    operation: SitemapPersistenceOperation,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const connection = await this.runtime.open(operation);
    if (connection.invalidated) {
      throw sitemapPersistenceError(
        operation,
        "versionchange",
        "Sitemapper storage changed version in another context. Retry to reopen it.",
        true,
      );
    }
    let transaction: IDBTransaction;
    try {
      transaction = connection.db.transaction(SITEMAPS_STORE_NAME, mode);
    } catch (error) {
      throw mapSitemapOperationalError(operation, mode, error);
    }
    const done = transactionComplete(transaction);
    try {
      const result = await action(transaction.objectStore(SITEMAPS_STORE_NAME));
      await done;
      return result;
    } catch (error) {
      void done.catch(() => undefined);
      throw mapSitemapOperationalError(operation, mode, error);
    }
  }
}
