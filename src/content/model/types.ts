import type { JsonValue } from "@zudo-composer/component-contract";
import type { RecordId } from "../../shared";

export const CONTENT_MODEL_SCHEMA_VERSION = 1 as const;
export const CONTENT_ENTRY_SCHEMA_VERSION = 1 as const;

export const CONTENT_FIELD_KINDS = [
  "text", "long-text", "markdown", "number", "boolean", "date", "slug", "color", "url",
] as const;
export type ContentFieldKind = (typeof CONTENT_FIELD_KINDS)[number];
export type ContentModelKind = "collection" | "single";

export interface ContentFieldDefinition {
  id: RecordId;
  key: string;
  label: string;
  required: boolean;
  kind: ContentFieldKind;
}

export interface ContentModelDocument {
  schemaVersion: typeof CONTENT_MODEL_SCHEMA_VERSION;
  id: RecordId;
  name: string;
  kind: ContentModelKind;
  fields: ContentFieldDefinition[];
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
}

export interface ContentCompletenessDiagnostic {
  code: "required-value-missing";
  modelId: RecordId;
  entryId: RecordId;
  fieldId: RecordId;
  fieldKey: string;
  message: string;
}
