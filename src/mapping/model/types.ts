import type { FieldDefinition, JsonValue } from "@zudo-composer/component-contract";
import type { CompositionRecordRef } from "../../composer/library";
import type { ContentModelRef } from "../../content/catalog";
import type { ContentFieldDefinition } from "../../content/model";
import type { RecordId } from "../../shared";

export const MAPPING_SCHEMA_VERSION = 2 as const;

export type MappingMode =
  | { kind: "single" }
  | { kind: "collection"; query: MappingCollectionQuery };

export type MappingCollectionConditionOperator = "equals" | "not-equals" | "contains" | "exists";
export interface MappingCollectionCondition {
  fieldId: RecordId;
  operator: MappingCollectionConditionOperator;
  value?: JsonValue;
}
export interface MappingCollectionSort { fieldId: RecordId; direction: "asc" | "desc" }
export interface MappingCollectionPin { providerId: string; modelId: RecordId; recordId: RecordId }
export interface MappingCollectionQuery {
  publication: "published-only" | "include-drafts";
  conditions: MappingCollectionCondition[];
  sort: MappingCollectionSort[];
  pins: MappingCollectionPin[];
  limit: number;
}

export interface MappingTarget { nodeId: string; prop: string }

export type MappingSourceProjection =
  | { kind: "value" }
  | { kind: "object-field"; fieldIds: readonly RecordId[] }
  | { kind: "media-asset-ref" }
  | { kind: "media-text"; field: "alt" | "caption" | "label" | "title" | "description" }
  | { kind: "reference-id" }
  | { kind: "reference-list-ids" }
  | { kind: "route-link" };

export type MappingTransform =
  /** Preserve the scalar value exactly when the source and target domains agree. */
  | { kind: "identity" }
  /** Format a canonical Content date string as a medium, UTC-stable display date. */
  | { kind: "date-medium" }
  /** Keep 160 Unicode code points from longer Content, then append an ellipsis. */
  | { kind: "truncate-160" }
  /** Add a configured label/decorator before string-producing Content. */
  | { kind: "prefix"; prefix: string };

export interface MappingBinding {
  id: RecordId;
  sourceFieldId: RecordId;
  projection: MappingSourceProjection;
  target: MappingTarget;
  transform: MappingTransform;
}

export interface MappingDocument {
  schemaVersion: typeof MAPPING_SCHEMA_VERSION;
  id: RecordId;
  name: string;
  contentModel: ContentModelRef;
  composition: CompositionRecordRef;
  mode: MappingMode;
  bindings: MappingBinding[];
}

export interface MappingRecord {
  id: RecordId;
  createdAt: string;
  updatedAt: string;
  document: MappingDocument;
}

export type MappingLoadOutcome =
  | { status: "loaded"; record: MappingRecord }
  | { status: "not-found"; id: string }
  | { status: "invalid"; issue: MappingValidationIssue; raw: unknown }
  | { status: "future-schema"; foundSchemaVersion: number; raw: unknown };

export type MappingValidationCode =
  | "invalid-record" | "invalid-keys" | "unsafe-id" | "id-mismatch"
  | "invalid-timestamp" | "invalid-timestamp-order" | "not-json-safe"
  | "malformed-document" | "future-schema" | "invalid-ref"
  | "invalid-binding" | "duplicate-binding-id" | "malformed-transform";
export type MappingCollectionDiagnosticCode =
  | "collection-required" | "stale-query-field" | "unsupported-query-field" | "invalid-condition-value"
  | "pin-provider-mismatch" | "pin-model-mismatch" | "pin-not-found" | "pin-ineligible"
  | "empty-source" | "route-context-unavailable" | "route-context-ambiguous";

export interface MappingCollectionDiagnostic {
  code: MappingCollectionDiagnosticCode;
  severity: "blocking" | "nonblocking";
  message: string;
  fieldId?: RecordId;
  entryId?: RecordId;
}

export interface MappingCollectionEvaluation {
  status: "ready" | "blocked";
  entries: readonly import("../../content/model").ContentEntryRecord[];
  diagnostics: readonly MappingCollectionDiagnostic[];
}

export interface MappingValidationIssue {
  code: MappingValidationCode;
  message: string;
  path?: string;
  foundSchemaVersion?: number;
}

export type MappingValidation =
  | { ok: true; record: MappingRecord }
  | { ok: false; issue: MappingValidationIssue };

type StructuredComponentField = Extract<FieldDefinition, { readonly schema: { readonly items: unknown } | { readonly fields: unknown } }>;
export type ScalarMappingTargetField = Exclude<FieldDefinition, StructuredComponentField>;
export type MappingTargetKind = ScalarMappingTargetField["editor"]["kind"];

interface MappingTargetDescriptorBase {
  target: MappingTarget;
  nodeLabel: string;
  componentId: string;
  componentVersion: number;
  componentLabel: string;
  fieldLabel: string;
  required: boolean;
}

type MappingTargetDescriptorFor<TField extends ScalarMappingTargetField> =
  MappingTargetDescriptorBase
  & { kind: TField["editor"]["kind"] }
  & (TField extends { readonly schema: { readonly enum: infer TOptions extends readonly string[] } }
    ? { options: TOptions }
    : { options?: never });

export type MappingTargetDescriptor = ScalarMappingTargetField extends infer TField
  ? TField extends ScalarMappingTargetField
    ? MappingTargetDescriptorFor<TField>
    : never
  : never;

export type MappingDefinitionDiagnosticCode =
  | "content-model-not-found" | "content-model-invalid" | "content-provider-error"
  | "composition-not-found" | "composition-invalid" | "composition-provider-error"
  | "source-field-missing" | "target-node-missing" | "component-missing"
  | "component-version-mismatch" | "target-field-missing" | "structured-target-unsupported" | "duplicate-target"
  | "source-projection-invalid" | "incompatible-binding" | "invalid-transform-config";

export interface MappingDefinitionDiagnostic {
  scope: "definition";
  severity: "blocking";
  code: MappingDefinitionDiagnosticCode;
  message: string;
  bindingId?: RecordId;
  sourceFieldId?: RecordId;
  target?: MappingTarget;
}

export type MappingEntryDiagnosticCode =
  | "entry-model-mismatch" | "required-value-missing" | "optional-value-missing"
  | "invalid-source-value" | "source-projection-invalid" | "route-context-unavailable"
  | "route-context-ambiguous" | "invalid-canonical-date" | "select-option-invalid";

export interface MappingEntryDiagnostic {
  scope: "entry";
  severity: "blocking" | "nonblocking";
  code: MappingEntryDiagnosticCode;
  message: string;
  entryId: RecordId;
  bindingId?: RecordId;
  sourceFieldId?: RecordId;
  target?: MappingTarget;
}

export interface ResolvedMappingBinding {
  binding: MappingBinding;
  source: ContentFieldDefinition;
  target: MappingTargetDescriptor;
}

export interface MappingDefinitionResolution {
  status: "ready" | "blocked";
  mapping: MappingRecord;
  contentModel?: import("../../content/model").ContentModelRecord;
  composition?: import("../../composer/library").CompositionRecord;
  targets: readonly MappingTargetDescriptor[];
  bindings: readonly ResolvedMappingBinding[];
  diagnostics: readonly MappingDefinitionDiagnostic[];
}

export interface MappingEvaluationResult {
  status: "ready" | "blocked";
  document?: import("../../composer/model/types").CompositionDocument;
  definitionDiagnostics: readonly MappingDefinitionDiagnostic[];
  entryDiagnostics: readonly MappingEntryDiagnostic[];
  appliedBindings: readonly AppliedMappingBinding[];
  appliedBindingCount: number;
  unchangedStaticCount: number;
}

// Runtime tables, not bare unions: a provider that rebuilds an error from a
// wire payload has to decide whether a received operation/code is one of ours,
// and a union alone cannot answer that at runtime.
export const MAPPING_PERSISTENCE_OPERATIONS = ["initialize", "list", "get", "put", "delete", "seed", "clear", "transact"] as const;
export type MappingPersistenceOperation = (typeof MAPPING_PERSISTENCE_OPERATIONS)[number];
export const MAPPING_PERSISTENCE_ERROR_CODES = [
  "unavailable", "blocked", "versionchange", "unsupported-version", "validation",
  "conflict", "read-failed", "write-failed", "transaction-failed", "commit-uncertain", "unknown",
] as const;
export type MappingPersistenceErrorCode = (typeof MAPPING_PERSISTENCE_ERROR_CODES)[number];

export function isMappingPersistenceOperation(value: unknown): value is MappingPersistenceOperation {
  return (MAPPING_PERSISTENCE_OPERATIONS as readonly unknown[]).includes(value);
}

export function isMappingPersistenceErrorCode(value: unknown): value is MappingPersistenceErrorCode {
  return (MAPPING_PERSISTENCE_ERROR_CODES as readonly unknown[]).includes(value);
}

export class MappingPersistenceError extends Error {
  readonly name = "MappingPersistenceError";
  constructor(readonly operation: MappingPersistenceOperation, readonly code: MappingPersistenceErrorCode, message: string, readonly retryable: boolean, options?: { cause?: unknown }) { super(message, options); }

  /**
   * Structured context the shared file-provider transport forwards verbatim.
   * `retryable` is not derivable from the code alone, so it has to cross the
   * wire rather than be re-guessed browser-side.
   */
  get details(): { retryable: boolean } { return { retryable: this.retryable }; }
}

export interface MappingSummary { id: RecordId; name: string; createdAt: string; updatedAt: string; bindingCount: number }
export interface MappingStore {
  snapshot?(): Promise<import("../../shared/persistence-generation").PersistedSnapshot<MappingRecord>>;
  mutationToken?(): Promise<number | string>;
  readonly provider: MappingProviderDescriptor;
  list(): Promise<readonly MappingSummary[]>;
  get(id: string): Promise<MappingLoadOutcome>;
  put(record: MappingRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  seed(seed: MappingSeed): Promise<void>;
  clear(): Promise<void>;
}
export interface MappingSeed { mappings: readonly MappingRecord[] }
export interface MappingRecoveryOutcome { kind: "quarantined"; reason: "invalid" | "future-schema"; sourcePreserved: true; affectedRecordIds: readonly string[]; foundSchemaVersion?: number; message: string }
export type MappingInitializationOutcome = { status: "ready"; summaries: readonly MappingSummary[] } | { status: "recovery-required"; summaries: readonly MappingSummary[]; recovery: MappingRecoveryOutcome } | { status: "error"; error: MappingPersistenceError };
export interface MappingProvider { descriptor: MappingProviderDescriptor; store: MappingStore; initialization: { initialize(): Promise<MappingInitializationOutcome>; retry(): Promise<MappingInitializationOutcome>; startFresh(): Promise<MappingInitializationOutcome> } }

export const MAPPING_PROVIDERS = {
  filesystem: { id: "mapping-filesystem", label: "Project files" },
} as const;
export type MappingProviderDescriptor = (typeof MAPPING_PROVIDERS)[keyof typeof MAPPING_PROVIDERS];

export interface MappingSeedOptions {
  id: RecordId;
  name: string;
  contentModel: ContentModelRef;
  composition: CompositionRecordRef;
  bindings?: readonly (Omit<MappingBinding, "projection"> & { projection?: MappingSourceProjection })[];
  mode?: MappingMode;
  createdAt: string;
  updatedAt?: string;
}

export interface AppliedMappingValue { target: MappingTarget; value: JsonValue }
export interface AppliedMappingBinding extends AppliedMappingValue { bindingId: RecordId; sourceFieldId: RecordId }
