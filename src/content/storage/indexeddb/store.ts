import {
  CONTENT_PROVIDERS,
  compareContentModelsNewestFirst,
  diagnoseContentEntryCompleteness,
  summarizeContentModel,
} from "../../library";
import type {
  ContentEntryPage,
  ContentEntrySnapshot,
  ContentModelSummary,
  ContentPageOptions,
  ContentPersistenceOperation,
  ContentSeed,
  ContentStore,
} from "../../library";
import {
  isCanonicalContentTimestamp,
  isValueValidForField,
  loadContentEntryRecord,
  loadContentModelRecord,
  validateContentEntryRecord,
  validateContentModelRecord,
} from "../../model";
import type { ContentEntryRecord, ContentLoadOutcome, ContentModelRecord } from "../../model";
import { isSafeRecordId } from "../../../shared";
import {
  contentPersistenceError,
  mapContentOperationalError,
  requestResult,
  transactionComplete,
} from "./provider";
import type { IndexedDbContentRuntime } from "./provider";
import {
  CONTENT_DATABASE_VERSION,
  CONTENT_ENTRIES_STORE_NAME,
  CONTENT_ENTRY_MODEL_CREATED_AT_INDEX,
  CONTENT_ENTRY_MODEL_INDEX,
  CONTENT_META_KEYS,
  CONTENT_META_STORE_NAME,
  CONTENT_MODELS_STORE_NAME,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CURSOR_PREFIX = "content-entry-v1:";

interface CursorTuple { createdAt: string; id: string }
export interface ContentInitializationFailure { id: string; status: "invalid" | "future-schema"; version?: number }
export interface ContentInitializationScan { models: readonly ContentModelSummary[]; failures: readonly ContentInitializationFailure[] }

function encodeCursor(entry: ContentEntryRecord): string {
  return `${CURSOR_PREFIX}${encodeURIComponent(entry.createdAt)}:${encodeURIComponent(entry.id)}`;
}

function decodeCursor(value: string | undefined): CursorTuple | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith(CURSOR_PREFIX)) throw contentPersistenceError("page-entries", "invalid-cursor", "Entry cursor is invalid.", false);
  const parts = value.slice(CURSOR_PREFIX.length).split(":");
  if (parts.length !== 2) throw contentPersistenceError("page-entries", "invalid-cursor", "Entry cursor is invalid.", false);
  try {
    const [createdAt, id] = parts.map(decodeURIComponent);
    if (!createdAt || !isSafeRecordId(id) || new Date(createdAt).toISOString() !== createdAt) throw new Error("invalid");
    return { createdAt, id };
  } catch (error) {
    throw contentPersistenceError("page-entries", "invalid-cursor", "Entry cursor is invalid.", false, error);
  }
}

function cursorRecords(
  request: IDBRequest<IDBCursorWithValue | null>,
  modelId: string,
  cursor?: CursorTuple,
  limit?: number,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const records: unknown[] = [];
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed."));
    request.onsuccess = () => {
      const current = request.result;
      if (!current || (limit !== undefined && records.length >= limit)) { resolve(records); return; }
      const value = current.value as { modelId?: unknown; createdAt?: unknown; id?: unknown };
      const isOlder = !cursor
        || (typeof value.createdAt === "string" && typeof value.id === "string"
          && (value.createdAt < cursor.createdAt
            || (value.createdAt === cursor.createdAt && value.id < cursor.id)));
      if (value.modelId === modelId && isOlder) records.push(current.value);
      current.continue();
    };
  });
}

function loadedModel(raw: unknown, operation: ContentPersistenceOperation): ContentModelRecord {
  if (raw === undefined) throw contentPersistenceError(operation, "not-found", "Content model was not found.", false);
  const loaded = loadContentModelRecord(raw);
  if (loaded.status !== "loaded") throw contentPersistenceError(operation, "validation", "The stored Content model is invalid and was preserved.", false);
  return loaded.record;
}

function loadedEntries(rawRecords: readonly unknown[], operation: ContentPersistenceOperation): ContentEntryRecord[] {
  return rawRecords.map((raw) => {
    const loaded = loadContentEntryRecord(raw);
    if (loaded.status !== "loaded") throw contentPersistenceError(operation, "validation", "Content storage contains an invalid Entry and it was preserved.", false);
    return loaded.record;
  });
}

function validateEntryAgainstModel(entry: ContentEntryRecord, model: ContentModelRecord, operation: ContentPersistenceOperation): void {
  const issue = entrySemanticIssue(entry, model);
  if (issue) throw contentPersistenceError(operation, "validation", issue, false);
}

function entrySemanticIssue(entry: ContentEntryRecord, model: ContentModelRecord): string | undefined {
  if (entry.modelId !== model.id) return `Entry refers to missing model "${entry.modelId}".`;
  const fields = new Map(model.document.fields.map((field) => [field.id, field]));
  for (const [fieldId, value] of Object.entries(entry.values)) {
    const field = fields.get(fieldId);
    if (!field) return `Entry value refers to unknown field "${fieldId}".`;
    if (!isValueValidForField(field, value)) return `Entry value for field "${field.key}" does not match ${field.kind}.`;
  }
  return undefined;
}

export class IndexedDbContentStore implements ContentStore {
  readonly provider = CONTENT_PROVIDERS.indexeddb;
  constructor(private readonly runtime: IndexedDbContentRuntime) {}

  async listModels(): Promise<readonly ContentModelSummary[]> {
    const scan = await this.scanForInitialization("list-models");
    if (scan.failures.length) throw contentPersistenceError("list-models", "validation", "Content storage contains records that cannot be listed safely.", false);
    return scan.models;
  }

  async getModel(id: string): Promise<ContentLoadOutcome<ContentModelRecord>> {
    const raw = await this.run("get-model", "readonly", [CONTENT_MODELS_STORE_NAME], (tx) => requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(id)));
    return raw === undefined ? { status: "not-found", id } : loadContentModelRecord(raw);
  }

  async putModel(record: ContentModelRecord): Promise<void> {
    const validation = validateContentModelRecord(record);
    if (!validation.ok) throw contentPersistenceError("put-model", "validation", validation.issue.message, false);
    await this.run("put-model", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const models = tx.objectStore(CONTENT_MODELS_STORE_NAME);
      const entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_INDEX);
      const existingRaw = await requestResult(models.get(record.id));
      if (existingRaw !== undefined) {
        const existing = loadedModel(existingRaw, "put-model");
        const storedEntries = loadedEntries(await requestResult(entries.getAll(record.id)), "put-model");
        for (const entry of storedEntries) validateEntryAgainstModel(entry, existing, "put-model");
        if (existing.createdAt !== record.createdAt) throw contentPersistenceError("put-model", "validation", "Content model createdAt is immutable after persistence.", false);
        if (existing.document.kind !== record.document.kind) throw contentPersistenceError("put-model", "immutable-kind", "Content model kind is immutable after persistence.", false);
        const nextFields = new Map(record.document.fields.map((field) => [field.id, field]));
        for (const oldField of existing.document.fields) {
          const next = nextFields.get(oldField.id);
          if (!next) throw contentPersistenceError("put-model", "field-removal-required", "Fields must be removed through the destructive removeField operation.", false);
          if (next.kind !== oldField.kind) {
            if (storedEntries.some((entry) => Object.hasOwn(entry.values, oldField.id))) throw contentPersistenceError("put-model", "field-in-use", `Field "${oldField.key}" kind is immutable because an Entry stores a value for it.`, false);
          }
        }
      }
      await requestResult(models.put(validation.value));
    });
  }

  async deleteModel(id: string): Promise<boolean> {
    return this.run("delete-model", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const models = tx.objectStore(CONTENT_MODELS_STORE_NAME);
      const raw = await requestResult(models.get(id));
      if (raw === undefined) return false;
      const model = loadedModel(raw, "delete-model");
      const entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_INDEX);
      const entryRecords = loadedEntries(await requestResult(entries.getAll(id)), "delete-model");
      for (const entry of entryRecords) validateEntryAgainstModel(entry, model, "delete-model");
      for (const entry of entryRecords) await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).delete(entry.id));
      await requestResult(models.delete(id));
      return true;
    });
  }

  async countEntries(modelId: string): Promise<number> {
    return this.run("count-entries", "readonly", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(modelId)), "count-entries");
      return requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_INDEX).count(modelId));
    });
  }

  async getEntry(id: string): Promise<ContentLoadOutcome<ContentEntryRecord>> {
    return this.run("get-entry", "readonly", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const raw = await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).get(id));
      if (raw === undefined) return { status: "not-found", id };
      const loaded = loadContentEntryRecord(raw);
      if (loaded.status !== "loaded") return loaded;
      const modelRaw = await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(loaded.record.modelId));
      const model = loadContentModelRecord(modelRaw);
      const semanticIssue = model.status === "loaded" ? entrySemanticIssue(loaded.record, model.record) : `Entry refers to unreadable or missing model "${loaded.record.modelId}".`;
      return semanticIssue ? { status: "invalid", issue: { code: "invalid-value", message: semanticIssue }, raw } : loaded;
    });
  }

  async pageEntries(modelId: string, options: ContentPageOptions = {}): Promise<ContentEntryPage> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw contentPersistenceError("page-entries", "validation", `Page limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`, false);
    const cursor = decodeCursor(options.cursor);
    const range = this.runtime.keyRangeFactory?.bound([modelId], cursor ? [modelId, cursor.createdAt, cursor.id] : [modelId, "\uffff", "\uffff"], false, cursor !== undefined);
    const { raw, model } = await this.run("page-entries", "readonly", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => ({
      model: loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(modelId)), "page-entries"),
      raw: await cursorRecords(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_CREATED_AT_INDEX).openCursor(range, "prev"), modelId, cursor, limit + 1),
    }));
    const entries = loadedEntries(raw, "page-entries");
    for (const entry of entries) validateEntryAgainstModel(entry, model, "page-entries");
    const hasMore = entries.length > limit;
    const page = entries.slice(0, limit);
    return { entries: page, ...(hasMore ? { nextCursor: encodeCursor(page[page.length - 1]!) } : {}) };
  }

  async scanEntries(modelId: string): Promise<ContentEntrySnapshot> {
    return this.run("scan-entries", "readonly", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const model = loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(modelId)), "scan-entries");
      const range = this.runtime.keyRangeFactory?.bound([modelId], [modelId, "\uffff", "\uffff"]);
      const raw = await cursorRecords(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_CREATED_AT_INDEX).openCursor(range, "prev"), modelId);
      const entries = loadedEntries(raw, "scan-entries");
      for (const entry of entries) validateEntryAgainstModel(entry, model, "scan-entries");
      return { model, count: entries.length, entries, diagnostics: entries.flatMap((entry) => diagnoseContentEntryCompleteness(model, entry)) };
    });
  }

  async putEntry(record: ContentEntryRecord): Promise<void> {
    const validation = validateContentEntryRecord(record);
    if (!validation.ok) throw contentPersistenceError("put-entry", "validation", validation.issue.message, false);
    await this.run("put-entry", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      const model = loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(record.modelId)), "put-entry");
      validateEntryAgainstModel(validation.value, model, "put-entry");
      if (model.document.kind === "single") {
        const existing = await requestResult(entries.get(record.id));
        const count = await requestResult(entries.index(CONTENT_ENTRY_MODEL_INDEX).count(record.modelId));
        if (existing === undefined && count > 0) throw contentPersistenceError("put-entry", "single-cardinality", "A Single model permits at most one Entry.", false);
        if (existing !== undefined) {
          const loaded = loadContentEntryRecord(existing);
          if (loaded.status !== "loaded" || loaded.record.modelId !== record.modelId) throw contentPersistenceError("put-entry", "single-cardinality", "Entry identity cannot be moved into a populated Single.", false);
        }
      }
      const existing = await requestResult(entries.get(record.id));
      if (existing !== undefined) {
        const loaded = loadContentEntryRecord(existing);
        if (loaded.status !== "loaded") throw contentPersistenceError("put-entry", "validation", "The stored Entry is invalid and was preserved.", false);
        if (loaded.record.modelId !== record.modelId) throw contentPersistenceError("put-entry", "validation", "Entry modelId is immutable after persistence.", false);
        if (loaded.record.createdAt !== record.createdAt) throw contentPersistenceError("put-entry", "validation", "Entry createdAt is immutable after persistence.", false);
      }
      await requestResult(entries.put(validation.value));
    });
  }

  async deleteEntry(id: string): Promise<boolean> {
    return this.run("delete-entry", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const store = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      const raw = await requestResult(store.get(id));
      if (raw === undefined) return false;
      const loaded = loadContentEntryRecord(raw);
      if (loaded.status !== "loaded") throw contentPersistenceError("delete-entry", "validation", "The stored Entry is invalid and was preserved.", false);
      const model = loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(loaded.record.modelId)), "delete-entry");
      validateEntryAgainstModel(loaded.record, model, "delete-entry");
      await requestResult(store.delete(id)); return true;
    });
  }

  async removeField(modelId: string, fieldId: string): Promise<void> {
    await this.run("remove-field", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const models = tx.objectStore(CONTENT_MODELS_STORE_NAME);
      const model = loadedModel(await requestResult(models.get(modelId)), "remove-field");
      if (!model.document.fields.some((field) => field.id === fieldId)) throw contentPersistenceError("remove-field", "not-found", "Content field was not found.", false);
      const rawEntries = await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).index(CONTENT_ENTRY_MODEL_INDEX).getAll(modelId));
      const entries = loadedEntries(rawEntries, "remove-field");
      for (const entry of entries) validateEntryAgainstModel(entry, model, "remove-field");
      const now = this.runtime.now();
      if (!isCanonicalContentTimestamp(now)) throw contentPersistenceError("remove-field", "validation", "The provider clock must return a canonical ISO timestamp.", false);
      const updatedAt = now < model.updatedAt ? model.updatedAt : now;
      const updatedModel: ContentModelRecord = { ...model, updatedAt, document: { ...model.document, fields: model.document.fields.filter((field) => field.id !== fieldId) } };
      for (const entry of entries) {
        if (!Object.hasOwn(entry.values, fieldId)) continue;
        const values = { ...entry.values }; delete values[fieldId];
        await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).put({ ...entry, updatedAt: now < entry.updatedAt ? entry.updatedAt : now, values }));
      }
      await requestResult(models.put(updatedModel));
    });
  }

  async seed(seed: ContentSeed): Promise<void> {
    const models = new Map<string, ContentModelRecord>();
    for (const model of seed.models) {
      const validation = validateContentModelRecord(model);
      if (!validation.ok) throw contentPersistenceError("seed", "validation", validation.issue.message, false);
      if (models.has(model.id)) throw contentPersistenceError("seed", "validation", `Duplicate seed model id "${model.id}".`, false);
      models.set(model.id, validation.value);
    }
    const entryIds = new Set<string>();
    const singleCounts = new Map<string, number>();
    for (const entry of seed.entries) {
      const validation = validateContentEntryRecord(entry);
      if (!validation.ok) throw contentPersistenceError("seed", "validation", validation.issue.message, false);
      if (entryIds.has(entry.id)) throw contentPersistenceError("seed", "validation", `Duplicate seed Entry id "${entry.id}".`, false);
      entryIds.add(entry.id);
      const model = models.get(entry.modelId);
      if (!model) throw contentPersistenceError("seed", "validation", `Seed Entry references missing model "${entry.modelId}".`, false);
      validateEntryAgainstModel(validation.value, model, "seed");
      if (model.document.kind === "single") {
        const count = (singleCounts.get(model.id) ?? 0) + 1; singleCounts.set(model.id, count);
        if (count > 1) throw contentPersistenceError("seed", "single-cardinality", "A Single seed permits at most one Entry.", false);
      }
    }
    await this.run("seed", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const modelStore = tx.objectStore(CONTENT_MODELS_STORE_NAME); const entryStore = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      for (const model of seed.models) {
        const existing = await requestResult(modelStore.get(model.id));
        if (existing === undefined) await requestResult(modelStore.add(model));
        else loadedModel(existing, "seed");
      }
      for (const entry of seed.entries) {
        const existing = await requestResult(entryStore.get(entry.id));
        if (existing !== undefined) {
          const loaded = loadContentEntryRecord(existing);
          if (loaded.status !== "loaded" || loaded.record.modelId !== entry.modelId) throw contentPersistenceError("seed", "validation", `Seed Entry id "${entry.id}" conflicts with stored data.`, false);
          continue;
        }
        const actualModel = loadedModel(await requestResult(modelStore.get(entry.modelId)), "seed");
        validateEntryAgainstModel(entry, actualModel, "seed");
        if (actualModel.document.kind === "single" && await requestResult(entryStore.index(CONTENT_ENTRY_MODEL_INDEX).count(entry.modelId)) > 0) throw contentPersistenceError("seed", "single-cardinality", "A Single model permits at most one Entry.", false);
        await requestResult(entryStore.add(entry));
      }
    });
  }

  async clear(): Promise<void> {
    const scan = await this.scanForInitialization("initialize");
    if (scan.failures.length) throw contentPersistenceError("clear", "validation", "Content storage contains invalid data and was preserved. Use startFresh to discard it explicitly.", false);
    await this.forceClear();
  }
  async forceClear(): Promise<void> {
    await this.run("clear", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).clear());
      await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).clear());
    });
  }

  async scanForInitialization(operation: "initialize" | "list-models" = "initialize"): Promise<ContentInitializationScan> {
    return this.run(operation, "readonly", [CONTENT_META_STORE_NAME, CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const metaRecords = await requestResult(tx.objectStore(CONTENT_META_STORE_NAME).getAll()) as unknown[];
      const meta = metaRecords[0];
      if (metaRecords.length !== 1 || !meta || typeof meta !== "object" || Object.keys(meta).sort().join(",") !== "databaseVersion,entryRecordSchemaVersion,key,modelRecordSchemaVersion" || (meta as { key?: unknown }).key !== CONTENT_META_KEYS.schema || (meta as { databaseVersion?: unknown }).databaseVersion !== CONTENT_DATABASE_VERSION || (meta as { modelRecordSchemaVersion?: unknown }).modelRecordSchemaVersion !== 1 || (meta as { entryRecordSchemaVersion?: unknown }).entryRecordSchemaVersion !== 1) {
        throw contentPersistenceError(operation, "unsupported-version", "Content database schema metadata is missing or unsupported.", false);
      }
      const modelRaw = await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).getAll()) as unknown[];
      const entryRaw = await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).getAll()) as unknown[];
      const models: ContentModelSummary[] = []; const modelRecords = new Map<string, ContentModelRecord>(); const failures: ContentInitializationFailure[] = [];
      for (let index = 0; index < modelRaw.length; index += 1) {
        const loaded = loadContentModelRecord(modelRaw[index]);
        if (loaded.status === "loaded") { models.push(summarizeContentModel(loaded.record)); modelRecords.set(loaded.record.id, loaded.record); }
        else if (loaded.status !== "not-found") failures.push({ id: rawId(modelRaw[index], `model-unknown-${index + 1}`), status: loaded.status, ...(loaded.status === "future-schema" ? { version: loaded.foundSchemaVersion } : {}) });
      }
      for (let index = 0; index < entryRaw.length; index += 1) {
        const loaded = loadContentEntryRecord(entryRaw[index]);
        if (loaded.status === "loaded") {
          const model = modelRecords.get(loaded.record.modelId);
          if (!model || entrySemanticIssue(loaded.record, model)) failures.push({ id: loaded.record.id, status: "invalid" });
        } else if (loaded.status !== "not-found") failures.push({ id: rawId(entryRaw[index], `entry-unknown-${index + 1}`), status: loaded.status, ...(loaded.status === "future-schema" ? { version: loaded.foundSchemaVersion } : {}) });
      }
      return { models: models.sort(compareContentModelsNewestFirst), failures };
    });
  }

  private async run<T>(operation: ContentPersistenceOperation, mode: IDBTransactionMode, stores: readonly string[], action: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    const connection = await this.runtime.open(operation);
    if (connection.invalidated) throw contentPersistenceError(operation, "versionchange", "Content storage changed version in another context. Retry to reopen it.", true);
    let transaction: IDBTransaction;
    try { transaction = connection.db.transaction(stores, mode); }
    catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") throw contentPersistenceError(operation, "unsupported-version", "Content database has an unsupported physical schema.", false, error);
      throw mapContentOperationalError(operation, mode, error);
    }
    const done = transactionComplete(transaction);
    try { const result = await action(transaction); await done; return result; }
    catch (error) {
      if (mode === "readwrite") { try { transaction.abort(); } catch { /* already terminal */ } }
      void done.catch(() => undefined);
      throw mapContentOperationalError(operation, mode, error);
    }
  }
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}
