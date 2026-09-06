// Content persisted as project files.
//
// Every read is one transactional-record-store snapshot and every mutation is
// one `commit`, so the whole Content graph — models, entries and the domain
// metadata document — moves from one valid whole state to the next in a single
// pointer swap. There is no per-record write path at all: a mutation is
// expressed as the complete after-state, which is exactly what makes the
// before/after graph validation below a single check rather than a per-step
// approximation.
//
// Two identities are deliberately different things:
//
//   - the record store's `mutationToken`, an opaque digest used for its own
//     snapshot CAS, and
//   - Content's `mutationToken`, a monotonic integer that is also stamped into
//     every changed entry as its `generation` and quoted back by publication
//     reconciliation.
//
// Only the second one is domain-visible, so the optimistic-concurrency check
// runs on it, inside the same plan that validates the graph.

import {
  CONTENT_PROVIDERS,
  ContentPersistenceError,
  assertContentEntryMatchesModel,
  buildContentGraphIndex,
  compareContentEntriesForPaging,
  compareContentModelsNewestFirst,
  contentEntryDigest,
  contentEntrySemanticIssue,
  decodeContentEntryCursor,
  diagnoseContentEntryCompleteness,
  encodeContentEntryCursor,
  isAfterContentEntryCursor,
  summarizeContentModel,
} from "../../library";
import type {
  ContentEntryPage,
  ContentEntrySnapshot,
  ContentInitializationOutcome,
  ContentModelSummary,
  ContentMutation,
  ContentPageOptions,
  ContentPersistenceErrorCode,
  ContentPersistenceOperation,
  ContentPublicationReconciliation,
  ContentRecoveryOutcome,
  ContentSeed,
  ContentSnapshot,
  ContentStore,
} from "../../library";
import {
  isCanonicalContentTimestamp,
  loadContentEntryRecord,
  loadContentModelRecord,
  traverseContentSchema,
  traverseContentValues,
  validateContentEntryRecord,
  validateContentModelRecord,
} from "../../model";
import type { ContentEntryRecord, ContentLoadOutcome, ContentModelRecord } from "../../model";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import { createTransactionalRecordStore } from "../../../shared/node-fs";
import type {
  DurableExtraErrorCode,
  RecordEnvelope,
  SafeRootErrorPolicy,
  TransactionalRecordStore,
} from "../../../shared/node-fs";
import {
  CONTENT_ENTRY_RECORD_PREFIX,
  CONTENT_FILESYSTEM_LAYOUT,
  CONTENT_META_RECORD_ID,
  CONTENT_MODEL_RECORD_PREFIX,
  CONTENT_RECORD_SCHEMA_VERSION,
  MAX_CONTENT_ID_LENGTH,
} from "./types";
import type { FilesystemContentStoreOptions } from "./types";

type Operation = ContentPersistenceOperation;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const META_KEYS = ["layout", "mutationToken", "activationGeneration"];

/**
 * The record store reports failures against a fixed phase rather than the
 * caller's operation. Domain failures — every validation, conflict and
 * cardinality rule below — carry the exact operation, so only raw filesystem
 * failures surface as `read-all`/`transact`/`initialize`.
 */
const PHASES = { initialize: "initialize", snapshot: "read-all", commit: "transact" } as const;

function contentError(
  operation: Operation,
  code: ContentPersistenceErrorCode,
  message: string,
  cause?: unknown,
): ContentPersistenceError {
  const retryable = code === "read-failed" || code === "write-failed" || code === "conflict" || code === "transaction-failed";
  return new ContentPersistenceError(operation, code, message, retryable, cause === undefined ? undefined : { cause });
}

const errorPolicy: SafeRootErrorPolicy<Operation, DurableExtraErrorCode> = {
  isError: (value) => value instanceof ContentPersistenceError,
  create: (operation, code, message, cause) => contentError(operation, code, message, cause),
  rethrow: (operation, code, message, cause) => {
    if (cause instanceof ContentPersistenceError) throw cause;
    throw contentError(operation, code, message, cause);
  },
};

export interface ContentInitializationFailure { id: string; status: "invalid" | "future-schema"; version?: number }
export interface ContentInitializationScan {
  models: readonly ContentModelSummary[];
  failures: readonly ContentInitializationFailure[];
}

interface DecodedRecord<T> { id: string; raw: unknown; loaded: ContentLoadOutcome<T> }

interface DecodedContent {
  mutationToken: number;
  activationGeneration: number;
  models: readonly DecodedRecord<ContentModelRecord>[];
  entries: readonly DecodedRecord<ContentEntryRecord>[];
}

/** The complete after-state one mutation produces, plus its caller's result. */
interface ContentMutationPlan<T> {
  models: readonly ContentModelRecord[];
  entries: readonly ContentEntryRecord[];
  /** Advances the monotonic activation fence when present. */
  activationGeneration?: number;
  value: T;
}

/**
 * Thrown by a plan that decided nothing should be written. Throwing is what
 * guarantees it: the record store writes nothing at all when a plan throws, so
 * a no-op mutation cannot advance the token or leave a staged generation.
 */
class UnchangedContent<T> {
  constructor(readonly snapshot: ContentSnapshot, readonly value: T) {}
}

function modelRecordId(id: string): string { return `${CONTENT_MODEL_RECORD_PREFIX}${id}`; }
function entryRecordId(id: string): string { return `${CONTENT_ENTRY_RECORD_PREFIX}${id}`; }

function envelope(id: string, value: unknown): RecordEnvelope {
  return { id, json: `${JSON.stringify(value, null, 2)}\n` };
}

function sameLayout(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(CONTENT_FILESYSTEM_LAYOUT);
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}

function assertStorableId(operation: Operation, kind: "model" | "Entry", id: string): void {
  if (!isSafeRecordId(id) || id.length > MAX_CONTENT_ID_LENGTH) {
    throw contentError(
      operation,
      "validation",
      `A Content ${kind} id must be a path-safe id of at most ${MAX_CONTENT_ID_LENGTH} characters.`,
    );
  }
}

export class FilesystemContentStore implements ContentStore {
  readonly provider = CONTENT_PROVIDERS.filesystem;
  readonly transactionScope = "provider" as const;

  private constructor(
    private readonly records: TransactionalRecordStore<Operation>,
    private readonly now: () => string,
  ) {}

  static async create(options: FilesystemContentStoreOptions): Promise<FilesystemContentStore> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.contentRoot,
      schemaVersion: CONTENT_RECORD_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Content records root",
      ownerLabel: "Content",
      recordLabel: "content record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
    });
    const store = new FilesystemContentStore(records, options.now ?? (() => new Date().toISOString()));
    await store.open();
    return store;
  }

  get root(): string {
    return this.records.root;
  }

  /**
   * Stamp the layout marker on a brand-new store, and refuse an existing one
   * whose marker does not match. Refusing at open is the point: a mismatched
   * store is never partially read, and never quietly re-shaped.
   */
  private async open(): Promise<void> {
    const snapshot = await this.records.snapshot();
    if (snapshot.records.length > 0) {
      this.decode(snapshot, "initialize");
      return;
    }
    try {
      await this.records.commit((before) => {
        // Re-read under the lock: another handle may have stamped the marker
        // between the snapshot above and this commit.
        if (before.records.length > 0) {
          throw new UnchangedContent(this.strict(this.decode(before, "initialize"), "initialize"), null);
        }
        return {
          records: [envelope(CONTENT_META_RECORD_ID, {
            layout: CONTENT_FILESYSTEM_LAYOUT,
            mutationToken: 0,
            activationGeneration: 0,
          })],
          result: null,
        };
      });
    } catch (cause) {
      if (!(cause instanceof UnchangedContent)) throw cause;
    }
  }

  // ---------------------------------------------------------------- decoding

  private decode(snapshot: { records: readonly RecordEnvelope[] }, operation: Operation): DecodedContent {
    const metaJson = snapshot.records.find((record) => record.id === CONTENT_META_RECORD_ID)?.json;
    if (metaJson === undefined) {
      throw contentError(operation, "unsupported-version", "Content storage has no layout marker. Records are preserved; explicit recovery is required.");
    }
    const meta: unknown = this.parse(operation, CONTENT_META_RECORD_ID, metaJson);
    if (!isPlainObject(meta)
      || Object.keys(meta).sort().join(",") !== META_KEYS.slice().sort().join(",")
      || !sameLayout(meta.layout)
      || !Number.isSafeInteger(meta.mutationToken) || (meta.mutationToken as number) < 0
      || !Number.isSafeInteger(meta.activationGeneration) || (meta.activationGeneration as number) < 0) {
      throw contentError(operation, "unsupported-version", "Content storage layout marker is missing or unsupported. Records are preserved; explicit recovery is required.");
    }

    const models: DecodedRecord<ContentModelRecord>[] = [];
    const entries: DecodedRecord<ContentEntryRecord>[] = [];
    for (const record of snapshot.records) {
      if (record.id === CONTENT_META_RECORD_ID) continue;
      const raw = this.parse(operation, record.id, record.json);
      if (record.id.startsWith(CONTENT_MODEL_RECORD_PREFIX)) {
        const id = record.id.slice(CONTENT_MODEL_RECORD_PREFIX.length);
        models.push({ id, raw, loaded: loadContentModelRecord(raw) });
      } else if (record.id.startsWith(CONTENT_ENTRY_RECORD_PREFIX)) {
        const id = record.id.slice(CONTENT_ENTRY_RECORD_PREFIX.length);
        entries.push({ id, raw, loaded: loadContentEntryRecord(raw) });
      } else {
        throw contentError(operation, "unsupported-version", `Content storage holds a record outside the declared layout: ${record.id}`);
      }
    }
    return {
      mutationToken: meta.mutationToken as number,
      activationGeneration: meta.activationGeneration as number,
      models: models.sort(compareById),
      entries: entries.sort(compareById),
    };
  }

  private parse(operation: Operation, id: string, json: string): unknown {
    try {
      return JSON.parse(json);
    } catch (cause) {
      throw contentError(operation, "blocked", `Content record "${id}" is not valid JSON. It was preserved; explicit recovery is required.`, cause);
    }
  }

  /** Every record must load; a snapshot is all-or-nothing. */
  private strict(decoded: DecodedContent, operation: Operation): ContentSnapshot {
    const models = decoded.models.map((record) => {
      if (record.loaded.status !== "loaded") throw contentError(operation, "validation", "The stored Content model is invalid and was preserved.");
      return record.loaded.record;
    });
    const entries = decoded.entries.map((record) => {
      if (record.loaded.status !== "loaded") throw contentError(operation, "validation", "Content storage contains an invalid Entry and it was preserved.");
      return record.loaded.record;
    });
    return { providerId: this.provider.id, mutationToken: decoded.mutationToken, models, entries };
  }

  private async read(operation: Operation): Promise<{ decoded: DecodedContent; snapshot: ContentSnapshot }> {
    const decoded = this.decode(await this.records.snapshot(), operation);
    return { decoded, snapshot: this.strict(decoded, operation) };
  }

  private model(snapshot: ContentSnapshot, id: string, operation: Operation): ContentModelRecord {
    const model = snapshot.models.find((candidate) => candidate.id === id);
    if (!model) throw contentError(operation, "not-found", "Content model was not found.");
    return model;
  }

  // -------------------------------------------------------------- validation

  private validateSnapshot(snapshot: ContentSnapshot, operation: Operation): void {
    const graph = buildContentGraphIndex([snapshot]);
    if (graph.diagnostics.some((issue) => issue.code === "missing-provider")) {
      throw contentError(operation, "unsupported-transaction", "The filesystem provider cannot atomically validate or protect references to another Content provider.");
    }
    const issue = graph.diagnostics.find((issue) => issue.code !== "incomplete");
    if (!issue) return;
    throw contentError(
      operation,
      issue.code === "single-cardinality" ? "single-cardinality"
        : issue.code === "missing-entry" ? "reference-in-use"
          : issue.code === "missing-model" || issue.code === "invalid-inverse" ? "dependency-in-use"
            : "validation",
      issue.message,
    );
  }

  private assertLocalSchema(model: ContentModelRecord, operation: Operation): void {
    const foreign = traverseContentSchema(model.document.fields)
      .some(({ schema }) => (schema.kind === "reference" || schema.kind === "reference-list") && schema.target.providerId !== this.provider.id)
      || model.document.presentation?.inverses.some((inverse) => inverse.source.providerId !== this.provider.id);
    if (foreign) throw contentError(operation, "unsupported-transaction", "This provider cannot coordinate foreign Content relations atomically.");
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Run one whole mutation.
   *
   * `plan` sees the complete validated before-state and returns the complete
   * after-state. Both halves are validated inside the same commit, so a
   * mutation that would leave an invalid graph — in either direction — writes
   * nothing at all.
   */
  private async mutate<T>(
    operation: Operation,
    plan: (before: ContentSnapshot, decoded: DecodedContent) => ContentMutationPlan<T> | Promise<ContentMutationPlan<T>>,
    options: { expectedMutationToken?: number; validateBefore?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ snapshot: ContentSnapshot; value: T }> {
    try {
      return await this.records.commit(async (context) => {
        const decoded = this.decode(context, operation);
        const before = this.strict(decoded, operation);
        if (options.validateBefore !== false) this.validateSnapshot(before, operation);
        if (options.expectedMutationToken !== undefined && options.expectedMutationToken !== before.mutationToken) {
          throw contentError(operation, "conflict", "Content changed since the mutation was prepared.");
        }
        const planned = await plan(before, decoded);
        const token = before.mutationToken;
        if (token >= Number.MAX_SAFE_INTEGER) throw contentError(operation, "write-failed", "Content mutation token is exhausted.");

        const proposed: ContentSnapshot = {
          providerId: this.provider.id,
          mutationToken: token + 1,
          models: [...planned.models].sort(compareById),
          entries: [...planned.entries].sort(compareById),
        };
        this.validateSnapshot(proposed, operation);
        this.assertStoredKindsSurvive(before, proposed, operation);
        // Generations are stamped last: they are storage bookkeeping and must
        // not influence any of the checks above.
        const next: ContentSnapshot = {
          ...proposed,
          entries: this.stampGenerations(before, proposed.entries, token, operation),
        };

        const activationGeneration = planned.activationGeneration ?? decoded.activationGeneration;
        return {
          records: [
            envelope(CONTENT_META_RECORD_ID, { layout: CONTENT_FILESYSTEM_LAYOUT, mutationToken: next.mutationToken, activationGeneration }),
            ...next.models.map((model) => {
              assertStorableId(operation, "model", model.id);
              return envelope(modelRecordId(model.id), model);
            }),
            ...next.entries.map((entry) => {
              assertStorableId(operation, "Entry", entry.id);
              return envelope(entryRecordId(entry.id), entry);
            }),
          ],
          result: { snapshot: next, value: planned.value },
        };
      }, options.signal === undefined ? {} : { signal: options.signal });
    } catch (cause) {
      if (cause instanceof UnchangedContent) return { snapshot: cause.snapshot as ContentSnapshot, value: cause.value as T };
      if (cause instanceof ContentPersistenceError) throw cause;
      // An abort or a foreign failure still has to leave the domain API
      // speaking only its own error type.
      throw contentError(operation, "transaction-failed", `The Content ${operation} transaction did not complete.`, cause);
    }
  }

  /** A nested field kind cannot change while a stored entry supplies a value at that path. */
  private assertStoredKindsSurvive(before: ContentSnapshot, next: ContentSnapshot, operation: Operation): void {
    for (const oldModel of before.models) {
      const nextModel = next.models.find((model) => model.id === oldModel.id);
      if (!nextModel) continue;
      const nextKinds = new Map(traverseContentSchema(nextModel.document.fields).map(({ schema, path }) => [JSON.stringify(path), schema.kind]));
      for (const oldEntry of before.entries.filter((entry) => entry.modelId === oldModel.id)) {
        for (const { schema, path } of traverseContentValues(oldModel, oldEntry)) {
          const key = JSON.stringify(path.map((part) => typeof part === "number" ? "[]" : part));
          const nextKind = nextKinds.get(key);
          if (nextKind !== undefined && nextKind !== schema.kind) {
            throw contentError(operation, "field-in-use", "Stored nested field kinds cannot change while entries use them.");
          }
        }
      }
    }
  }

  /**
   * Identity and creation time are immutable, publication is reserved to
   * activation reconciliation, and every entry that actually changed carries
   * the new mutation token as its generation.
   */
  private stampGenerations(
    before: ContentSnapshot,
    entries: readonly ContentEntryRecord[],
    token: number,
    operation: Operation,
  ): ContentEntryRecord[] {
    const previous = new Map(before.entries.map((entry) => [entry.id, entry]));
    return entries.map((entry) => {
      const old = previous.get(entry.id);
      if (old && (old.modelId !== entry.modelId || old.createdAt !== entry.createdAt)) {
        throw contentError(operation, "validation", "Entry identity and creation time are immutable.");
      }
      if (operation !== "seed" && operation !== "reconcile-publication"
        && entry.lifecycle === "published" && old?.lifecycle !== "published") {
        throw contentError(operation, "validation", "Saving cannot publish an entry; activation reconciliation is required.");
      }
      return JSON.stringify(old) === JSON.stringify(entry) ? entry : { ...entry, generation: token + 1 };
    });
  }

  // ------------------------------------------------------------------- reads

  async readAll(): Promise<ContentSnapshot> {
    return (await this.read("read-all")).snapshot;
  }

  async listModels(): Promise<readonly ContentModelSummary[]> {
    const scan = await this.scanForInitialization("list-models");
    if (scan.failures.length) throw contentError("list-models", "validation", "Content storage contains records that cannot be listed safely.");
    return scan.models;
  }

  async getModel(id: string): Promise<ContentLoadOutcome<ContentModelRecord>> {
    const { decoded } = await this.read("get-model");
    const record = decoded.models.find((candidate) => candidate.id === id);
    return record === undefined ? { status: "not-found", id } : record.loaded;
  }

  async countEntries(modelId: string): Promise<number> {
    const { snapshot } = await this.read("count-entries");
    this.model(snapshot, modelId, "count-entries");
    return snapshot.entries.filter((entry) => entry.modelId === modelId).length;
  }

  async getEntry(id: string): Promise<ContentLoadOutcome<ContentEntryRecord>> {
    const { decoded } = await this.read("get-entry");
    const record = decoded.entries.find((candidate) => candidate.id === id);
    if (record === undefined) return { status: "not-found", id };
    const loaded = record.loaded;
    if (loaded.status !== "loaded") return loaded;
    const model = decoded.models.find((candidate) => candidate.id === loaded.record.modelId);
    const issue = model?.loaded.status === "loaded"
      ? contentEntrySemanticIssue(loaded.record, model.loaded.record)
      : `Entry refers to unreadable or missing model "${loaded.record.modelId}".`;
    return issue ? { status: "invalid", issue: { code: "invalid-value", message: issue }, raw: record.raw } : loaded;
  }

  async pageEntries(modelId: string, options: ContentPageOptions = {}): Promise<ContentEntryPage> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw contentError("page-entries", "validation", `Page limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
    }
    const cursor = decodeContentEntryCursor(options.cursor);
    const { snapshot } = await this.read("page-entries");
    const model = this.model(snapshot, modelId, "page-entries");
    const ordered = snapshot.entries
      .filter((entry) => entry.modelId === modelId && isAfterContentEntryCursor(entry, cursor))
      .sort(compareContentEntriesForPaging);
    for (const entry of ordered) assertContentEntryMatchesModel(entry, model, "page-entries");
    const page = ordered.slice(0, limit);
    const hasMore = ordered.length > limit;
    return { entries: page, ...(hasMore ? { nextCursor: encodeContentEntryCursor(page[page.length - 1]!) } : {}) };
  }

  async scanEntries(modelId: string): Promise<ContentEntrySnapshot> {
    const { snapshot } = await this.read("scan-entries");
    const model = this.model(snapshot, modelId, "scan-entries");
    const entries = snapshot.entries
      .filter((entry) => entry.modelId === modelId)
      .sort(compareContentEntriesForPaging);
    for (const entry of entries) assertContentEntryMatchesModel(entry, model, "scan-entries");
    return {
      model,
      count: entries.length,
      entries,
      diagnostics: entries.flatMap((entry) => diagnoseContentEntryCompleteness(model, entry)),
    };
  }

  async scanForInitialization(operation: "initialize" | "list-models" = "initialize"): Promise<ContentInitializationScan> {
    const decoded = this.decode(await this.records.snapshot(), operation);
    const models: ContentModelSummary[] = [];
    const modelRecords = new Map<string, ContentModelRecord>();
    const failures: ContentInitializationFailure[] = [];
    decoded.models.forEach((record, index) => {
      if (record.loaded.status === "loaded") {
        models.push(summarizeContentModel(record.loaded.record));
        modelRecords.set(record.loaded.record.id, record.loaded.record);
      } else if (record.loaded.status !== "not-found") {
        failures.push({
          id: rawId(record.raw, `model-unknown-${index + 1}`),
          status: record.loaded.status,
          ...(record.loaded.status === "future-schema" ? { version: record.loaded.foundSchemaVersion } : {}),
        });
      }
    });
    const entryRecords: ContentEntryRecord[] = [];
    decoded.entries.forEach((record, index) => {
      if (record.loaded.status === "loaded") {
        entryRecords.push(record.loaded.record);
        const model = modelRecords.get(record.loaded.record.modelId);
        if (!model || contentEntrySemanticIssue(record.loaded.record, model)) failures.push({ id: record.loaded.record.id, status: "invalid" });
      } else if (record.loaded.status !== "not-found") {
        failures.push({
          id: rawId(record.raw, `entry-unknown-${index + 1}`),
          status: record.loaded.status,
          ...(record.loaded.status === "future-schema" ? { version: record.loaded.foundSchemaVersion } : {}),
        });
      }
    });
    if (!failures.length) {
      const graph = buildContentGraphIndex([{
        providerId: this.provider.id,
        mutationToken: decoded.mutationToken,
        models: [...modelRecords.values()],
        entries: entryRecords,
      }]);
      for (const issue of graph.diagnostics) {
        if (issue.code !== "incomplete" && issue.code !== "missing-provider") failures.push({ id: issue.recordId, status: "invalid" });
      }
    }
    return { models: models.sort(compareContentModelsNewestFirst), failures };
  }

  // --------------------------------------------------------------- mutations

  async putModel(record: ContentModelRecord): Promise<void> {
    const validation = validateContentModelRecord(record);
    if (!validation.ok) throw contentError("put-model", "validation", validation.issue.message);
    const next = structuredClone(validation.value);
    assertStorableId("put-model", "model", next.id);
    this.assertLocalSchema(next, "put-model");
    await this.mutate("put-model", (before) => {
      const existing = before.models.find((model) => model.id === next.id);
      if (existing) {
        const storedEntries = before.entries.filter((entry) => entry.modelId === next.id);
        for (const entry of storedEntries) assertContentEntryMatchesModel(entry, existing, "put-model");
        if (existing.createdAt !== next.createdAt) throw contentError("put-model", "validation", "Content model createdAt is immutable after persistence.");
        if (existing.document.kind !== next.document.kind) throw contentError("put-model", "immutable-kind", "Content model kind is immutable after persistence.");
        const nextFields = new Map(next.document.fields.map((field) => [field.id, field]));
        for (const oldField of existing.document.fields) {
          const replacement = nextFields.get(oldField.id);
          if (!replacement) throw contentError("put-model", "field-removal-required", "Fields must be removed through the destructive removeField operation.");
          if (replacement.kind !== oldField.kind && storedEntries.some((entry) => Object.hasOwn(entry.values, oldField.id))) {
            throw contentError("put-model", "field-in-use", `Field "${oldField.key}" kind is immutable because an Entry stores a value for it.`);
          }
        }
      }
      return {
        models: [...before.models.filter((model) => model.id !== next.id), next],
        entries: before.entries,
        value: undefined,
      };
    });
  }

  async deleteModel(id: string): Promise<boolean> {
    const { value } = await this.mutate("delete-model", (before) => {
      const model = before.models.find((candidate) => candidate.id === id);
      if (!model) throw new UnchangedContent(before, false);
      for (const entry of before.entries.filter((entry) => entry.modelId === id)) {
        assertContentEntryMatchesModel(entry, model, "delete-model");
      }
      return {
        models: before.models.filter((candidate) => candidate.id !== id),
        entries: before.entries.filter((entry) => entry.modelId !== id),
        value: true,
      };
    });
    return value;
  }

  async putEntry(record: ContentEntryRecord): Promise<void> {
    const validation = validateContentEntryRecord(record);
    if (!validation.ok) throw contentError("put-entry", "validation", validation.issue.message);
    const next = structuredClone(validation.value);
    assertStorableId("put-entry", "Entry", next.id);
    await this.mutate("put-entry", (before) => {
      const model = this.model(before, next.modelId, "put-entry");
      assertContentEntryMatchesModel(next, model, "put-entry");
      const existing = before.entries.find((entry) => entry.id === next.id);
      if (model.document.kind === "single") {
        const count = before.entries.filter((entry) => entry.modelId === next.modelId).length;
        if (!existing && count > 0) throw contentError("put-entry", "single-cardinality", "A Single model permits at most one Entry.");
        if (existing && existing.modelId !== next.modelId) throw contentError("put-entry", "single-cardinality", "Entry identity cannot be moved into a populated Single.");
      }
      if (existing) {
        if (existing.modelId !== next.modelId) throw contentError("put-entry", "validation", "Entry modelId is immutable after persistence.");
        if (existing.createdAt !== next.createdAt) throw contentError("put-entry", "validation", "Entry createdAt is immutable after persistence.");
      }
      const stored: ContentEntryRecord = { ...next, lifecycle: existing?.lifecycle ?? next.lifecycle };
      return {
        models: before.models,
        entries: [...before.entries.filter((entry) => entry.id !== next.id), stored],
        value: undefined,
      };
    });
  }

  async deleteEntry(id: string): Promise<boolean> {
    const { value } = await this.mutate("delete-entry", (before) => {
      const entry = before.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new UnchangedContent(before, false);
      assertContentEntryMatchesModel(entry, this.model(before, entry.modelId, "delete-entry"), "delete-entry");
      return { models: before.models, entries: before.entries.filter((candidate) => candidate.id !== id), value: true };
    });
    return value;
  }

  async removeField(modelId: string, fieldId: string): Promise<void> {
    await this.mutate("remove-field", (before) => {
      const model = this.model(before, modelId, "remove-field");
      if (!model.document.fields.some((field) => field.id === fieldId)) {
        throw contentError("remove-field", "not-found", "Content field was not found.");
      }
      for (const entry of before.entries.filter((entry) => entry.modelId === modelId)) {
        assertContentEntryMatchesModel(entry, model, "remove-field");
      }
      const now = this.clock("remove-field");
      return {
        models: before.models.map((candidate) => candidate.id === modelId
          ? { ...model, updatedAt: now < model.updatedAt ? model.updatedAt : now, document: { ...model.document, fields: model.document.fields.filter((field) => field.id !== fieldId) } }
          : candidate),
        entries: before.entries.map((entry) => entry.modelId === modelId && Object.hasOwn(entry.values, fieldId)
          ? { ...entry, updatedAt: now < entry.updatedAt ? entry.updatedAt : now, values: withoutField(entry.values, fieldId) }
          : entry),
        value: undefined,
      };
    });
  }

  async seed(seed: ContentSeed): Promise<void> {
    if (!isPlainObject(seed) || !Array.isArray(seed.models) || !Array.isArray(seed.entries)) {
      throw contentError("seed", "validation", "A Content seed requires model and Entry arrays.");
    }
    const models = new Map<string, ContentModelRecord>();
    for (const model of seed.models) {
      const validation = validateContentModelRecord(model);
      if (!validation.ok) throw contentError("seed", "validation", validation.issue.message);
      assertStorableId("seed", "model", model.id);
      this.assertLocalSchema(model, "seed");
      if (models.has(model.id)) throw contentError("seed", "validation", `Duplicate seed model id "${model.id}".`);
      models.set(model.id, validation.value);
    }
    const entryIds = new Set<string>();
    const singleCounts = new Map<string, number>();
    for (const entry of seed.entries) {
      const validation = validateContentEntryRecord(entry);
      if (!validation.ok) throw contentError("seed", "validation", validation.issue.message);
      assertStorableId("seed", "Entry", entry.id);
      if (entryIds.has(entry.id)) throw contentError("seed", "validation", `Duplicate seed Entry id "${entry.id}".`);
      entryIds.add(entry.id);
      const model = models.get(entry.modelId);
      if (!model) throw contentError("seed", "validation", `Seed Entry references missing model "${entry.modelId}".`);
      assertContentEntryMatchesModel(validation.value, model, "seed");
      if (model.document.kind === "single") {
        const count = (singleCounts.get(model.id) ?? 0) + 1;
        singleCounts.set(model.id, count);
        if (count > 1) throw contentError("seed", "single-cardinality", "A Single seed permits at most one Entry.");
      }
    }
    const planned = structuredClone(seed);
    await this.mutate("seed", (before) => {
      const nextModels = [...before.models];
      for (const model of planned.models) {
        if (!nextModels.some((candidate) => candidate.id === model.id)) nextModels.push(model);
      }
      const nextEntries = [...before.entries];
      for (const entry of planned.entries) {
        const existing = nextEntries.find((candidate) => candidate.id === entry.id);
        if (existing) {
          if (existing.modelId !== entry.modelId) throw contentError("seed", "validation", `Seed Entry id "${entry.id}" conflicts with stored data.`);
          continue;
        }
        const model = nextModels.find((candidate) => candidate.id === entry.modelId);
        if (!model) throw contentError("seed", "validation", `Seed Entry references missing model "${entry.modelId}".`);
        assertContentEntryMatchesModel(entry, model, "seed");
        if (model.document.kind === "single" && nextEntries.some((candidate) => candidate.modelId === entry.modelId)) {
          throw contentError("seed", "single-cardinality", "A Single model permits at most one Entry.");
        }
        nextEntries.push(entry);
      }
      return { models: nextModels, entries: nextEntries, value: undefined };
    });
  }

  async clear(): Promise<void> {
    const scan = await this.scanForInitialization();
    if (scan.failures.length) {
      throw contentError("clear", "validation", "Content storage contains invalid data and was preserved. Use startFresh to discard it explicitly.");
    }
    await this.forceClear();
  }

  /** Discards records the scan refused to read, so it never validates them. */
  async forceClear(): Promise<void> {
    await this.mutate("clear", (before) => {
      if (!before.models.length && !before.entries.length) throw new UnchangedContent(before, undefined);
      return { models: [], entries: [], value: undefined };
    }, { validateBefore: false });
  }

  async transact(mutation: ContentMutation): Promise<ContentSnapshot> {
    this.assertMutationShape(mutation);
    const planned = structuredClone(mutation);
    const { snapshot } = await this.mutate("transact", (before) => {
      let models = [...before.models];
      let entries = [...before.entries];
      for (const operation of planned.operations) {
        switch (operation.kind) {
          case "put-model": {
            const old = models.find((model) => model.id === operation.record.id);
            if (old && (old.createdAt !== operation.record.createdAt || old.document.kind !== operation.record.document.kind)) {
              throw contentError("transact", "immutable-kind", "Model creation identity and cardinality are immutable.");
            }
            if (old && old.document.fields.some((field) => !operation.record.document.fields.some((next) => next.id === field.id))) {
              throw contentError("transact", "field-removal-required", "Use remove-field to remove stored fields.");
            }
            if (old) {
              for (const field of old.document.fields) {
                const next = operation.record.document.fields.find((candidate) => candidate.id === field.id);
                if (next && next.kind !== field.kind && entries.some((entry) => entry.modelId === old.id && Object.hasOwn(entry.values, field.id))) {
                  throw contentError("transact", "field-in-use", "Stored field kinds cannot change while entries use them.");
                }
              }
            }
            models = [...models.filter((model) => model.id !== operation.record.id), operation.record];
            break;
          }
          case "put-entry": {
            const old = entries.find((entry) => entry.id === operation.record.id);
            entries = [...entries.filter((entry) => entry.id !== operation.record.id), { ...operation.record, lifecycle: old?.lifecycle ?? operation.record.lifecycle }];
            break;
          }
          case "unpublish-entry": {
            const old = entries.find((entry) => entry.id === operation.id);
            if (!old) throw contentError("transact", "not-found", "Content Entry was not found.");
            entries = entries.map((entry) => entry.id === operation.id ? { ...entry, lifecycle: "draft" } : entry);
            break;
          }
          case "delete-entry":
            entries = entries.filter((entry) => entry.id !== operation.id);
            break;
          case "delete-model":
            models = models.filter((model) => model.id !== operation.id);
            entries = entries.filter((entry) => entry.modelId !== operation.id);
            break;
          case "remove-field": {
            const model = models.find((candidate) => candidate.id === operation.modelId);
            if (!model) throw contentError("transact", "not-found", "Content model was not found.");
            if (!model.document.fields.some((field) => field.id === operation.fieldId)) {
              throw contentError("transact", "not-found", "Field does not exist.");
            }
            const now = this.clock("transact");
            models = models.map((candidate) => candidate.id === operation.modelId
              ? { ...model, updatedAt: now < model.updatedAt ? model.updatedAt : now, document: { ...model.document, fields: model.document.fields.filter((field) => field.id !== operation.fieldId) } }
              : candidate);
            entries = entries.map((entry) => entry.modelId === operation.modelId && Object.hasOwn(entry.values, operation.fieldId)
              ? { ...entry, updatedAt: now < entry.updatedAt ? entry.updatedAt : now, values: withoutField(entry.values, operation.fieldId) }
              : entry);
            break;
          }
        }
      }
      return { models, entries, value: undefined };
    }, { expectedMutationToken: planned.expectedMutationToken });
    return snapshot;
  }

  /**
   * Validate the whole mutation envelope before any state is read, so a
   * malformed batch is rejected without ever reaching the record store — the
   * filesystem analogue of "rejects malformed operations before writes".
   */
  private assertMutationShape(mutation: ContentMutation): void {
    if (!isPlainObject(mutation)
      || Object.keys(mutation).sort().join(",") !== "expectedMutationToken,operations"
      || !Number.isSafeInteger(mutation.expectedMutationToken) || mutation.expectedMutationToken < 0
      || !Array.isArray(mutation.operations)) {
      throw contentError("transact", "validation", "Mutation requires a durable expected token and operations.");
    }
    for (const operation of mutation.operations) {
      if (!isPlainObject(operation)) throw contentError("transact", "validation", "Mutation operation must be an object.");
      const keys = operation.kind === "put-model" || operation.kind === "put-entry" ? ["kind", "record"]
        : operation.kind === "remove-field" ? ["kind", "modelId", "fieldId"]
          : ["kind", "id"];
      if (typeof operation.kind !== "string"
        || !["put-model", "put-entry", "delete-model", "delete-entry", "remove-field", "unpublish-entry"].includes(operation.kind)
        || Object.keys(operation).sort().join(",") !== keys.slice().sort().join(",")) {
        throw contentError("transact", "validation", "Unknown or malformed mutation operation.");
      }
      if (operation.kind === "put-entry" && !validateContentEntryRecord(operation.record).ok) {
        throw contentError("transact", "validation", "Invalid entry mutation.");
      }
      if (("id" in operation && !isSafeRecordId(operation.id))
        || (operation.kind === "remove-field" && (!isSafeRecordId(operation.modelId) || !isSafeRecordId(operation.fieldId)))) {
        throw contentError("transact", "validation", "Mutation identities must be safe record ids.");
      }
    }
    for (const operation of mutation.operations) {
      if (operation.kind !== "put-model") continue;
      const valid = validateContentModelRecord(operation.record);
      if (!valid.ok) throw contentError("transact", "validation", valid.issue.message);
      assertStorableId("transact", "model", operation.record.id);
      this.assertLocalSchema(operation.record, "transact");
    }
  }

  /**
   * Apply an activation's publication decisions behind a monotonic fence.
   *
   * The fence is stored with the records it guards, so a late callback from an
   * older activation — including one carrying no reconciliations at all — is
   * write-free rather than merely idempotent, and can never overwrite a newer
   * reconciled lifecycle.
   */
  async reconcilePublication(
    reconciliations: readonly ContentPublicationReconciliation[],
    activationGeneration: number,
    signal?: AbortSignal,
  ): Promise<ContentSnapshot & { activationGeneration: number }> {
    if (!Number.isSafeInteger(activationGeneration) || activationGeneration < 1) {
      throw contentError("reconcile-publication", "validation", "A positive activation fence is required.");
    }
    const seen = new Set<string>();
    for (const item of reconciliations) {
      if (!item.ref || item.ref.providerId !== this.provider.id) {
        throw contentError("reconcile-publication", "unsupported-transaction", "Cannot reconcile another provider.");
      }
      if (!isSafeRecordId(item.ref.recordId) || !isSafeRecordId(item.ref.modelId)
        || !Number.isSafeInteger(item.expectedGeneration) || item.expectedGeneration < 0
        || typeof item.expectedDigest !== "string" || !["draft", "published"].includes(item.lifecycle)
        || seen.has(item.ref.recordId)) {
        throw contentError("reconcile-publication", "validation", "Publication reconciliation must use unique valid identities and expected generations/digests.");
      }
      seen.add(item.ref.recordId);
    }
    const planned = structuredClone(reconciliations) as readonly ContentPublicationReconciliation[];
    const { snapshot, value } = await this.mutate<number>("reconcile-publication", (before, decoded) => {
      if (decoded.activationGeneration >= activationGeneration) {
        throw new UnchangedContent(before, decoded.activationGeneration);
      }
      const entries = before.entries.map((entry) => {
        const item = planned.find((candidate) => candidate.ref.recordId === entry.id);
        if (!item || entry.modelId !== item.ref.modelId) return entry;
        if (entry.generation !== item.expectedGeneration || contentEntryDigest(entry) !== item.expectedDigest) return entry;
        return { ...entry, lifecycle: item.lifecycle };
      });
      return { models: before.models, entries, activationGeneration, value: activationGeneration };
    }, signal === undefined ? {} : { signal });
    return { ...snapshot, activationGeneration: value };
  }

  async initialize(): Promise<ContentInitializationOutcome> {
    try {
      const scan = await this.scanForInitialization();
      if (scan.failures.length) return { status: "recovery-required", models: scan.models, recovery: recovery(scan.failures) };
      return { status: "ready", models: await this.listModels() };
    } catch (error) {
      return { status: "error", error: asContentError("initialize", "Content storage initialization failed.", error) };
    }
  }

  async startFresh(): Promise<ContentInitializationOutcome> {
    try {
      await this.forceClear();
      return { status: "ready", models: await this.listModels() };
    } catch (error) {
      return { status: "error", error: asContentError("clear", "Starting fresh Content storage failed.", error) };
    }
  }

  private clock(operation: Operation): string {
    const now = this.now();
    if (!isCanonicalContentTimestamp(now)) {
      throw contentError(operation, "validation", "The provider clock must return a canonical ISO timestamp.");
    }
    return now;
  }
}

function withoutField(values: ContentEntryRecord["values"], fieldId: string): ContentEntryRecord["values"] {
  const next = { ...values };
  delete next[fieldId];
  return next;
}

function asContentError(operation: Operation, message: string, error: unknown): ContentPersistenceError {
  return error instanceof ContentPersistenceError ? error : contentError(operation, "unknown", message, error);
}

function recovery(failures: readonly ContentInitializationFailure[]): ContentRecoveryOutcome {
  const future = failures.find((failure) => failure.status === "future-schema");
  return {
    kind: "quarantined",
    reason: future ? "future-schema" : "invalid",
    sourcePreserved: true,
    affectedRecordIds: failures.map((failure) => failure.id),
    ...(future?.version === undefined ? {} : { foundSchemaVersion: future.version }),
    message: future
      ? "Content storage contains records from a newer schema. The source data was preserved."
      : "Content storage contains malformed records. The source data was preserved.",
  };
}

export function createFilesystemContentStore(options: FilesystemContentStoreOptions): Promise<FilesystemContentStore> {
  return FilesystemContentStore.create(options);
}
