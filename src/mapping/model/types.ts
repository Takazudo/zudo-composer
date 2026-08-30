import type { FieldDefinition, JsonValue } from "@zudo-composer/component-contract";
import type { CompositionRecordRef } from "../../composer/library";
import type { ContentModelRef } from "../../content/catalog";
import type { ContentFieldKind } from "../../content/model";
import type { RecordId } from "../../shared";

export const MAPPING_SCHEMA_VERSION = 1 as const;

export interface MappingTarget { nodeId: string; prop: string }

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
  target: MappingTarget;
  transform: MappingTransform;
}

export interface MappingDocument {
  schemaVersion: typeof MAPPING_SCHEMA_VERSION;
  id: RecordId;
  name: string;
  contentModel: ContentModelRef;
  composition: CompositionRecordRef;
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
  | "incompatible-binding" | "invalid-transform-config";

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
  | "invalid-source-value" | "invalid-canonical-date" | "select-option-invalid";

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
  source: { id: RecordId; key: string; label: string; required: boolean; kind: ContentFieldKind };
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

export type MappingPersistenceOperation = "initialize" | "list" | "get" | "put" | "delete" | "seed" | "clear";
export type MappingPersistenceErrorCode = "unavailable" | "blocked" | "versionchange" | "unsupported-version" | "validation" | "read-failed" | "write-failed" | "transaction-failed" | "unknown";

export class MappingPersistenceError extends Error {
  readonly name = "MappingPersistenceError";
  constructor(readonly operation: MappingPersistenceOperation, readonly code: MappingPersistenceErrorCode, message: string, readonly retryable: boolean, options?: { cause?: unknown }) { super(message, options); }
}

export interface MappingSummary { id: RecordId; name: string; createdAt: string; updatedAt: string; bindingCount: number }
export interface MappingStore {
  readonly provider: typeof MAPPING_PROVIDERS.indexeddb;
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
export interface MappingProvider { descriptor: typeof MAPPING_PROVIDERS.indexeddb; store: MappingStore; initialization: { initialize(): Promise<MappingInitializationOutcome>; retry(): Promise<MappingInitializationOutcome>; startFresh(): Promise<MappingInitializationOutcome> } }

export const MAPPING_PROVIDERS = { indexeddb: { id: "mapping-indexeddb", label: "Browser storage", storageLabel: "IndexedDB: zudo-composer-mapping" } } as const;

export interface MappingSeedOptions {
  id: RecordId;
  name: string;
  contentModel: ContentModelRef;
  composition: CompositionRecordRef;
  bindings?: readonly MappingBinding[];
  createdAt: string;
  updatedAt?: string;
}

export interface AppliedMappingValue { target: MappingTarget; value: JsonValue }
export interface AppliedMappingBinding extends AppliedMappingValue { bindingId: RecordId; sourceFieldId: RecordId }
