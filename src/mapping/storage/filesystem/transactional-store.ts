// Mapping persisted as project files.
//
// Mapping has no cross-record graph to protect — a Mapping record is a leaf
// document, not a node with inbound references — so every mutation is
// expressed as the complete after-state of the whole record set and committed
// in one `TransactionalRecordStore` step, exactly like Content, without any of
// Content's graph validation or activation fence.
//
// Mapping has no domain-visible mutation token of its own. Optimistic
// concurrency for the one operation that needs it — a whole-batch transaction —
// runs on the record store's own opaque `expectedMutationToken` instead of a
// second counter invented for this domain.

import {
  MAPPING_PROVIDERS,
  MappingPersistenceError,
  decodeMappingRecord,
  summarizeMapping,
  validateMappingRecord,
} from "../../model";
import type {
  MappingInitializationOutcome,
  MappingLoadOutcome,
  MappingPersistenceErrorCode,
  MappingPersistenceOperation,
  MappingProviderDescriptor,
  MappingRecord,
  MappingRecoveryOutcome,
  MappingSeed,
  MappingStore,
  MappingSummary,
} from "../../model";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import type { RecordTransactionStorage } from "../../../shared/record-transaction-storage";
import type {
  DurableExtraErrorCode,
  RecordEnvelope,
  SafeRootErrorPolicy,
} from "../../../shared/node-fs";
import {
  MAPPING_FILESYSTEM_LAYOUT,
  MAPPING_META_RECORD_ID,
} from "./types";

type Operation = MappingPersistenceOperation;

/**
 * The record store reports failures against a fixed phase rather than the
 * caller's operation. Domain failures — every validation and immutability rule
 * below — carry the exact operation, so only raw filesystem failures surface
 * as `list`/`transact`/`initialize`.
 */
export const PHASES = { initialize: "initialize", snapshot: "list", commit: "transact" } as const;

function mappingError(
  operation: Operation,
  code: MappingPersistenceErrorCode,
  message: string,
  cause?: unknown,
): MappingPersistenceError {
  const retryable = code === "read-failed" || code === "write-failed" || code === "conflict" || code === "transaction-failed";
  return new MappingPersistenceError(operation, code, message, retryable, cause === undefined ? undefined : { cause });
}

export const errorPolicy: SafeRootErrorPolicy<Operation, DurableExtraErrorCode> = {
  isError: (value) => value instanceof MappingPersistenceError,
  create: (operation, code, message, cause) => mappingError(operation, code, message, cause),
  rethrow: (operation, code, message, cause) => {
    if (cause instanceof MappingPersistenceError) throw cause;
    throw mappingError(operation, code, message, cause);
  },
};

export interface MappingInitializationFailure { id: string; status: "invalid" | "future-schema"; version?: number }
export interface MappingInitializationScan {
  summaries: readonly MappingSummary[];
  failures: readonly MappingInitializationFailure[];
}

interface DecodedRecord { id: string; raw: unknown; loaded: MappingLoadOutcome }
interface DecodedMapping { records: readonly DecodedRecord[] }

/**
 * Thrown by a plan that decided nothing should be written. Throwing is what
 * guarantees it: the record store writes nothing at all when a plan throws, so
 * a no-op mutation cannot advance the mutation token.
 */
class UnchangedMapping<T> {
  constructor(readonly value: T) {}
}

export interface MappingTransactionStep { readonly operation: string; readonly payload?: unknown }
export interface MappingTransactionRequest {
  readonly expectedMutationToken?: string;
  readonly steps: readonly MappingTransactionStep[];
}
export interface MappingTransactionResult {
  readonly mutationToken: string;
  readonly records: readonly MappingRecord[];
}

function envelope(id: string, value: unknown): RecordEnvelope {
  return { id, json: `${JSON.stringify(value, null, 2)}\n` };
}

function sameLayout(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(MAPPING_FILESYSTEM_LAYOUT);
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}

function assertStorableId(operation: Operation, id: string): void {
  if (id === MAPPING_META_RECORD_ID) {
    throw mappingError(operation, "validation", `Mapping id "${id}" is reserved for storage metadata.`);
  }
}

function field(payload: unknown, key: string): unknown {
  return payload === null || typeof payload !== "object" ? undefined : (payload as Record<string, unknown>)[key];
}

export class TransactionalMappingStore implements MappingStore {
  readonly provider: MappingProviderDescriptor = MAPPING_PROVIDERS.filesystem;

  protected constructor(private readonly records: RecordTransactionStorage) {}

  static async fromRecords(records: RecordTransactionStorage): Promise<TransactionalMappingStore> {
    const store = new this(records);
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
        if (before.records.length > 0) throw new UnchangedMapping(null);
        return { records: [envelope(MAPPING_META_RECORD_ID, { layout: MAPPING_FILESYSTEM_LAYOUT })], result: null };
      });
    } catch (cause) {
      if (!(cause instanceof UnchangedMapping)) throw cause;
    }
  }

  // ---------------------------------------------------------------- decoding

  private decode(snapshot: { records: readonly RecordEnvelope[] }, operation: Operation): DecodedMapping {
    const metaJson = snapshot.records.find((record) => record.id === MAPPING_META_RECORD_ID)?.json;
    if (metaJson === undefined) {
      throw mappingError(operation, "unsupported-version", "Mapping storage has no layout marker. Records are preserved; explicit recovery is required.");
    }
    const meta: unknown = this.parse(operation, MAPPING_META_RECORD_ID, metaJson);
    if (!isPlainObject(meta) || Object.keys(meta).join(",") !== "layout" || !sameLayout(meta.layout)) {
      throw mappingError(operation, "unsupported-version", "Mapping storage layout marker is missing or unsupported. Records are preserved; explicit recovery is required.");
    }
    const records: DecodedRecord[] = [];
    for (const record of snapshot.records) {
      if (record.id === MAPPING_META_RECORD_ID) continue;
      const raw = this.parse(operation, record.id, record.json);
      records.push({ id: record.id, raw, loaded: decodeMappingRecord(raw) });
    }
    return { records: records.sort(compareById) };
  }

  private parse(operation: Operation, id: string, json: string): unknown {
    try {
      return JSON.parse(json);
    } catch (cause) {
      throw mappingError(operation, "blocked", `Mapping record "${id}" is not valid JSON. It was preserved; explicit recovery is required.`, cause);
    }
  }

  /** Every record must load; a snapshot is all-or-nothing. */
  private strict(decoded: DecodedMapping, operation: Operation): MappingRecord[] {
    return decoded.records.map((record) => {
      if (record.loaded.status !== "loaded") throw mappingError(operation, "validation", "Invalid Mapping data was preserved. Use explicit recovery.");
      return record.loaded.record;
    });
  }

  private envelopes(records: readonly MappingRecord[], operation: Operation): RecordEnvelope[] {
    return [
      envelope(MAPPING_META_RECORD_ID, { layout: MAPPING_FILESYSTEM_LAYOUT }),
      ...[...records].sort(compareById).map((record) => {
        assertStorableId(operation, record.id);
        return envelope(record.id, record);
      }),
    ];
  }

  // ---------------------------------------------------------------- mutation

  private async runCommit<T>(operation: Operation, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof UnchangedMapping) return cause.value as T;
      if (cause instanceof MappingPersistenceError) throw cause;
      throw mappingError(operation, "transaction-failed", `The Mapping ${operation} transaction did not complete.`, cause);
    }
  }

  /**
   * Run one whole mutation.
   *
   * `plan` sees the complete validated before-state and returns the complete
   * after-state.
   */
  private mutate<T>(
    operation: Operation,
    plan: (before: readonly MappingRecord[]) => { records: readonly MappingRecord[]; value: T } | Promise<{ records: readonly MappingRecord[]; value: T }>,
    options: { expectedMutationToken?: string } = {},
  ): Promise<T> {
    return this.runCommit(operation, () => this.records.commit(async (context) => {
      const before = this.strict(this.decode(context, operation), operation);
      const planned = await plan(before);
      return { records: this.envelopes(planned.records, operation), result: planned.value };
    }, { expectedMutationToken: options.expectedMutationToken }));
  }

  // ------------------------------------------------------------------- reads

  /**
   * Re-checks the layout marker like every other read, rather than trusting a
   * previous successful read.
   */
  async mutationToken(): Promise<string> {
    return (await this.snapshot()).mutationToken;
  }

  async snapshot(): Promise<{ mutationToken: string; records: readonly MappingRecord[] }> {
    const context = await this.records.snapshot();
    return { mutationToken: context.mutationToken, records: this.strict(this.decode(context, "list"), "list") };
  }

  async readAll(): Promise<readonly MappingRecord[]> {
    return (await this.snapshot()).records;
  }

  async list(): Promise<readonly MappingSummary[]> {
    const scan = await this.scanForInitialization("list");
    if (scan.failures.length) throw mappingError("list", "validation", "Mapping storage contains records that cannot be listed safely.");
    return scan.summaries;
  }

  async get(id: string): Promise<MappingLoadOutcome> {
    if (!isSafeRecordId(id)) return { status: "not-found", id };
    const decoded = this.decode(await this.records.snapshot(), "get");
    const record = decoded.records.find((candidate) => candidate.id === id);
    return record === undefined ? { status: "not-found", id } : record.loaded;
  }

  async scanForInitialization(operation: "initialize" | "list" = "initialize"): Promise<MappingInitializationScan> {
    const decoded = this.decode(await this.records.snapshot(), operation);
    const summaries: MappingSummary[] = [];
    const failures: MappingInitializationFailure[] = [];
    decoded.records.forEach((record, index) => {
      if (record.loaded.status === "loaded") {
        summaries.push(summarizeMapping(record.loaded.record));
      } else if (record.loaded.status !== "not-found") {
        failures.push({
          id: rawId(record.raw, `unknown-${index + 1}`),
          status: record.loaded.status,
          ...(record.loaded.status === "future-schema" ? { version: record.loaded.foundSchemaVersion } : {}),
        });
      }
    });
    return { summaries: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)), failures };
  }

  // --------------------------------------------------------------- mutations

  async put(record: MappingRecord): Promise<void> {
    const validation = validateMappingRecord(record);
    if (!validation.ok) throw mappingError("put", "validation", validation.issue.message);
    const next = structuredClone(validation.record);
    assertStorableId("put", next.id);
    await this.mutate("put", (before) => {
      const existing = before.find((candidate) => candidate.id === next.id);
      if (existing && existing.createdAt !== next.createdAt) {
        throw mappingError("put", "validation", "Mapping createdAt is immutable after persistence.");
      }
      return { records: [...before.filter((candidate) => candidate.id !== next.id), next], value: undefined };
    });
  }

  async delete(id: string): Promise<boolean> {
    if (!isSafeRecordId(id)) return false;
    return this.mutate("delete", (before) => {
      if (!before.some((candidate) => candidate.id === id)) throw new UnchangedMapping(false);
      return { records: before.filter((candidate) => candidate.id !== id), value: true };
    });
  }

  async seed(seed: MappingSeed): Promise<void> {
    if (!isPlainObject(seed) || !Array.isArray(seed.mappings)) {
      throw mappingError("seed", "validation", "A Mapping seed requires a mappings array.");
    }
    const validated: MappingRecord[] = [];
    const ids = new Set<string>();
    for (const record of seed.mappings) {
      const validation = validateMappingRecord(record);
      if (!validation.ok) throw mappingError("seed", "validation", validation.issue.message);
      if (ids.has(validation.record.id)) throw mappingError("seed", "validation", `Duplicate seed Mapping id "${validation.record.id}".`);
      ids.add(validation.record.id);
      assertStorableId("seed", validation.record.id);
      validated.push(structuredClone(validation.record));
    }
    await this.mutate("seed", (before) => {
      const records = [...before];
      for (const record of validated) {
        if (!records.some((candidate) => candidate.id === record.id)) records.push(record);
      }
      return { records, value: undefined };
    });
  }

  async clear(): Promise<void> {
    await this.mutate("clear", (before) => {
      if (!before.length) throw new UnchangedMapping(undefined);
      return { records: [], value: undefined };
    });
  }

  /** Discards records the scan refused to read, so it never validates them. */
  async forceClear(): Promise<void> {
    await this.runCommit("clear", () => this.records.commit((context) => {
      const decoded = this.decode(context, "clear");
      if (!decoded.records.length) throw new UnchangedMapping(undefined);
      return { records: [envelope(MAPPING_META_RECORD_ID, { layout: MAPPING_FILESYSTEM_LAYOUT })], result: undefined };
    }));
  }

  /**
   * Apply a whole batch of steps as one commit, protected by the record
   * store's own opaque mutation token. Mapping has no atomic batch of its own,
   * so this is what the shared `{expectedMutationToken, steps}` wire envelope
   * drives instead of a bespoke `transact` operation.
   */
  async applyTransaction(request: MappingTransactionRequest): Promise<MappingTransactionResult> {
    await this.mutate<readonly MappingRecord[]>("transact", (before) => {
      let current = before;
      for (const step of request.steps) current = this.applyStep(current, step);
      return { records: current, value: current };
    }, { expectedMutationToken: request.expectedMutationToken });
    // Token and records must come from ONE read. Taking the token separately
    // after the commit lock is released lets another writer's token be paired
    // with this transaction's records, and the caller quotes that token back as
    // its next `expectedMutationToken` — a CAS that passes against state it
    // never saw.
    return this.snapshot();
  }

  private applyStep(records: readonly MappingRecord[], step: MappingTransactionStep): readonly MappingRecord[] {
    switch (step.operation) {
      case "put": {
        const validation = validateMappingRecord(field(step.payload, "record"));
        if (!validation.ok) throw mappingError("transact", "validation", validation.issue.message);
        const next = structuredClone(validation.record);
        assertStorableId("transact", next.id);
        const existing = records.find((candidate) => candidate.id === next.id);
        if (existing && existing.createdAt !== next.createdAt) {
          throw mappingError("transact", "validation", "Mapping createdAt is immutable after persistence.");
        }
        return [...records.filter((candidate) => candidate.id !== next.id), next];
      }
      case "delete": {
        const id = field(step.payload, "id");
        if (typeof id !== "string") throw mappingError("transact", "validation", "A delete step requires a Mapping id.");
        return records.filter((candidate) => candidate.id !== id);
      }
      case "clear":
        return [];
      default:
        throw mappingError("transact", "validation", `Unsupported Mapping transaction step "${step.operation}".`);
    }
  }

  async initialize(): Promise<MappingInitializationOutcome> {
    try {
      const scan = await this.scanForInitialization("initialize");
      if (scan.failures.length) return { status: "recovery-required", summaries: scan.summaries, recovery: recovery(scan.failures) };
      return { status: "ready", summaries: await this.list() };
    } catch (error) {
      return { status: "error", error: asMappingError("initialize", "Mapping storage initialization failed.", error) };
    }
  }

  async startFresh(): Promise<MappingInitializationOutcome> {
    try {
      await this.forceClear();
      return { status: "ready", summaries: await this.list() };
    } catch (error) {
      return { status: "error", error: asMappingError("clear", "Starting fresh Mapping storage failed.", error) };
    }
  }
}

function asMappingError(operation: Operation, message: string, error: unknown): MappingPersistenceError {
  return error instanceof MappingPersistenceError ? error : mappingError(operation, "unknown", message, error);
}

function recovery(failures: readonly MappingInitializationFailure[]): MappingRecoveryOutcome {
  const future = failures.find((failure) => failure.status === "future-schema");
  return {
    kind: "quarantined",
    reason: future ? "future-schema" : "invalid",
    sourcePreserved: true,
    affectedRecordIds: failures.map((failure) => failure.id),
    ...(future?.version === undefined ? {} : { foundSchemaVersion: future.version }),
    message: future
      ? "Mapping storage contains records from a newer schema. The source data was preserved."
      : "Mapping storage contains malformed records. The source data was preserved.",
  };
}

