import { advanceMutationToken, readMutationToken, notifyPersistenceChange, PersistenceGenerationError } from "../../../shared/persistence-generation";
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
import { SITEMAPS_STORE_NAME, META_STORE_NAME, SITEMAPPER_DATABASE_VERSION, SITEMAPPER_META_KEYS } from "./types";
import { SITEMAP_SCHEMA_VERSION } from "../../model";

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

  async mutationToken(): Promise<number> {
    return this.run("list", "readonly", (store) => readMutationToken(store.transaction));
  }

  async snapshot(): Promise<{ mutationToken: number; records: readonly SitemapRecord[] }> {
    return this.run("list", "readonly", async (store) => {
      const token = await readMutationToken(store.transaction);
      const raw = await requestResult(store.getAll()) as unknown[];
      const records = raw.map((value) => {
        const loaded = loadSitemapRecord(value);
        if (loaded.status !== "loaded") throw sitemapPersistenceError("list", "validation", "Invalid Sitemap snapshot.", false);
        return loaded.record;
      });
      return { mutationToken: token, records };
    });
  }

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

  async readAll(): Promise<readonly SitemapRecord[]> {
    const records = await this.run("list", "readonly", (store) => requestResult(store.getAll()) as Promise<unknown[]>);
    return records.map((raw) => {
      const loaded = loadSitemapRecord(raw);
      if (loaded.status !== "loaded") throw sitemapPersistenceError("list", "validation", "Sitemapper storage contains a record that cannot be snapshotted safely.", false);
      return structuredClone(loaded.record);
    });
  }

  async seed(records: readonly SitemapRecord[]): Promise<void> {
    const validated: SitemapRecord[] = [];
    const ids = new Set<string>();
    for (const record of records) {
      const result = validateSitemapRecord(record);
      if (!result.ok) throw sitemapPersistenceError("put", "validation", result.issue.message, false);
      if (ids.has(result.record.id)) throw sitemapPersistenceError("put", "validation", `Duplicate seed Sitemap id "${result.record.id}".`, false);
      ids.add(result.record.id);
      validated.push(result.record);
    }
    await this.run("put", "readwrite", async (store) => {
      for (const record of validated) {
        const existing = await requestResult(store.get(record.id));
        if (existing === undefined) await requestResult(store.add(structuredClone(record)));
        else if (loadSitemapRecord(existing).status !== "loaded") throw sitemapPersistenceError("put", "validation", "Invalid Sitemap data was preserved. Use startFresh to discard it explicitly.", false);
      }
    });
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
      transaction = connection.db.transaction([SITEMAPS_STORE_NAME, META_STORE_NAME], mode);
    } catch (error) {
      throw mapSitemapOperationalError(operation, mode, error);
    }
    const done = transactionComplete(transaction);
    try {
      const metaRecords = await requestResult(transaction.objectStore(META_STORE_NAME).getAll()) as unknown[];
      const schema = metaRecords.find((value) => value && typeof value === "object" && "key" in value && value.key === SITEMAPPER_META_KEYS.schema);
      const mutation = metaRecords.find((value) => value && typeof value === "object" && "key" in value && value.key === "mutation");
      if (metaRecords.length !== 2 || !schema || typeof schema !== "object" || Object.keys(schema).sort().join(",") !== "databaseVersion,key,recordSchemaVersion" || !("databaseVersion" in schema) || schema.databaseVersion !== SITEMAPPER_DATABASE_VERSION || !("recordSchemaVersion" in schema) || schema.recordSchemaVersion !== SITEMAP_SCHEMA_VERSION || !mutation || Object.keys(mutation).sort().join(",") !== "key,token") {
        throw sitemapPersistenceError(operation, "unsupported-version", "Sitemap database metadata is missing or unsupported. The source was preserved; explicit reset is required.", false);
      }
      await readMutationToken(transaction);
      const result = await action(transaction.objectStore(SITEMAPS_STORE_NAME));
      if (mode === "readwrite") await advanceMutationToken(transaction);
      await done;
      if (mode === "readwrite") notifyPersistenceChange(connection.db.name);
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already completed. */ }
      void done.catch(() => undefined);
      if (error instanceof PersistenceGenerationError) throw sitemapPersistenceError(operation, error.code, error.message, false);
      throw mapSitemapOperationalError(operation, mode, error);
    }
  }
}
