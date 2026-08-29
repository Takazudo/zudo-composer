import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { MAPPING_SCHEMA_VERSION } from "./types";
import type { MappingRecord, MappingTransform, MappingValidation, MappingValidationCode } from "./types";

const RECORD_KEYS = ["id", "createdAt", "updatedAt", "document"];
const DOCUMENT_KEYS = ["schemaVersion", "id", "name", "contentModel", "composition", "bindings"];
const BINDING_KEYS = ["id", "sourceFieldId", "target", "transform"];

function fail(code: MappingValidationCode, message: string, path?: string, foundSchemaVersion?: number): MappingValidation {
  return { ok: false, issue: { code, message, ...(path ? { path } : {}), ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }) } };
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function timestamp(value: unknown): value is string { if (typeof value !== "string") return false; const date = new Date(value); return Number.isFinite(date.getTime()) && date.toISOString() === value; }
function providerId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/.test(value); }
function ref(value: unknown): boolean { return isPlainObject(value) && exact(value, ["providerId", "recordId"]) && providerId(value.providerId) && isSafeRecordId(value.recordId); }

export function validateMappingTransform(value: unknown): value is MappingTransform {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "prefix") return exact(value, ["kind", "prefix"]) && typeof value.prefix === "string" && Array.from(value.prefix).length <= 80;
  return (value.kind === "identity" || value.kind === "date-medium" || value.kind === "truncate-160") && exact(value, ["kind"]);
}

export function validateMappingRecord(value: unknown): MappingValidation {
  if (!isPlainObject(value) || !exact(value, RECORD_KEYS)) return fail("invalid-record", "Mapping record must contain exactly its canonical envelope fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Mapping record must be JSON-safe.");
  if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Mapping id must be a safe record id.", "id");
  if (!timestamp(value.createdAt) || !timestamp(value.updatedAt)) return fail("invalid-timestamp", "Mapping timestamps must be canonical ISO timestamps.");
  if (value.updatedAt < value.createdAt) return fail("invalid-timestamp-order", "updatedAt cannot precede createdAt.");
  if (isPlainObject(value.document) && typeof value.document.schemaVersion === "number" && value.document.schemaVersion > MAPPING_SCHEMA_VERSION) return fail("future-schema", "Mapping uses a newer schema version.", "document.schemaVersion", value.document.schemaVersion);
  if (!isPlainObject(value.document) || !exact(value.document, DOCUMENT_KEYS)) return fail("malformed-document", "Mapping document must contain exactly its canonical fields.");
  const document = value.document;
  if (document.schemaVersion !== MAPPING_SCHEMA_VERSION) return fail("malformed-document", "Mapping schema version is invalid.");
  if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.");
  if (typeof document.name !== "string" || !document.name.trim()) return fail("malformed-document", "Mapping name must be non-empty.", "document.name");
  if (!ref(document.contentModel)) return fail("invalid-ref", "Content-model reference is malformed.", "document.contentModel");
  if (!ref(document.composition)) return fail("invalid-ref", "Composition reference is malformed.", "document.composition");
  if (!Array.isArray(document.bindings)) return fail("malformed-document", "Bindings must be an array.", "document.bindings");
  const ids = new Set<string>();
  for (let index = 0; index < document.bindings.length; index += 1) {
    const binding = document.bindings[index]; const path = `document.bindings[${index}]`;
    if (!isPlainObject(binding) || !exact(binding, BINDING_KEYS) || !isSafeRecordId(binding.id) || !isSafeRecordId(binding.sourceFieldId)) return fail("invalid-binding", "Binding identity is malformed.", path);
    if (ids.has(binding.id)) return fail("duplicate-binding-id", `Duplicate binding id "${binding.id}".`, `${path}.id`); ids.add(binding.id);
    if (!isPlainObject(binding.target) || !exact(binding.target, ["nodeId", "prop"]) || typeof binding.target.nodeId !== "string" || !binding.target.nodeId || typeof binding.target.prop !== "string" || !binding.target.prop) return fail("invalid-binding", "Binding target is malformed.", `${path}.target`);
    if (!validateMappingTransform(binding.transform)) return fail("malformed-transform", "Binding transform is malformed.", `${path}.transform`);
  }
  return { ok: true, record: value as unknown as MappingRecord };
}
