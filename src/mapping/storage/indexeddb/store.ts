import { isSafeRecordId } from "../../../shared";
import { advanceMutationToken, readMutationToken, notifyPersistenceChange, PersistenceGenerationError } from "../../../shared/persistence-generation";
import { decodeMappingRecord, MAPPING_PROVIDERS, summarizeMapping, validateMappingRecord } from "../../model";
import { MAPPING_SCHEMA_VERSION } from "../../model";
import type { MappingLoadOutcome, MappingRecord, MappingSeed, MappingStore, MappingSummary, MappingPersistenceOperation } from "../../model";
import { mapMappingOperationalError, mappingPersistenceError, requestResult, transactionComplete, type IndexedDbMappingRuntime } from "./provider";
import { MAPPING_DATABASE_VERSION, MAPPING_META_KEYS, MAPPING_META_STORE_NAME, MAPPING_RECORDS_STORE_NAME } from "./types";

export class IndexedDbMappingStore implements MappingStore {
  readonly provider = MAPPING_PROVIDERS.indexeddb;
  constructor(private readonly runtime: IndexedDbMappingRuntime) {}
  private async run<T>(operation: MappingPersistenceOperation, mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const connection = await this.runtime.open(operation);
    const tx = connection.db.transaction([MAPPING_RECORDS_STORE_NAME, MAPPING_META_STORE_NAME], mode);
    const done = transactionComplete(tx);
    try {
      const value = await action(tx.objectStore(MAPPING_RECORDS_STORE_NAME));
      if (mode === "readwrite") await advanceMutationToken(tx, MAPPING_META_STORE_NAME);
      await done;
      if (mode === "readwrite") notifyPersistenceChange(connection.db.name);
      return value;
    } catch (error) {
      try { tx.abort(); } catch { /* Already settled. */ }
      void done.catch(() => undefined);
      if (error instanceof PersistenceGenerationError) throw mappingPersistenceError(operation, error.code, error.message, false);
      throw mapMappingOperationalError(operation, mode, error);
    }
  }
  async mutationToken(): Promise<number> { return this.run("list", "readonly", (store) => readMutationToken(store.transaction, MAPPING_META_STORE_NAME)); }
  async snapshot(): Promise<{ mutationToken: number; records: readonly MappingRecord[] }> {
    return this.run("list", "readonly", async (store) => ({ mutationToken: await readMutationToken(store.transaction, MAPPING_META_STORE_NAME), records: (await requestResult(store.getAll()) as unknown[]).map((raw) => this.decode(raw, "list")) }));
  }
  private decode(raw: unknown, operation: MappingPersistenceOperation): MappingRecord {
    const result = decodeMappingRecord(raw);
    if (result.status !== "loaded") throw mappingPersistenceError(operation, "validation", "Invalid Mapping data was preserved. Use explicit recovery.", false);
    return structuredClone(result.record);
  }
  async readAll(): Promise<readonly MappingRecord[]> { return (await this.snapshot()).records; }
  async list(): Promise<readonly MappingSummary[]> {
    const scan = await this.scanForInitialization("list");
    if (scan.failures.length) throw mappingPersistenceError("list", "validation", "Mapping storage contains records that cannot be listed safely.", false);
    return scan.summaries;
  }
  async get(id: string): Promise<MappingLoadOutcome> {
    if (!isSafeRecordId(id)) return { status: "not-found", id };
    return this.run("get", "readonly", async (store) => { const raw = await requestResult(store.get(id)); return raw === undefined ? { status: "not-found", id } : decodeMappingRecord(raw); });
  }
  async put(record: MappingRecord): Promise<void> {
    const validation = validateMappingRecord(record);
    if (!validation.ok) throw mappingPersistenceError("put", "validation", validation.issue.message, false);
    record = structuredClone(record);
    await this.run("put", "readwrite", async (store) => {
      const raw = await requestResult(store.get(record.id));
      if (raw !== undefined && this.decode(raw, "put").createdAt !== record.createdAt) throw mappingPersistenceError("put", "validation", "Mapping createdAt is immutable after persistence.", false);
      store.put(record);
    });
  }
  async delete(id: string): Promise<boolean> {
    if (!isSafeRecordId(id)) return false;
    return this.run("delete", "readwrite", async (store) => { const raw = await requestResult(store.get(id)); if (raw === undefined) return false; this.decode(raw, "delete"); store.delete(id); return true; });
  }
  async seed(seed: MappingSeed): Promise<void> {
    for (const record of seed.mappings) { const result = validateMappingRecord(record); if (!result.ok) throw mappingPersistenceError("seed", "validation", result.issue.message, false); }
    seed = structuredClone(seed);
    await this.run("seed", "readwrite", async (store) => { for (const record of seed.mappings) { const raw = await requestResult(store.get(record.id)); if (raw === undefined) store.put(record); else this.decode(raw, "seed"); } });
  }
  async clear(): Promise<void> { await this.run("clear", "readwrite", async (store) => { for (const raw of await requestResult(store.getAll())) this.decode(raw, "clear"); store.clear(); }); }
  async scanForInitialization(operation: "list" | "initialize" = "initialize"): Promise<{ summaries: MappingSummary[]; failures: { id: string; status: "invalid" | "future-schema"; version?: number }[] }> {
    return this.run(operation, "readonly", async (store) => {
      const values = await requestResult(store.getAll()) as unknown[];
      const metaRecords = await requestResult(store.transaction.objectStore(MAPPING_META_STORE_NAME).getAll()) as unknown[];
      const meta = metaRecords.find((value) => (value as { key?: unknown })?.key === MAPPING_META_KEYS.schema);
      if (metaRecords.length !== 2 || !meta || typeof meta !== "object" || Object.keys(meta).sort().join(",") !== "databaseVersion,key,mappingRecordSchemaVersion" || (meta as { databaseVersion?: unknown }).databaseVersion !== MAPPING_DATABASE_VERSION || (meta as { mappingRecordSchemaVersion?: unknown }).mappingRecordSchemaVersion !== MAPPING_SCHEMA_VERSION) throw mappingPersistenceError(operation, "unsupported-version", "Mapping database schema metadata is missing or unsupported.", false);
      await readMutationToken(store.transaction, MAPPING_META_STORE_NAME);
      const summaries: MappingSummary[] = [];
      const failures: { id: string; status: "invalid" | "future-schema"; version?: number }[] = [];
      values.forEach((raw, index) => { const decoded = decodeMappingRecord(raw); if (decoded.status === "loaded") summaries.push(summarizeMapping(decoded.record)); else if (decoded.status !== "not-found") failures.push({ id: raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : `unknown-${index + 1}`, status: decoded.status, ...(decoded.status === "future-schema" ? { version: decoded.foundSchemaVersion } : {}) }); });
      return { summaries: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), failures };
    });
  }
}
