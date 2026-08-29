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

export type SitemapPersistenceOperation =
  | "initialize"
  | "list"
  | "get"
  | "put"
  | "delete"
  | "clear";

export type SitemapPersistenceErrorCode =
  | "unavailable"
  | "blocked"
  | "versionchange"
  | "unsupported-version"
  | "validation"
  | "read-failed"
  | "write-failed"
  | "transaction-failed"
  | "unknown";

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
}

export interface SitemapStore {
  list(): Promise<readonly SitemapSummary[]>;
  get(id: string): Promise<SitemapRecordLoadOutcome>;
  put(record: SitemapRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

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
  store: SitemapStore;
  initialization: SitemapProviderInitializer;
}
