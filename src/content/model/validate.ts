import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import {
  CONTENT_ENTRY_SCHEMA_VERSION,
  CONTENT_FIELD_KINDS,
  CONTENT_MODEL_SCHEMA_VERSION,
} from "./types";
import type {
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelRecord,
} from "./types";

const MODEL_RECORD_KEYS = ["id", "createdAt", "updatedAt", "document"];
const MODEL_DOCUMENT_KEYS = ["schemaVersion", "id", "name", "kind", "fields"];
const FIELD_KEYS = ["id", "key", "label", "required", "kind"];
const ENTRY_KEYS = ["schemaVersion", "id", "modelId", "createdAt", "updatedAt", "values"];
const FIELD_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;

export type ContentValidationCode =
  | "invalid-record" | "invalid-keys" | "unsafe-id" | "id-mismatch"
  | "invalid-timestamp" | "invalid-timestamp-order" | "not-json-safe"
  | "malformed-document" | "future-schema" | "invalid-field" | "duplicate-field-id"
  | "duplicate-field-key" | "invalid-value";

export interface ContentValidationIssue {
  code: ContentValidationCode;
  message: string;
  path?: string;
  foundSchemaVersion?: number;
}

export type ContentValidation<T> = { ok: true; value: T } | { ok: false; issue: ContentValidationIssue };

function fail<T>(code: ContentValidationCode, message: string, path?: string, foundSchemaVersion?: number): ContentValidation<T> {
  return { ok: false, issue: { code, message, ...(path ? { path } : {}), ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }) } };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isCanonicalContentTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function isContentFieldKey(value: unknown): value is string {
  return typeof value === "string" && FIELD_KEY_PATTERN.test(value);
}

function validateEnvelopeTimestamps<T>(value: Record<string, unknown>): ContentValidation<T> | undefined {
  if (!isCanonicalContentTimestamp(value.createdAt) || !isCanonicalContentTimestamp(value.updatedAt)) {
    return fail("invalid-timestamp", "createdAt and updatedAt must be canonical ISO timestamps.");
  }
  if (value.updatedAt < value.createdAt) return fail("invalid-timestamp-order", "updatedAt cannot precede createdAt.");
  return undefined;
}

function validateField(value: unknown, index: number): ContentValidation<ContentFieldDefinition> {
  const path = `document.fields[${index}]`;
  if (!isPlainObject(value) || !exactKeys(value, FIELD_KEYS)) return fail("invalid-field", "Field must contain exactly its canonical fields.", path);
  if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Field id must be a safe record id.", `${path}.id`);
  if (!isContentFieldKey(value.key)) return fail("invalid-field", "Field key must be lower-camel and 1-64 characters.", `${path}.key`);
  if (typeof value.label !== "string" || value.label.trim().length === 0) return fail("invalid-field", "Field label must be non-empty.", `${path}.label`);
  if (typeof value.required !== "boolean") return fail("invalid-field", "Field required must be boolean.", `${path}.required`);
  if (typeof value.kind !== "string" || !(CONTENT_FIELD_KINDS as readonly string[]).includes(value.kind)) return fail("invalid-field", "Field kind is unsupported.", `${path}.kind`);
  return { ok: true, value: value as unknown as ContentFieldDefinition };
}

export function validateContentModelRecord(value: unknown): ContentValidation<ContentModelRecord> {
  if (!isPlainObject(value) || !exactKeys(value, MODEL_RECORD_KEYS)) return fail("invalid-record", "Content model record must contain exactly its canonical envelope fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Content model record must be JSON-safe.");
  if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Content model id must be a safe record id.", "id");
  const timestampFailure = validateEnvelopeTimestamps<ContentModelRecord>(value);
  if (timestampFailure) return timestampFailure;
  if (!isPlainObject(value.document) || !exactKeys(value.document, MODEL_DOCUMENT_KEYS)) return fail("malformed-document", "Content model document must contain exactly its canonical fields.");
  const document = value.document;
  if (typeof document.schemaVersion === "number" && document.schemaVersion > CONTENT_MODEL_SCHEMA_VERSION) {
    return fail("future-schema", "Content model uses a newer schema version.", "document.schemaVersion", document.schemaVersion);
  }
  if (document.schemaVersion !== CONTENT_MODEL_SCHEMA_VERSION) return fail("malformed-document", "Content model schema version is invalid.");
  if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return fail("malformed-document", "Content model name must be non-empty.", "document.name");
  if (document.kind !== "collection" && document.kind !== "single") return fail("malformed-document", "Content model kind is invalid.", "document.kind");
  if (!Array.isArray(document.fields)) return fail("malformed-document", "Content model fields must be an array.", "document.fields");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (let index = 0; index < document.fields.length; index += 1) {
    const field = validateField(document.fields[index], index);
    if (!field.ok) return field;
    if (ids.has(field.value.id)) return fail("duplicate-field-id", `Duplicate field id "${field.value.id}".`);
    if (keys.has(field.value.key)) return fail("duplicate-field-key", `Duplicate field key "${field.value.key}".`);
    ids.add(field.value.id); keys.add(field.value.key);
  }
  return { ok: true, value: value as unknown as ContentModelRecord };
}

export function validateContentEntryRecord(value: unknown): ContentValidation<ContentEntryRecord> {
  if (!isPlainObject(value) || !exactKeys(value, ENTRY_KEYS)) return fail("invalid-record", "Content Entry must contain exactly its canonical fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Content Entry must be JSON-safe.");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > CONTENT_ENTRY_SCHEMA_VERSION) return fail("future-schema", "Content Entry uses a newer schema version.", "schemaVersion", value.schemaVersion);
  if (value.schemaVersion !== CONTENT_ENTRY_SCHEMA_VERSION) return fail("invalid-record", "Content Entry schema version is invalid.");
  if (!isSafeRecordId(value.id) || !isSafeRecordId(value.modelId)) return fail("unsafe-id", "Entry id and modelId must be safe record ids.");
  const timestampFailure = validateEnvelopeTimestamps<ContentEntryRecord>(value);
  if (timestampFailure) return timestampFailure;
  if (!isPlainObject(value.values)) return fail("invalid-value", "Entry values must be a plain object.", "values");
  for (const fieldId of Object.keys(value.values)) {
    if (!isSafeRecordId(fieldId)) return fail("unsafe-id", "Entry value keys must be safe field ids.", `values.${fieldId}`);
  }
  return { ok: true, value: value as unknown as ContentEntryRecord };
}

export function isValueValidForField(field: ContentFieldDefinition, value: unknown): boolean {
  switch (field.kind) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    default: return typeof value === "string";
  }
}
