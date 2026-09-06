// Sitemapper persisted as project files.
//
// Like Mapping, a Sitemap record is a leaf document with no cross-record graph
// to protect, so every mutation is expressed as the complete after-state of
// the whole record set and committed in one `TransactionalRecordStore` step.
// The IndexedDB store re-validates its physical/schema metadata on every
// operation rather than trusting a previous success; the filesystem analogue
// of that is that `decode()` below re-checks the layout marker on every read
// and every mutation, never only at open.
//
// Sitemapper has no domain-visible mutation token of its own. Optimistic
// concurrency for the one operation that needs it — a whole-batch transaction —
// runs on the record store's own opaque `expectedMutationToken` instead of a
// second counter invented for this domain.

import {
  SITEMAP_PROVIDERS,
  SitemapPersistenceError,
  compareSitemapSummariesNewestFirst,
  loadSitemapRecord,
  summarizeSitemap,
  validateSitemapRecord,
} from "../../library";
import type {
  SitemapInitializationOutcome,
  SitemapPersistenceErrorCode,
  SitemapPersistenceOperation,
  SitemapProviderDescriptor,
  SitemapRecoveryOutcome,
  SitemapRecord,
  SitemapRecordLoadOutcome,
  SitemapCollectionStore,
  SitemapSummary,
} from "../../library";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import { createTransactionalRecordStore } from "../../../shared/node-fs";
import type {
  DurableExtraErrorCode,
  RecordEnvelope,
  SafeRootErrorPolicy,
  TransactionalRecordStore,
} from "../../../shared/node-fs";
import {
  SITEMAP_FILESYSTEM_LAYOUT,
  SITEMAP_META_RECORD_ID,
  SITEMAP_RECORD_SCHEMA_VERSION,
} from "./types";
import type { FilesystemSitemapStoreOptions } from "./types";

type Operation = SitemapPersistenceOperation;

/**
 * The record store reports failures against a fixed phase rather than the
 * caller's operation. Domain failures carry the exact operation, so only raw
 * filesystem failures surface as `list`/`transact`/`initialize`.
 */
const PHASES = { initialize: "initialize", snapshot: "list", commit: "transact" } as const;

function sitemapError(
  operation: Operation,
  code: SitemapPersistenceErrorCode,
  message: string,
  cause?: unknown,
): SitemapPersistenceError {
  const retryable = code === "read-failed" || code === "write-failed" || code === "conflict" || code === "transaction-failed";
  return new SitemapPersistenceError(operation, code, message, retryable, cause === undefined ? undefined : { cause });
}

const errorPolicy: SafeRootErrorPolicy<Operation, DurableExtraErrorCode> = {
  isError: (value) => value instanceof SitemapPersistenceError,
  create: (operation, code, message, cause) => sitemapError(operation, code, message, cause),
  rethrow: (operation, code, message, cause) => {
    if (cause instanceof SitemapPersistenceError) throw cause;
    throw sitemapError(operation, code, message, cause);
  },
};

export interface SitemapInitializationFailure { id: string; status: "invalid" | "future-schema"; version?: number }
export interface SitemapInitializationScan {
  summaries: readonly SitemapSummary[];
  failures: readonly SitemapInitializationFailure[];
}

interface DecodedRecord { id: string; raw: unknown; loaded: SitemapRecordLoadOutcome }
interface DecodedSitemap { records: readonly DecodedRecord[] }

/**
 * Thrown by a plan that decided nothing should be written. Throwing is what
 * guarantees it: the record store writes nothing at all when a plan throws, so
 * a no-op mutation cannot advance the mutation token.
 */
class UnchangedSitemap<T> {
  constructor(readonly value: T) {}
}

export interface SitemapTransactionStep { readonly operation: string; readonly payload?: unknown }
export interface SitemapTransactionRequest {
  readonly expectedMutationToken?: string;
  readonly steps: readonly SitemapTransactionStep[];
}
export interface SitemapTransactionResult {
  readonly mutationToken: string;
  readonly records: readonly SitemapRecord[];
}

function envelope(id: string, value: unknown): RecordEnvelope {
  return { id, json: `${JSON.stringify(value, null, 2)}\n` };
}

function sameLayout(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(SITEMAP_FILESYSTEM_LAYOUT);
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rawId(raw: unknown, fallback: string): string {
  return raw !== null && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : fallback;
}

function assertStorableId(operation: Operation, id: string): void {
  if (id === SITEMAP_META_RECORD_ID) {
    throw sitemapError(operation, "validation", `Sitemap id "${id}" is reserved for storage metadata.`);
  }
}

function field(payload: unknown, key: string): unknown {
  return payload === null || typeof payload !== "object" ? undefined : (payload as Record<string, unknown>)[key];
}

export class FilesystemSitemapStore implements SitemapCollectionStore {
  readonly provider: SitemapProviderDescriptor = SITEMAP_PROVIDERS.filesystem;

  private constructor(private readonly records: TransactionalRecordStore<Operation>) {}

  static async create(options: FilesystemSitemapStoreOptions): Promise<FilesystemSitemapStore> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.sitemapsRoot,
      schemaVersion: SITEMAP_RECORD_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Sitemap records root",
      ownerLabel: "Sitemap",
      recordLabel: "sitemap record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
    });
    const store = new FilesystemSitemapStore(records);
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
        if (before.records.length > 0) throw new UnchangedSitemap(null);
        return { records: [envelope(SITEMAP_META_RECORD_ID, { layout: SITEMAP_FILESYSTEM_LAYOUT })], result: null };
      });
    } catch (cause) {
      if (!(cause instanceof UnchangedSitemap)) throw cause;
    }
  }

  // ---------------------------------------------------------------- decoding

  /** Re-checks the layout marker on every call — never only at open. */
  private decode(snapshot: { records: readonly RecordEnvelope[] }, operation: Operation): DecodedSitemap {
    const metaJson = snapshot.records.find((record) => record.id === SITEMAP_META_RECORD_ID)?.json;
    if (metaJson === undefined) {
      throw sitemapError(operation, "unsupported-version", "Sitemap storage has no layout marker. Records are preserved; explicit recovery is required.");
    }
    const meta: unknown = this.parse(operation, SITEMAP_META_RECORD_ID, metaJson);
    if (!isPlainObject(meta) || Object.keys(meta).join(",") !== "layout" || !sameLayout(meta.layout)) {
      throw sitemapError(operation, "unsupported-version", "Sitemap storage layout marker is missing or unsupported. Records are preserved; explicit recovery is required.");
    }
    const records: DecodedRecord[] = [];
    for (const record of snapshot.records) {
      if (record.id === SITEMAP_META_RECORD_ID) continue;
      const raw = this.parse(operation, record.id, record.json);
      records.push({ id: record.id, raw, loaded: loadSitemapRecord(raw) });
    }
    return { records: records.sort(compareById) };
  }

  private parse(operation: Operation, id: string, json: string): unknown {
    try {
      return JSON.parse(json);
    } catch (cause) {
      throw sitemapError(operation, "blocked", `Sitemap record "${id}" is not valid JSON. It was preserved; explicit recovery is required.`, cause);
    }
  }

  /** Every record must load, exactly as the IndexedDB snapshot path requires. */
  private strict(decoded: DecodedSitemap, operation: Operation): SitemapRecord[] {
    return decoded.records.map((record) => {
      if (record.loaded.status !== "loaded") throw sitemapError(operation, "validation", "Invalid Sitemap data was preserved. Use explicit recovery.");
      return record.loaded.record;
    });
  }

  private envelopes(records: readonly SitemapRecord[], operation: Operation): RecordEnvelope[] {
    return [
      envelope(SITEMAP_META_RECORD_ID, { layout: SITEMAP_FILESYSTEM_LAYOUT }),
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
      if (cause instanceof UnchangedSitemap) return cause.value as T;
      if (cause instanceof SitemapPersistenceError) throw cause;
      throw sitemapError(operation, "transaction-failed", `The Sitemap ${operation} transaction did not complete.`, cause);
    }
  }

  /**
   * Run one whole mutation. `plan` sees the complete validated before-state and
   * returns the complete after-state.
   */
  private mutate<T>(
    operation: Operation,
    plan: (before: readonly SitemapRecord[]) => { records: readonly SitemapRecord[]; value: T } | Promise<{ records: readonly SitemapRecord[]; value: T }>,
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
   * Re-checks the layout marker like every other read, matching the IndexedDB
   * store's own `mutationToken()`, which validates schema metadata before
   * returning the token rather than trusting a previous successful read.
   */
  async mutationToken(): Promise<string> {
    return (await this.snapshot()).mutationToken;
  }

  async snapshot(): Promise<{ mutationToken: string; records: readonly SitemapRecord[] }> {
    const context = await this.records.snapshot();
    return { mutationToken: context.mutationToken, records: this.strict(this.decode(context, "list"), "list") };
  }

  async readAll(): Promise<readonly SitemapRecord[]> {
    return (await this.snapshot()).records;
  }

  async list(): Promise<readonly SitemapSummary[]> {
    const scan = await this.scanForInitialization("list");
    if (scan.failures.length) throw sitemapError("list", "validation", "Sitemapper storage contains records that cannot be listed safely.");
    return scan.summaries;
  }

  async get(id: string): Promise<SitemapRecordLoadOutcome> {
    if (!isSafeRecordId(id)) return { status: "not-found", id };
    const decoded = this.decode(await this.records.snapshot(), "get");
    const record = decoded.records.find((candidate) => candidate.id === id);
    return record === undefined ? { status: "not-found", id } : record.loaded;
  }

  async scanForInitialization(operation: "initialize" | "list" = "initialize"): Promise<SitemapInitializationScan> {
    const decoded = this.decode(await this.records.snapshot(), operation);
    const summaries: SitemapSummary[] = [];
    const failures: SitemapInitializationFailure[] = [];
    decoded.records.forEach((record, index) => {
      if (record.loaded.status === "loaded") {
        summaries.push(summarizeSitemap(record.loaded.record));
      } else if (record.loaded.status !== "not-found") {
        failures.push({
          id: rawId(record.raw, `unknown-${index + 1}`),
          status: record.loaded.status,
          ...(record.loaded.status === "future-schema" ? { version: record.loaded.foundSchemaVersion } : {}),
        });
      }
    });
    return { summaries: summaries.sort(compareSitemapSummariesNewestFirst), failures };
  }

  // --------------------------------------------------------------- mutations

  async put(record: SitemapRecord): Promise<void> {
    const validation = validateSitemapRecord(record);
    if (!validation.ok) throw sitemapError("put", "validation", validation.issue.message);
    const next = structuredClone(validation.record);
    assertStorableId("put", next.id);
    await this.mutate("put", (before) => ({
      records: [...before.filter((candidate) => candidate.id !== next.id), next],
      value: undefined,
    }));
  }

  async delete(id: string): Promise<boolean> {
    if (!isSafeRecordId(id)) return false;
    return this.mutate("delete", (before) => {
      if (!before.some((candidate) => candidate.id === id)) throw new UnchangedSitemap(false);
      return { records: before.filter((candidate) => candidate.id !== id), value: true };
    });
  }

  async seed(records: readonly SitemapRecord[]): Promise<void> {
    const validated: SitemapRecord[] = [];
    const ids = new Set<string>();
    for (const record of records) {
      const validation = validateSitemapRecord(record);
      if (!validation.ok) throw sitemapError("put", "validation", validation.issue.message);
      if (ids.has(validation.record.id)) throw sitemapError("put", "validation", `Duplicate seed Sitemap id "${validation.record.id}".`);
      ids.add(validation.record.id);
      assertStorableId("put", validation.record.id);
      validated.push(structuredClone(validation.record));
    }
    await this.mutate("put", (before) => {
      const next = [...before];
      for (const record of validated) {
        if (!next.some((candidate) => candidate.id === record.id)) next.push(record);
      }
      return { records: next, value: undefined };
    });
  }

  async clear(): Promise<void> {
    await this.mutate("clear", (before) => {
      if (!before.length) throw new UnchangedSitemap(undefined);
      return { records: [], value: undefined };
    });
  }

  /** Discards records the scan refused to read, so it never validates them. */
  async forceClear(): Promise<void> {
    await this.runCommit("clear", () => this.records.commit((context) => {
      const decoded = this.decode(context, "clear");
      if (!decoded.records.length) throw new UnchangedSitemap(undefined);
      return { records: [envelope(SITEMAP_META_RECORD_ID, { layout: SITEMAP_FILESYSTEM_LAYOUT })], result: undefined };
    }));
  }

  /**
   * Apply a whole batch of steps as one commit, protected by the record
   * store's own opaque mutation token. Sitemapper has no atomic batch of its
   * own, so this is what the shared `{expectedMutationToken, steps}` wire
   * envelope drives instead of a bespoke `transact` operation.
   */
  async applyTransaction(request: SitemapTransactionRequest): Promise<SitemapTransactionResult> {
    const records = await this.mutate<readonly SitemapRecord[]>("transact", (before) => {
      let current = before;
      for (const step of request.steps) current = this.applyStep(current, step);
      return { records: current, value: current };
    }, { expectedMutationToken: request.expectedMutationToken });
    return { mutationToken: await this.mutationToken(), records };
  }

  private applyStep(records: readonly SitemapRecord[], step: SitemapTransactionStep): readonly SitemapRecord[] {
    switch (step.operation) {
      case "put": {
        const validation = validateSitemapRecord(field(step.payload, "record"));
        if (!validation.ok) throw sitemapError("transact", "validation", validation.issue.message);
        const next = structuredClone(validation.record);
        assertStorableId("transact", next.id);
        return [...records.filter((candidate) => candidate.id !== next.id), next];
      }
      case "delete": {
        const id = field(step.payload, "id");
        if (typeof id !== "string") throw sitemapError("transact", "validation", "A delete step requires a Sitemap id.");
        return records.filter((candidate) => candidate.id !== id);
      }
      case "clear":
        return [];
      default:
        throw sitemapError("transact", "validation", `Unsupported Sitemap transaction step "${step.operation}".`);
    }
  }

  async initialize(): Promise<SitemapInitializationOutcome> {
    try {
      const scan = await this.scanForInitialization("initialize");
      if (scan.failures.length) return { status: "recovery-required", summaries: scan.summaries, recovery: recovery(scan.failures) };
      return { status: "ready", summaries: await this.list() };
    } catch (error) {
      return { status: "error", error: asSitemapError("initialize", "Sitemap storage initialization failed.", error) };
    }
  }

  async startFresh(): Promise<SitemapInitializationOutcome> {
    try {
      await this.forceClear();
      return { status: "ready", summaries: await this.list() };
    } catch (error) {
      return { status: "error", error: asSitemapError("clear", "Starting fresh Sitemap storage failed.", error) };
    }
  }
}

function asSitemapError(operation: Operation, message: string, error: unknown): SitemapPersistenceError {
  return error instanceof SitemapPersistenceError ? error : sitemapError(operation, "unknown", message, error);
}

function recovery(failures: readonly SitemapInitializationFailure[]): SitemapRecoveryOutcome {
  const future = failures.find((failure) => failure.status === "future-schema");
  return {
    kind: "quarantined",
    reason: future ? "future-schema" : "invalid",
    sourcePreserved: true,
    affectedRecordIds: failures.map((failure) => failure.id),
    ...(future?.version === undefined ? {} : { foundSchemaVersion: future.version }),
    message: future
      ? "Sitemap storage contains records from a newer schema. The source data was preserved."
      : "Sitemap storage contains malformed records. The source data was preserved.",
  };
}

export function createFilesystemSitemapStore(options: FilesystemSitemapStoreOptions): Promise<FilesystemSitemapStore> {
  return FilesystemSitemapStore.create(options);
}
