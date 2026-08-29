import type { CompositionBinding, CompositionDocument } from "../model/types";
import type { RecordId as CompositionRecordId } from "../../shared/record-identity";

/** A persisted composition and its storage metadata. */
export interface CompositionRecord {
  id: CompositionRecordId;
  createdAt: string;
  updatedAt: string;
  document: CompositionDocument;
}

/** The inexpensive representation returned by collection listings. */
export interface CompositionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  /**
   * Reuse-list metadata. It is optional while reading a summary written by an
   * older provider; current provider summary builders populate it.
   */
  publicationKind?: "global-template" | "pattern";
  /** Stable source-scoped outlet identity for a Global template. */
  outletId?: string;
  /** Current human label for the stable Global-template outlet. */
  outletLabel?: string;
  /** Direct children of the virtual root (distinct from the recursive node count). */
  rootCount?: number;
  /**
   * Provider-list eligibility known without loading the full source. Missing
   * values are excluded conservatively by the reusable-source catalog.
   */
  reuseStatus?: "eligible" | "empty-pattern" | "invalid";
  /**
   * Files providers may report the current generated-artifact state without
   * changing the canonical document. Other providers omit it.
   */
  derivedOutput?: CompositionDerivedOutputRecordOutcome;
}

/** One generated artifact's state after a canonical record was read or saved. */
export type CompositionDerivedOutputRecordOutcome =
  | { recordId: CompositionRecordId; status: "current" }
  | { recordId: CompositionRecordId; status: "repaired" }
  | {
      recordId: CompositionRecordId;
      status: "blocked";
      /** Actionable, provider-sanitized explanation; never stored in canonical JSON. */
      reason: string;
      /** A stale generated artifact could not be removed and is not valid output. */
      staleArtifact?: string;
    };

/**
 * A batch outcome is needed when a source change also re-evaluates its linked
 * consumers. `status` summarizes the records: blocked outranks repaired,
 * repaired outranks current.
 */
export interface CompositionDerivedOutputOutcome {
  status: "current" | "repaired" | "blocked";
  records: readonly CompositionDerivedOutputRecordOutcome[];
}

/**
 * Successful persistence has two independent truths. Canonical JSON can be
 * durably saved while a generated development artifact is blocked. Providers
 * without derived artifacts return an empty current derived-output set.
 */
export interface CompositionSaveOutcome {
  canonical: { status: "saved" };
  derived: CompositionDerivedOutputOutcome;
}

export type CompositionPutResult = CompositionSaveOutcome;

/**
 * A current canonical consumer reported by a dependency-safe source mutation.
 * It deliberately contains only display metadata and the persisted binding;
 * callers must open a consumer before deciding whether to detach it.
 */
export interface CompositionDependent {
  summary: CompositionSummary;
  binding: CompositionBinding;
}

/** A source record was either removed, absent, or kept intact for its consumers. */
export type CompositionDeleteOutcome =
  | { status: "deleted" }
  | { status: "not-found" }
  | { status: "blocked"; dependents: readonly CompositionDependent[] };

/** Result of removing a publication role through the provider-owned check. */
export type CompositionUnpublishOutcome =
  | { status: "unpublished" }
  | { status: "not-found" }
  | { status: "not-published" }
  | { status: "blocked"; dependents: readonly CompositionDependent[] };

export const COMPOSITION_PROVIDER_IDS = {
  indexeddb: "indexeddb",
  files: "files",
} as const;

export type CompositionProviderId =
  (typeof COMPOSITION_PROVIDER_IDS)[keyof typeof COMPOSITION_PROVIDER_IDS];

export interface CompositionProviderDescriptor {
  id: CompositionProviderId;
  label: string;
  /** Human-readable identity for diagnostics and storage inspection. */
  storageLabel: string;
}

export const COMPOSITION_PROVIDERS = {
  indexeddb: {
    id: COMPOSITION_PROVIDER_IDS.indexeddb,
    label: "Browser storage",
    storageLabel: "IndexedDB: zudo-composer",
  },
  files: {
    id: COMPOSITION_PROVIDER_IDS.files,
    label: "Local files",
    storageLabel: "Development composition files",
  },
} as const satisfies Record<CompositionProviderId, CompositionProviderDescriptor>;

/** A provider-qualified identity. Record ids are unique only inside a provider. */
export interface CompositionRecordRef {
  providerId: CompositionProviderId;
  recordId: CompositionRecordId;
}

export type CompositionRecordValidationCode =
  | "invalid-record"
  | "unsafe-id"
  | "record-document-id-mismatch"
  | "invalid-created-at"
  | "invalid-updated-at"
  | "invalid-timestamp-order"
  | "not-json-safe"
  | "malformed-document"
  | "future-schema";

export interface CompositionRecordValidationIssue {
  code: CompositionRecordValidationCode;
  message: string;
  foundSchemaVersion?: number;
}

export type CompositionRecordValidation =
  | { ok: true; record: CompositionRecord }
  | { ok: false; issue: CompositionRecordValidationIssue };

/** Result of decoding provider data. Storage failures are represented separately. */
export type CompositionLoadOutcome =
  | {
      status: "loaded";
      record: CompositionRecord;
      /** Present for file-provider reads; canonical loading remains successful when blocked. */
      derivedOutput?: CompositionDerivedOutputRecordOutcome;
    }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: CompositionRecordValidationIssue; raw: unknown }
  | {
      status: "future-schema";
      foundSchemaVersion: number;
      raw: unknown;
    };

export type CompositionPersistenceOperation =
  | "initialize"
  | "list"
  | "get"
  | "put"
  | "delete"
  | "clear";

export type CompositionPersistenceErrorCode =
  | "unavailable"
  | "blocked"
  | "versionchange"
  | "unsupported-version"
  | "validation"
  | "read-failed"
  | "write-failed"
  | "transaction-failed"
  | "conflict"
  | "unknown";

/** Provider-neutral error used for rejected store/initialization promises. */
export class CompositionPersistenceError extends Error {
  readonly name = "CompositionPersistenceError";

  constructor(
    readonly operation: CompositionPersistenceOperation,
    readonly code: CompositionPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Minimal async collection contract. Implementations must validate records at
 * their boundary and reject operational failures with
 * `CompositionPersistenceError`.
 */
export interface CompositionStore {
  readonly provider: CompositionProviderDescriptor;
  list(): Promise<readonly CompositionSummary[]>;
  get(id: string): Promise<CompositionLoadOutcome>;
  put(record: CompositionRecord): Promise<CompositionPutResult>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * Optional capability implemented by providers that can make the dependency
 * scan and source mutation one provider-owned operation. Do not emulate this
 * from `list`/`get`/`put`: that check-then-write sequence races new consumers.
 *
 * `CompositionStore.delete` is the ordinary CRUD method for non-template
 * callers. Reuse UI must use this capability so a Global template never has a
 * blind deletion path.
 */
export interface CompositionLifecycleStore extends CompositionStore {
  deleteWithDependencyCheck(id: string): Promise<CompositionDeleteOutcome>;
  unpublishWithDependencyCheck(id: string): Promise<CompositionUnpublishOutcome>;
  /**
   * Persist one lifecycle-produced record without exposing a partially saved
   * canonical document if derived-output work fails. This is intentionally not
   * a multi-record transaction and must never detach any other consumer.
   */
  saveLifecycleRecord(record: CompositionRecord): Promise<void>;
}

export function isCompositionLifecycleStore(store: CompositionStore): store is CompositionLifecycleStore {
  return (
    "deleteWithDependencyCheck" in store
    && typeof store.deleteWithDependencyCheck === "function"
    && "unpublishWithDependencyCheck" in store
    && typeof store.unpublishWithDependencyCheck === "function"
    && "saveLifecycleRecord" in store
    && typeof store.saveLifecycleRecord === "function"
  );
}

export type CompositionRecoveryOutcome = {
  kind: "quarantined";
  reason: "malformed" | "unsafe-id" | "future-schema";
  foundSchemaVersion?: number;
  sourcePreserved: true;
  message: string;
};

export type CompositionInitializationOutcome =
  | { status: "ready"; summaries: readonly CompositionSummary[] }
  | {
      status: "recovery-required";
      recovery: CompositionRecoveryOutcome;
    }
  | { status: "error"; error: CompositionPersistenceError };

/**
 * Explicit provider-level recovery actions. `startFresh` is intentionally
 * separate from `initialize`/`retry` because it destroys quarantined data.
 */
export interface CompositionProviderInitializer {
  initialize(): Promise<CompositionInitializationOutcome>;
  retry(): Promise<CompositionInitializationOutcome>;
  startFresh(): Promise<CompositionInitializationOutcome>;
}

export interface CompositionProvider {
  descriptor: CompositionProviderDescriptor;
  store: CompositionStore;
  initialization: CompositionProviderInitializer;
}
