import type { RecordId } from "../../shared";
import type {
  ContentCompletenessDiagnostic,
  ContentEntryRecord,
  ContentLoadOutcome,
  ContentModelRecord,
} from "../model";

export const CONTENT_PROVIDERS = {
  indexeddb: { id: "content-indexeddb", label: "Browser storage" },
} as const;

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

export type ContentPersistenceOperation =
  | "initialize" | "list-models" | "get-model" | "put-model" | "delete-model"
  | "count-entries" | "get-entry" | "page-entries" | "scan-entries"
  | "put-entry" | "delete-entry" | "remove-field" | "seed" | "clear";
export type ContentPersistenceErrorCode =
  | "unavailable" | "blocked" | "versionchange" | "unsupported-version"
  | "validation" | "not-found" | "immutable-kind" | "field-in-use"
  | "field-removal-required" | "single-cardinality" | "read-failed"
  | "write-failed" | "transaction-failed" | "invalid-cursor" | "unknown";

export class ContentPersistenceError extends Error {
  readonly name = "ContentPersistenceError";
  constructor(
    readonly operation: ContentPersistenceOperation,
    readonly code: ContentPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) { super(message, options); }
}

export interface ContentSeed {
  models: readonly ContentModelRecord[];
  entries: readonly ContentEntryRecord[];
}

export interface ContentStore {
  readonly provider: { readonly id: string; readonly label: string };
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
  readonly descriptor: typeof CONTENT_PROVIDERS.indexeddb;
  readonly store: ContentStore;
  readonly initialization: {
    initialize(): Promise<ContentInitializationOutcome>;
    retry(): Promise<ContentInitializationOutcome>;
    startFresh(): Promise<ContentInitializationOutcome>;
  };
}
