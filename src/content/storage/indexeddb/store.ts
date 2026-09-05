import { notifyPersistenceChange } from "../../../shared/persistence-generation";
import {
  CONTENT_PROVIDERS,
  compareContentModelsNewestFirst,
  diagnoseContentEntryCompleteness,
  summarizeContentModel,
  buildContentGraphIndex,
  contentEntryDigest,
} from "../../library";
import type {
  ContentEntryPage,
  ContentEntrySnapshot,
  ContentModelSummary,
  ContentPageOptions,
  ContentPersistenceOperation,
  ContentSeed,
  ContentStore,
  ContentSnapshot,
  ContentMutation,
  ContentPublicationReconciliation,
} from "../../library";
import {
  isCanonicalContentTimestamp,
  isValueValidForField,
  loadContentEntryRecord,
  loadContentModelRecord,
  validateContentEntryRecord,
  validateContentModelRecord,
  traverseContentSchema,
  traverseContentValues,
} from "../../model";
import type { ContentEntryRecord, ContentLoadOutcome, ContentModelRecord } from "../../model";
import { isPlainObject, isSafeRecordId } from "../../../shared";
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
  readonly transactionScope = "provider" as const;
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
    record = structuredClone(validation.value);
    this.assertLocalSchema(record, "put-model");
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
      await requestResult(models.put(record));
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
    record = structuredClone(validation.value);
    await this.run("put-entry", "readwrite", [CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], async (tx) => {
      const entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      const model = loadedModel(await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).get(record.modelId)), "put-entry");
      validateEntryAgainstModel(record, model, "put-entry");
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
      const old = existing === undefined ? undefined : loadContentEntryRecord(existing);
      await requestResult(entries.put({ ...record, lifecycle: old?.status === "loaded" ? old.record.lifecycle : record.lifecycle }));
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
      this.assertLocalSchema(model, "seed");
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
    seed = structuredClone(seed);
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

  /** One-database snapshot; callers must still validate coherence across other domain databases. */
  async readAll(): Promise<ContentSnapshot> {
    return this.run("read-all", "readonly", [CONTENT_META_STORE_NAME, CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME], (tx) => this.snapshot(tx, "read-all"));
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
      const meta = metaRecords.find((item) => (item as { key?: unknown })?.key === CONTENT_META_KEYS.schema);
      if (metaRecords.length !== 2 || !meta || typeof meta !== "object" || Object.keys(meta).sort().join(",") !== "databaseVersion,entryRecordSchemaVersion,key,modelRecordSchemaVersion" || (meta as { key?: unknown }).key !== CONTENT_META_KEYS.schema || (meta as { databaseVersion?: unknown }).databaseVersion !== CONTENT_DATABASE_VERSION || (meta as { modelRecordSchemaVersion?: unknown }).modelRecordSchemaVersion !== 1 || (meta as { entryRecordSchemaVersion?: unknown }).entryRecordSchemaVersion !== 1) {
        throw contentPersistenceError(operation, "unsupported-version", "Content database schema metadata is missing or unsupported.", false);
      }
      await this.token(tx, operation);
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
      if (!failures.length) {
        const graph = buildContentGraphIndex([{ providerId: this.provider.id, mutationToken: 0, models: [...modelRecords.values()], entries: loadedEntries(entryRaw, operation) }]);
        for (const issue of graph.diagnostics) if (issue.code !== "incomplete" && issue.code !== "missing-provider") failures.push({ id: issue.recordId, status: "invalid" });
      }
      return { models: models.sort(compareContentModelsNewestFirst), failures };
    });
  }

  private async run<T>(operation: ContentPersistenceOperation, mode: IDBTransactionMode, stores: readonly string[], action: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    const connection = await this.runtime.open(operation);
    if (connection.invalidated) throw contentPersistenceError(operation, "versionchange", "Content storage changed version in another context. Retry to reopen it.", true);
    let transaction: IDBTransaction;
    try { transaction = connection.db.transaction(mode === "readwrite" ? [CONTENT_META_STORE_NAME, CONTENT_MODELS_STORE_NAME, CONTENT_ENTRIES_STORE_NAME] : stores, mode); }
    catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") throw contentPersistenceError(operation, "unsupported-version", "Content database has an unsupported physical schema.", false, error);
      throw mapContentOperationalError(operation, mode, error);
    }
    const done = transactionComplete(transaction);
    try {
      const before = mode === "readwrite" && operation !== "clear" ? await this.snapshot(transaction, operation) : undefined;
      if (before) this.validateSnapshot(before, operation);
      const token = mode === "readwrite" ? await this.token(transaction, operation) : undefined;
      const result = await action(transaction);
      if (mode === "readwrite") {
        if (token === undefined || token >= Number.MAX_SAFE_INTEGER) throw contentPersistenceError(operation, "write-failed", "Content mutation token is exhausted.", false);
        const next = await this.snapshot(transaction, operation);
        this.validateSnapshot(next, operation);
        const previousEntries = new Map(before?.entries.map((entry) => [entry.id, entry]) ?? []);
        for (const oldModel of before?.models ?? []) {
          const nextModel = next.models.find((model) => model.id === oldModel.id);
          if (!nextModel) continue;
          const nextKinds = new Map(traverseContentSchema(nextModel.document.fields).map(({ schema, path }) => [JSON.stringify(path), schema.kind]));
          for (const oldEntry of before!.entries.filter((entry) => entry.modelId === oldModel.id)) {
            for (const { schema, path } of traverseContentValues(oldModel, oldEntry)) {
              const nextKind = nextKinds.get(JSON.stringify(path.map((part) => typeof part === "number" ? "[]" : part)));
              if (nextKind !== undefined && nextKind !== schema.kind) throw contentPersistenceError(operation, "field-in-use", "Stored nested field kinds cannot change while entries use them.", false);
            }
          }
        }
        for (const entry of next.entries) {
          const old = previousEntries.get(entry.id);
          if (old && (old.modelId !== entry.modelId || old.createdAt !== entry.createdAt)) throw contentPersistenceError(operation, "validation", "Entry identity and creation time are immutable.", false);
          if (operation !== "seed" && operation !== "reconcile-publication" && entry.lifecycle === "published" && old?.lifecycle !== "published") throw contentPersistenceError(operation, "validation", "Saving cannot publish an entry; activation reconciliation is required.", false);
          if (JSON.stringify(old) !== JSON.stringify(entry)) await requestResult(transaction.objectStore(CONTENT_ENTRIES_STORE_NAME).put({ ...entry, generation: token + 1 }));
        }
        await requestResult(transaction.objectStore(CONTENT_META_STORE_NAME).put({ key: CONTENT_META_KEYS.mutation, token: token + 1 }));
      }
      // Snapshot-returning mutations include the durable generation assigned above.
      const finalResult = mode === "readwrite" && (operation === "transact" || operation === "reconcile-publication") ? await this.snapshot(transaction, operation) as T : result;
      await done;
      if (mode === "readwrite") notifyPersistenceChange(connection.db.name);
      return finalResult;
    }
    catch (error) {
      if (mode === "readwrite") { try { transaction.abort(); } catch { /* already terminal */ } }
      void done.catch(() => undefined);
      throw mapContentOperationalError(operation, mode, error);
    }
  }

  private async token(tx: IDBTransaction, operation: ContentPersistenceOperation): Promise<number> {
    const meta = await requestResult(tx.objectStore(CONTENT_META_STORE_NAME).get(CONTENT_META_KEYS.mutation)) as { key?: unknown; token?: unknown } | undefined;
    if (!meta || Object.keys(meta).length !== 2 || meta.key !== CONTENT_META_KEYS.mutation || !Number.isSafeInteger(meta.token) || (meta.token as number) < 0) throw contentPersistenceError(operation, "unsupported-version", "Content durable mutation metadata is missing or invalid.", false);
    return meta.token as number;
  }

  private async snapshot(tx: IDBTransaction, operation: ContentPersistenceOperation): Promise<ContentSnapshot> {
    const rawModels = await requestResult(tx.objectStore(CONTENT_MODELS_STORE_NAME).getAll()) as unknown[];
    const rawEntries = await requestResult(tx.objectStore(CONTENT_ENTRIES_STORE_NAME).getAll()) as unknown[];
    return { providerId: this.provider.id, mutationToken: await this.token(tx, operation), models: rawModels.map((raw) => loadedModel(raw, operation)), entries: loadedEntries(rawEntries, operation) };
  }

  private validateSnapshot(snapshot: ContentSnapshot, operation: ContentPersistenceOperation): void {
    const graph = buildContentGraphIndex([snapshot]);
    if (graph.diagnostics.some((issue) => issue.code === "missing-provider")) throw contentPersistenceError(operation, "unsupported-transaction", "IndexedDB cannot atomically validate or protect references to another Content provider.", false);
    const issue = graph.diagnostics.find((issue) => issue.code !== "incomplete");
    if (issue) throw contentPersistenceError(operation, issue.code === "single-cardinality" ? "single-cardinality" : issue.code === "missing-entry" ? "reference-in-use" : issue.code === "missing-model" || issue.code === "invalid-inverse" ? "dependency-in-use" : "validation", issue.message, false);
  }

  private assertLocalSchema(model: ContentModelRecord, operation: ContentPersistenceOperation): void {
    const foreign = traverseContentSchema(model.document.fields).some(({ schema }) => (schema.kind === "reference" || schema.kind === "reference-list") && schema.target.providerId !== this.provider.id)
      || model.document.presentation?.inverses.some((inverse) => inverse.source.providerId !== this.provider.id);
    if (foreign) throw contentPersistenceError(operation, "unsupported-transaction", "This provider cannot coordinate foreign Content relations atomically.", false);
  }

  async transact(mutation: ContentMutation): Promise<ContentSnapshot> {
    if (!isPlainObject(mutation) || Object.keys(mutation).sort().join(",") !== "expectedMutationToken,operations" || !Number.isSafeInteger(mutation.expectedMutationToken) || mutation.expectedMutationToken < 0 || !Array.isArray(mutation.operations)) throw contentPersistenceError("transact", "validation", "Mutation requires a durable expected token and operations.", false);
    for (const op of mutation.operations) {
      if (!isPlainObject(op)) throw contentPersistenceError("transact", "validation", "Mutation operation must be an object.", false);
      const keys = op.kind === "put-model" || op.kind === "put-entry" ? ["kind", "record"] : op.kind === "remove-field" ? ["kind", "modelId", "fieldId"] : ["kind", "id"];
      if (typeof op.kind !== "string" || !["put-model", "put-entry", "delete-model", "delete-entry", "remove-field", "unpublish-entry"].includes(op.kind) || Object.keys(op).sort().join(",") !== keys.sort().join(",")) throw contentPersistenceError("transact", "validation", "Unknown or malformed mutation operation.", false);
      if (op.kind === "put-entry" && !validateContentEntryRecord(op.record).ok) throw contentPersistenceError("transact", "validation", "Invalid entry mutation.", false);
      if (("id" in op && !isSafeRecordId(op.id)) || (op.kind === "remove-field" && (!isSafeRecordId(op.modelId) || !isSafeRecordId(op.fieldId)))) throw contentPersistenceError("transact", "validation", "Mutation identities must be safe record ids.", false);
    }
    for (const op of mutation.operations) if (op.kind === "put-model") {
      const valid = validateContentModelRecord(op.record);
      if (!valid.ok) throw contentPersistenceError("transact", "validation", valid.issue.message, false);
      this.assertLocalSchema(op.record, "transact");
    }
    mutation = structuredClone(mutation);
    return this.run("transact", "readwrite", [], async (tx) => {
      const snapshot = await this.snapshot(tx, "transact");
      if (snapshot.mutationToken !== mutation.expectedMutationToken) throw contentPersistenceError("transact", "conflict", "Content changed since the mutation was prepared.", true);
      const models = tx.objectStore(CONTENT_MODELS_STORE_NAME), entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      for (const op of mutation.operations) {
        switch (op.kind) {
          case "put-model": {
            const valid = validateContentModelRecord(op.record);
            if (!valid.ok) throw contentPersistenceError("transact", "validation", valid.issue.message, false);
            const old = snapshot.models.find((model) => model.id === op.record.id);
            if (old && (old.createdAt !== op.record.createdAt || old.document.kind !== op.record.document.kind)) throw contentPersistenceError("transact", "immutable-kind", "Model creation identity and cardinality are immutable.", false);
            if (old && old.document.fields.some((field) => !op.record.document.fields.some((next) => next.id === field.id))) throw contentPersistenceError("transact", "field-removal-required", "Use remove-field to remove stored fields.", false);
            if (old) for (const field of old.document.fields) {
              const next = op.record.document.fields.find((next) => next.id === field.id);
              if (next && next.kind !== field.kind && snapshot.entries.some((entry) => entry.modelId === old.id && Object.hasOwn(entry.values, field.id))) throw contentPersistenceError("transact", "field-in-use", "Stored field kinds cannot change while entries use them.", false);
            }
            await requestResult(models.put(op.record)); break;
          }
          case "put-entry": {
            const valid = validateContentEntryRecord(op.record);
            if (!valid.ok) throw contentPersistenceError("transact", "validation", valid.issue.message, false);
            const old = await requestResult(entries.get(op.record.id)) as ContentEntryRecord | undefined;
            await requestResult(entries.put({ ...op.record, lifecycle: old?.lifecycle ?? op.record.lifecycle })); break;
          }
          case "unpublish-entry": {
            const [entry] = loadedEntries([await requestResult(entries.get(op.id))], "transact");
            await requestResult(entries.put({ ...entry, lifecycle: "draft" })); break;
          }
          case "delete-entry": await requestResult(entries.delete(op.id)); break;
          case "delete-model": {
            for (const entry of await requestResult(entries.index(CONTENT_ENTRY_MODEL_INDEX).getAll(op.id)) as ContentEntryRecord[]) await requestResult(entries.delete(entry.id));
            await requestResult(models.delete(op.id)); break;
          }
          case "remove-field": {
            const model = loadedModel(await requestResult(models.get(op.modelId)), "transact");
            if (!model.document.fields.some((field) => field.id === op.fieldId)) throw contentPersistenceError("transact", "not-found", "Field does not exist.", false);
            const now = this.runtime.now();
            if (!isCanonicalContentTimestamp(now)) throw contentPersistenceError("transact", "validation", "Provider clock must return a canonical ISO timestamp.", false);
            await requestResult(models.put({ ...model, updatedAt: now < model.updatedAt ? model.updatedAt : now, document: { ...model.document, fields: model.document.fields.filter((field) => field.id !== op.fieldId) } }));
            for (const entry of loadedEntries(await requestResult(entries.index(CONTENT_ENTRY_MODEL_INDEX).getAll(op.modelId)), "transact")) {
              const values = { ...entry.values }; delete values[op.fieldId];
              await requestResult(entries.put({ ...entry, values, updatedAt: now < entry.updatedAt ? entry.updatedAt : now }));
            }
            break;
          }
        }
      }
      return this.snapshot(tx, "transact");
    });
  }

  /** A stale activation never overwrites newer authored values or lifecycle intent. */
  async reconcilePublication(reconciliations: readonly ContentPublicationReconciliation[]): Promise<ContentSnapshot> {
    const seen = new Set<string>();
    for (const item of reconciliations) {
      if (!item.ref || item.ref.providerId !== this.provider.id) throw contentPersistenceError("reconcile-publication", "unsupported-transaction", "Cannot reconcile another provider.", false);
      if (!isSafeRecordId(item.ref.recordId) || !isSafeRecordId(item.ref.modelId) || !Number.isSafeInteger(item.expectedGeneration) || item.expectedGeneration < 0 || typeof item.expectedDigest !== "string" || !["draft", "published"].includes(item.lifecycle) || seen.has(item.ref.recordId)) throw contentPersistenceError("reconcile-publication", "validation", "Publication reconciliation must use unique valid identities and expected generations/digests.", false);
      seen.add(item.ref.recordId);
    }
    reconciliations = structuredClone(reconciliations);
    return this.run("reconcile-publication", "readwrite", [], async (tx) => {
      const entries = tx.objectStore(CONTENT_ENTRIES_STORE_NAME);
      for (const item of reconciliations) {
        if (item.ref.providerId !== this.provider.id) throw contentPersistenceError("reconcile-publication", "unsupported-transaction", "Cannot reconcile another provider.", false);
        const raw = await requestResult(entries.get(item.ref.recordId));
        if (raw === undefined) continue;
        const [entry] = loadedEntries([raw], "reconcile-publication");
        if (entry!.modelId === item.ref.modelId && entry!.generation === item.expectedGeneration && contentEntryDigest(entry!) === item.expectedDigest) await requestResult(entries.put({ ...entry, lifecycle: item.lifecycle }));
      }
      return this.snapshot(tx, "reconcile-publication");
    });
  }
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}
