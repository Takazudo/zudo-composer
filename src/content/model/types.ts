import type { JsonValue } from "@zudo-composer/component-contract";
import type { RecordId } from "../../shared";

export const CONTENT_MODEL_SCHEMA_VERSION = 1 as const;
export const CONTENT_ENTRY_SCHEMA_VERSION = 1 as const;

export const CONTENT_FIELD_KINDS = [
  "text", "long-text", "markdown", "number", "boolean", "date", "slug", "color", "url",
  "choice", "reference", "reference-list", "object", "list", "asset-use",
] as const;
export type ContentFieldKind = (typeof CONTENT_FIELD_KINDS)[number];
export type ContentModelKind = "collection" | "single";

export interface ContentRecordRef { providerId: string; recordId: RecordId }
export interface ContentEntryRef extends ContentRecordRef { modelId: RecordId }
/**
 * Stable authoring identity for a managed asset.
 *
 * Content deliberately does not persist a versionId: the current Asset head
 * may change while a draft is being edited. The provider-qualified shape is
 * shared structurally with AssetAssetRef so release can add an exact version
 * without losing which Asset provider owns the asset.
 */
export type ContentAssetRef = { providerId: string; assetId: string };
export type ContentAssetUse =
  | { kind: "image"; asset: ContentAssetRef; alt: string; decorative: boolean; caption: string }
  | { kind: "link"; asset: ContentAssetRef; label: string }
  | { kind: "download"; asset: ContentAssetRef; label: string; showSize: boolean; showType: boolean }
  | { kind: "card"; asset: ContentAssetRef; title: string; description: string };

export type ContentValueSchema =
  | { kind: "text" | "long-text" | "markdown" | "number" | "boolean" | "date" | "slug" | "color" | "url" }
  | { kind: "choice"; options: { value: string; label: string }[] }
  | { kind: "reference"; target: ContentRecordRef }
  | { kind: "reference-list"; target: ContentRecordRef; ordered: boolean }
  | { kind: "object"; fields: ContentFieldDefinition[] }
  | { kind: "list"; item: ContentValueSchema }
  | { kind: "asset-use"; use: ContentAssetUse["kind"] };

export type ContentFieldDefinition = {
  id: RecordId;
  key: string;
  label: string;
  required: boolean;
} & ContentValueSchema;

/** Inverses are presentation metadata. Only the named owning field stores edges. */
export interface ContentInverseDefinition { id: string; label: string; source: ContentRecordRef; fieldId: string }
export interface ContentPresentation {
  groups: { id: string; label: string; fieldIds: string[] }[];
  views: { id: string; label: string; fieldIds: string[] }[];
  inverses: ContentInverseDefinition[];
}

export interface ContentModelDocument {
  schemaVersion: typeof CONTENT_MODEL_SCHEMA_VERSION;
  id: RecordId;
  name: string;
  description: string;
  kind: ContentModelKind;
  fields: ContentFieldDefinition[];
  presentation?: ContentPresentation;
}

export interface ContentModelRecord {
  id: RecordId;
  createdAt: string;
  updatedAt: string;
  document: ContentModelDocument;
}

export interface ContentEntryRecord {
  schemaVersion: typeof CONTENT_ENTRY_SCHEMA_VERSION;
  id: RecordId;
  modelId: RecordId;
  createdAt: string;
  updatedAt: string;
  values: Record<RecordId, JsonValue>;
  lifecycle: "draft" | "published";
  /** Storage assigns a new generation atomically for every entry mutation. */
  generation: number;
}

export interface ContentCompletenessDiagnostic {
  code: "required-value-missing" | "semantic-value-incomplete";
  modelId: RecordId;
  entryId: RecordId;
  fieldId: RecordId;
  fieldKey: string;
  message: string;
  path?: readonly (string | number)[];
}
