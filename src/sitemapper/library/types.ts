import type { RecordId } from "../../shared";
import type { SitemapDocument } from "../model";

/** A persisted sitemap and its storage metadata. */
export interface SitemapRecord {
  id: RecordId;
  createdAt: string;
  updatedAt: string;
  document: SitemapDocument;
}

/** The inexpensive representation returned by collection listings. */
export interface SitemapSummary {
  id: RecordId;
  name: string;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  /** Pages with no Composition and no Mapping — the library's assignment chip. */
  unassignedCount: number;
}

export type SitemapRecordValidationCode =
  | "invalid-record"
  | "invalid-record-keys"
  | "unsafe-id"
  | "record-document-id-mismatch"
  | "invalid-created-at"
  | "invalid-updated-at"
  | "invalid-timestamp-order"
  | "not-json-safe"
  | "malformed-document"
  | "future-schema";

export interface SitemapRecordValidationIssue {
  code: SitemapRecordValidationCode;
  message: string;
  foundSchemaVersion?: number;
}

export type SitemapRecordValidation =
  | { ok: true; record: SitemapRecord }
  | { ok: false; issue: SitemapRecordValidationIssue };

/** Decode failures preserve the exact provider value for recovery. */
export type SitemapRecordLoadOutcome =
  | { status: "loaded"; record: SitemapRecord }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: SitemapRecordValidationIssue; raw: unknown }
  | { status: "future-schema"; foundSchemaVersion: number; raw: unknown };

// Runtime tables, not bare unions: a provider that rebuilds an error from a
// wire payload has to decide whether a received operation/code is one of ours,
// and a union alone cannot answer that at runtime.
export const SITEMAP_PERSISTENCE_OPERATIONS = [
  "initialize",
  "list",
  "get",
  "put",
  "delete",
  "clear",
  "transact",
] as const;
export type SitemapPersistenceOperation = (typeof SITEMAP_PERSISTENCE_OPERATIONS)[number];

export const SITEMAP_PERSISTENCE_ERROR_CODES = [
  "unavailable",
  "blocked",
  "versionchange",
  "unsupported-version",
  "validation",
  "conflict",
  "read-failed",
  "write-failed",
  "transaction-failed",
  "commit-uncertain",
  "unknown",
] as const;
export type SitemapPersistenceErrorCode = (typeof SITEMAP_PERSISTENCE_ERROR_CODES)[number];

export function isSitemapPersistenceOperation(value: unknown): value is SitemapPersistenceOperation {
  return (SITEMAP_PERSISTENCE_OPERATIONS as readonly unknown[]).includes(value);
}

export function isSitemapPersistenceErrorCode(value: unknown): value is SitemapPersistenceErrorCode {
  return (SITEMAP_PERSISTENCE_ERROR_CODES as readonly unknown[]).includes(value);
}

/** Operational provider failure. Decode and record validation use outcomes. */
export class SitemapPersistenceError extends Error {
  readonly name = "SitemapPersistenceError";

  constructor(
    readonly operation: SitemapPersistenceOperation,
    readonly code: SitemapPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  /**
   * Structured context the shared file-provider transport forwards verbatim.
   * `retryable` is not derivable from the code alone, so it has to cross the
   * wire rather than be re-guessed browser-side.
   */
  get details(): { retryable: boolean } { return { retryable: this.retryable }; }
}

export interface SitemapStore {
  snapshot?(): Promise<import("../../shared/persistence-generation").PersistedSnapshot<SitemapRecord>>;
  mutationToken?(): Promise<number | string>;
  list(): Promise<readonly SitemapSummary[]>;
  get(id: string): Promise<SitemapRecordLoadOutcome>;
  put(record: SitemapRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export interface SitemapCollectionStore extends SitemapStore {
  seed(records: readonly SitemapRecord[]): Promise<void>;
  readAll(): Promise<readonly SitemapRecord[]>;
}

export function isSitemapCollectionStore(store: SitemapStore): store is SitemapCollectionStore {
  return "seed" in store && typeof store.seed === "function"
    && "readAll" in store && typeof store.readAll === "function";
}

export const SITEMAP_PROVIDERS = {
  filesystem: { id: "sitemap-filesystem", label: "Project files" },
} as const;
export type SitemapProviderDescriptor = (typeof SITEMAP_PROVIDERS)[keyof typeof SITEMAP_PROVIDERS];

export type SitemapLibraryRecoveryReason = "invalid" | "future-schema";

export interface SitemapRecoveryOutcome {
  kind: "quarantined";
  reason: SitemapLibraryRecoveryReason;
  sourcePreserved: true;
  affectedRecordIds: readonly string[];
  foundSchemaVersion?: number;
  message: string;
}

export type SitemapInitializationOutcome =
  | { status: "ready"; summaries: readonly SitemapSummary[] }
  | {
      status: "recovery-required";
      summaries: readonly SitemapSummary[];
      recovery: SitemapRecoveryOutcome;
    }
  | { status: "error"; error: SitemapPersistenceError };

export interface SitemapProviderInitializer {
  initialize(): Promise<SitemapInitializationOutcome>;
  retry(): Promise<SitemapInitializationOutcome>;
  startFresh(): Promise<SitemapInitializationOutcome>;
}

export interface SitemapProvider {
  descriptor?: SitemapProviderDescriptor;
  store: SitemapStore;
  initialization: SitemapProviderInitializer;
}
