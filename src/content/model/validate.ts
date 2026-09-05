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
  ContentValueSchema,
  ContentMediaUse,
} from "./types";

const MODEL_RECORD_KEYS = ["id", "createdAt", "updatedAt", "document"];
const MODEL_DOCUMENT_KEYS = ["schemaVersion", "id", "name", "description", "kind", "fields"];
const FIELD_KEYS = ["id", "key", "label", "required", "kind"];
const ENTRY_KEYS = ["schemaVersion", "id", "modelId", "createdAt", "updatedAt", "values", "lifecycle", "generation"];
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

function validateField(value: unknown, index: number, depth = 0): ContentValidation<ContentFieldDefinition> {
  const path = `document.fields[${index}]`;
  if (!isPlainObject(value) || !validateSchema(value, FIELD_KEYS.filter((key) => key !== "kind"), depth)) return fail("invalid-field", "Field must contain exactly its canonical schema fields (maximum nesting 16).", path);
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
  if (!isPlainObject(value.document) || !exactKeys(value.document, [...MODEL_DOCUMENT_KEYS, ...(Object.hasOwn(value.document, "presentation") ? ["presentation"] : [])])) return fail("malformed-document", "Content model document must contain exactly its canonical fields.");
  const document = value.document;
  if (typeof document.schemaVersion === "number" && document.schemaVersion > CONTENT_MODEL_SCHEMA_VERSION) {
    return fail("future-schema", "Content model uses a newer schema version.", "document.schemaVersion", document.schemaVersion);
  }
  if (document.schemaVersion !== CONTENT_MODEL_SCHEMA_VERSION) return fail("malformed-document", "Content model schema version is invalid.");
  if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.");
  if (typeof document.name !== "string" || document.name.trim().length === 0) return fail("malformed-document", "Content model name must be non-empty.", "document.name");
  if (typeof document.description !== "string") return fail("malformed-document", "Content model description must be a string.", "document.description");
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
  if (document.presentation !== undefined && !validatePresentation(document.presentation, ids)) return fail("malformed-document", "Presentation must use unique ids and existing field ids.", "document.presentation");
  return { ok: true, value: value as unknown as ContentModelRecord };
}

export function validateContentEntryRecord(value: unknown): ContentValidation<ContentEntryRecord> {
  if (!isPlainObject(value) || !exactKeys(value, ENTRY_KEYS)) return fail("invalid-record", "Content Entry must contain exactly its canonical fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Content Entry must be JSON-safe.");
  if (typeof value.schemaVersion === "number" && value.schemaVersion > CONTENT_ENTRY_SCHEMA_VERSION) return fail("future-schema", "Content Entry uses a newer schema version.", "schemaVersion", value.schemaVersion);
  if (value.schemaVersion !== CONTENT_ENTRY_SCHEMA_VERSION) return fail("invalid-record", "Content Entry schema version is invalid.");
  if (!isSafeRecordId(value.id) || !isSafeRecordId(value.modelId)) return fail("unsafe-id", "Entry id and modelId must be safe record ids.");
  if (value.lifecycle !== "draft" && value.lifecycle !== "published") return fail("invalid-record", "Entry lifecycle must be draft or published.");
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) return fail("invalid-record", "Entry generation must be a nonnegative safe integer.");
  const timestampFailure = validateEnvelopeTimestamps<ContentEntryRecord>(value);
  if (timestampFailure) return timestampFailure;
  if (!isPlainObject(value.values)) return fail("invalid-value", "Entry values must be a plain object.", "values");
  for (const fieldId of Object.keys(value.values)) {
    if (!isSafeRecordId(fieldId)) return fail("unsafe-id", "Entry value keys must be safe field ids.", `values.${fieldId}`);
  }
  return { ok: true, value: value as unknown as ContentEntryRecord };
}

export function isValueValidForField(field: ContentValueSchema, value: unknown): boolean {
  switch (field.kind) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "date": return typeof value === "string" && (value === "" || isCanonicalContentDate(value));
    case "url": return typeof value === "string" && (value === "" || isContentUrl(value));
    case "choice": return typeof value === "string" && (value === "" || field.options.some((option) => option.value === value));
    case "reference": return isEntryRef(value) && value.providerId === field.target.providerId && value.modelId === field.target.recordId;
    case "reference-list": return Array.isArray(value) && value.every((item) => isValueValidForField({ kind: "reference", target: field.target }, item)) && new Set(value.map((item) => JSON.stringify([item.providerId, item.modelId, item.recordId]))).size === value.length;
    case "object": return isPlainObject(value) && Object.entries(value).every(([id, item]) => { const child = field.fields.find((candidate) => candidate.id === id); return !!child && isValueValidForField(child, item); });
    case "list": return Array.isArray(value) && value.every((item) => isValueValidForField(field.item, item));
    case "media-use": return isContentMediaUse(value) && value.kind === field.use;
    default: return typeof value === "string";
  }
}

export function isCanonicalContentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Authoring URLs may be same-site paths or explicit http(s)/mailto/tel URLs. */
export function isContentUrl(value: string): boolean {
  if (/[\s\\]/.test(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32)) return false;
  if (/^\/(?!\/)/.test(value) || /^#[^\s]*$/.test(value)) return true;
  try { const url = new URL(value); return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol); } catch { return false; }
}

function isRef(value: unknown): value is { providerId: string; recordId: string } {
  return isPlainObject(value) && exactKeys(value, ["providerId", "recordId"]) && typeof value.providerId === "string" && value.providerId.trim().length > 0 && isSafeRecordId(value.recordId);
}
function isEntryRef(value: unknown): value is { providerId: string; modelId: string; recordId: string } {
  return isPlainObject(value) && exactKeys(value, ["providerId", "modelId", "recordId"]) && typeof value.providerId === "string" && value.providerId.trim().length > 0 && isSafeRecordId(value.recordId) && isSafeRecordId(value.modelId);
}

export function isContentMediaUse(value: unknown): value is ContentMediaUse {
  if (!isPlainObject(value) || !isPlainObject(value.asset) || !exactKeys(value.asset, ["providerId", "assetId"])
    || !isSafeRecordId(value.asset.providerId) || !isSafeRecordId(value.asset.assetId)) return false;
  switch (value.kind) {
    case "image": return exactKeys(value, ["kind", "asset", "alt", "decorative", "caption"]) && typeof value.alt === "string" && typeof value.decorative === "boolean" && typeof value.caption === "string" && (!value.decorative || value.alt === "");
    case "link": return exactKeys(value, ["kind", "asset", "label"]) && typeof value.label === "string";
    case "card": return exactKeys(value, ["kind", "asset", "title", "description"]) && typeof value.title === "string" && typeof value.description === "string";
    default: return false;
  }
}

function validateSchema(value: Record<string, unknown>, extra: string[] = [], depth = 0): boolean {
  if (depth > 16) return false;
  const keys = [...extra, "kind"];
  switch (value.kind) {
    case "choice": return exactKeys(value, [...keys, "options"]) && Array.isArray(value.options) && value.options.length > 0 && value.options.every((option) => isPlainObject(option) && exactKeys(option, ["value", "label"]) && typeof option.value === "string" && option.value.trim().length > 0 && typeof option.label === "string" && option.label.trim().length > 0) && new Set(value.options.map((option) => option.value)).size === value.options.length;
    case "reference": return exactKeys(value, [...keys, "target"]) && isRef(value.target);
    case "reference-list": return exactKeys(value, [...keys, "target", "ordered"]) && isRef(value.target) && typeof value.ordered === "boolean";
    case "object": return exactKeys(value, [...keys, "fields"]) && Array.isArray(value.fields) && value.fields.every((field, index) => validateField(field, index, depth + 1).ok) && new Set(value.fields.map((field) => field.id)).size === value.fields.length && new Set(value.fields.map((field) => field.key)).size === value.fields.length;
    case "list": return exactKeys(value, [...keys, "item"]) && isPlainObject(value.item) && validateSchema(value.item, [], depth + 1);
    case "media-use": return exactKeys(value, [...keys, "use"]) && ["image", "link", "card"].includes(value.use as string);
    default: return exactKeys(value, keys) && typeof value.kind === "string" && (CONTENT_FIELD_KINDS as readonly string[]).includes(value.kind);
  }
}

function validatePresentation(value: unknown, fields: Set<string>): boolean {
  if (!isPlainObject(value) || !exactKeys(value, ["groups", "views", "inverses"])) return false;
  for (const key of ["groups", "views"] as const) {
    const items = value[key];
    if (!Array.isArray(items) || !items.every((item) => isPlainObject(item) && exactKeys(item, ["id", "label", "fieldIds"]) && isSafeRecordId(item.id) && typeof item.label === "string" && item.label.trim() && Array.isArray(item.fieldIds) && item.fieldIds.every((id) => fields.has(id)) && new Set(item.fieldIds).size === item.fieldIds.length) || new Set(items.map((item) => item.id)).size !== items.length) return false;
  }
  return Array.isArray(value.inverses) && value.inverses.every((item) => isPlainObject(item) && exactKeys(item, ["id", "label", "source", "fieldId"]) && isSafeRecordId(item.id) && typeof item.label === "string" && item.label.trim() && isRef(item.source) && isSafeRecordId(item.fieldId)) && new Set(value.inverses.map((item) => item.id)).size === value.inverses.length;
}
