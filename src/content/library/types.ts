import type { JsonValue } from "@zudo-composer/component-contract";
import type { RecordId } from "../../shared";
import type {
  ContentCompletenessDiagnostic,
  ContentEntryRecord,
  ContentLoadOutcome,
  ContentModelRecord,
  ContentEntryRef,
} from "../model";

export const CONTENT_PROVIDERS = {
  filesystem: { id: "content-filesystem", label: "Project files" },
} as const;

export type ContentProviderDescriptor = Omit<(typeof CONTENT_PROVIDERS)[keyof typeof CONTENT_PROVIDERS], "label"> & { readonly label: string };

export interface ContentModelSummary {
  id: RecordId;
  name: string;
  kind: "collection" | "single";
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentPageOptions { limit?: number; cursor?: string }
export interface ContentEntryPage { entries: readonly ContentEntryRecord[]; nextCursor?: string }
export interface ContentEntrySnapshot {
  model: ContentModelRecord;
  count: number;
  entries: readonly ContentEntryRecord[];
  diagnostics: readonly ContentCompletenessDiagnostic[];
}

// Runtime tables, not bare unions: a provider that rebuilds an error from a
// wire payload has to decide whether a received operation/code is one of ours,
// and a union alone cannot answer that at runtime.
export const CONTENT_PERSISTENCE_OPERATIONS = [
  "read-all", "transact", "reconcile-publication",
  "initialize", "list-models", "get-model", "put-model", "delete-model",
  "count-entries", "get-entry", "page-entries", "scan-entries",
  "put-entry", "delete-entry", "remove-field", "seed", "clear",
  "edit-entry", "list-revisions", "read-revision",
] as const;
export type ContentPersistenceOperation = (typeof CONTENT_PERSISTENCE_OPERATIONS)[number];

export const CONTENT_PERSISTENCE_ERROR_CODES = [
  "conflict", "reference-in-use", "dependency-in-use", "unsupported-transaction",
  "unavailable", "blocked", "versionchange", "unsupported-version",
  "validation", "not-found", "immutable-kind", "field-in-use",
  "field-removal-required", "single-cardinality", "read-failed",
  "write-failed", "transaction-failed", "invalid-cursor",
  // The mutation reached disk but its durability could not be proven. Never a
  // plain failure, and never safe to retry blindly.
  "commit-uncertain", "unknown",
  // An operation key already accepted for a different request.
  "operation-key-reuse",
] as const;
export type ContentPersistenceErrorCode = (typeof CONTENT_PERSISTENCE_ERROR_CODES)[number];

export function isContentPersistenceOperation(value: unknown): value is ContentPersistenceOperation {
  return (CONTENT_PERSISTENCE_OPERATIONS as readonly unknown[]).includes(value);
}

export function isContentPersistenceErrorCode(value: unknown): value is ContentPersistenceErrorCode {
  return (CONTENT_PERSISTENCE_ERROR_CODES as readonly unknown[]).includes(value);
}

export class ContentPersistenceError extends Error {
  readonly name = "ContentPersistenceError";
  constructor(
    readonly operation: ContentPersistenceOperation,
    readonly code: ContentPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) { super(message, options); }

  /**
   * Structured context the shared file-provider transport forwards verbatim.
   * `retryable` is not derivable from the code alone, so it has to cross the
   * wire rather than be re-guessed browser-side.
   */
  get details(): { retryable: boolean } { return { retryable: this.retryable }; }
}

export interface ContentSeed {
  models: readonly ContentModelRecord[];
  entries: readonly ContentEntryRecord[];
}

export interface ContentStore {
  readonly provider: { readonly id: string; readonly label: string };
  readonly transactionScope: "provider" | "unsupported";
  readAll(): Promise<ContentSnapshot>;
  transact(mutation: ContentMutation): Promise<ContentSnapshot>;
  reconcilePublication(reconciliations: readonly ContentPublicationReconciliation[], activationGeneration: number, signal?: AbortSignal): Promise<ContentSnapshot & { activationGeneration: number }>;
  listModels(): Promise<readonly ContentModelSummary[]>;
  getModel(id: string): Promise<ContentLoadOutcome<ContentModelRecord>>;
  putModel(record: ContentModelRecord): Promise<void>;
  deleteModel(id: string): Promise<boolean>;
  countEntries(modelId: string): Promise<number>;
  getEntry(id: string): Promise<ContentLoadOutcome<ContentEntryRecord>>;
  pageEntries(modelId: string, options?: ContentPageOptions): Promise<ContentEntryPage>;
  scanEntries(modelId: string): Promise<ContentEntrySnapshot>;
  putEntry(record: ContentEntryRecord): Promise<void>;
  deleteEntry(id: string): Promise<boolean>;
  removeField(modelId: string, fieldId: string): Promise<void>;
  seed(seed: ContentSeed): Promise<void>;
  clear(): Promise<void>;
}

/** Who wrote a revision. Supplied by trusted server code, never by a request body. */
export interface ContentProvenance { actor: { id: string } | null; source: string }
export type ContentRevisionOperationKind = "initial" | "save" | "remove-field" | "set-fields" | "restore-revision";
/**
 * One immutable working revision of one Entry, committed with the Entry change
 * that produced it. History is never pruned by an ordinary mutation.
 */
export interface ContentRevisionRecord {
  id: string;
  entry: ContentEntryRef;
  /** 1-based and contiguous per Entry; the newest revision has the highest sequence. */
  sequence: number;
  parentId: string | null;
  values: Record<RecordId, JsonValue>;
  createdAt: string;
  actor: { id: string } | null;
  source: string;
  operation: { kind: ContentRevisionOperationKind; key: string | null };
  restoredFrom?: string;
}
/** The durable answer to one keyed edit; a retry with the same key and request returns it unchanged. */
export interface ContentEditReceipt {
  actorId: string | null;
  operationKey: string;
  fingerprint: string;
  entry: ContentEntryRef;
  /** The revision the edit appended, or the unchanged head when the values already matched. */
  revisionId: string | null;
  mutationToken: number;
}
export interface ContentEntryEdit {
  entry: ContentEntryRef;
  expectedMutationToken: number;
  operation: { kind: "set-fields" | "restore-revision"; key: string };
  provenance: ContentProvenance;
  /** Digest of the complete request, so a reused key with a different request is refused. */
  fingerprint: string;
  restoredFrom?: string;
  /** Runs under the store lock against the current values; throwing refuses the edit without writing. */
  values(current: ContentEntryRecord, model: ContentModelRecord): Record<RecordId, JsonValue>;
}
export interface ContentEntryEditResult { receipt: ContentEditReceipt; replayed: boolean; snapshot: ContentSnapshot }

export interface ContentSnapshot extends ContentSeed { providerId: string; mutationToken: number }
export type ContentMutationOperation =
  | { kind: "put-model"; record: ContentModelRecord }
  | { kind: "put-entry"; record: ContentEntryRecord }
  | { kind: "delete-entry"; id: string }
  | { kind: "unpublish-entry"; id: string }
  | { kind: "delete-model"; id: string }
  | { kind: "remove-field"; modelId: string; fieldId: string };
export interface ContentMutation {
  expectedMutationToken: number;
  operations: readonly ContentMutationOperation[];
}
export interface ContentPublicationReconciliation {
  ref: ContentEntryRef;
  expectedGeneration: number;
  expectedDigest: string;
  lifecycle: ContentEntryRecord["lifecycle"];
}

export type ContentRecoveryReason = "invalid" | "future-schema";
export interface ContentRecoveryOutcome {
  kind: "quarantined";
  reason: ContentRecoveryReason;
  sourcePreserved: true;
  affectedRecordIds: readonly string[];
  foundSchemaVersion?: number;
  message: string;
}
export type ContentInitializationOutcome =
  | { status: "ready"; models: readonly ContentModelSummary[] }
  | { status: "recovery-required"; models: readonly ContentModelSummary[]; recovery: ContentRecoveryOutcome }
  | { status: "error"; error: ContentPersistenceError };

export interface ContentProvider {
  readonly descriptor: ContentProviderDescriptor;
  readonly store: ContentStore;
  readonly initialization: {
    initialize(): Promise<ContentInitializationOutcome>;
    retry(): Promise<ContentInitializationOutcome>;
    startFresh(): Promise<ContentInitializationOutcome>;
  };
}
