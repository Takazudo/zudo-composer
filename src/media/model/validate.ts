import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import {
  MEDIA_CHECKSUM_PATTERN,
  MEDIA_FILE_NAME_MAX_LENGTH,
  MEDIA_MAX_BYTE_LENGTH,
  MEDIA_SCHEMA_VERSION,
  MEDIA_TYPES,
  mediaVersionUrl,
} from "./types";
import type { MediaRecord, MediaType, MediaSnapshot, MediaFolder, MediaVersionRef, MediaVersionPin, MediaPinManifest } from "./types";

const RECORD_KEYS = ["id", "revision", "createdAt", "updatedAt", "document"] as const;
const DOCUMENT_KEYS = ["schemaVersion", "id", "fileName", "folderId", "note", "state", "currentVersionId", "versions"] as const;

const FILE_NAME_SEPARATOR_PATTERN = /[\\/]/u;

export type MediaValidationCode =
  | "invalid-record"
  | "unsafe-id"
  | "id-mismatch"
  | "invalid-timestamp"
  | "invalid-timestamp-order"
  | "not-json-safe"
  | "malformed-document"
  | "future-schema"
  | "invalid-file-name"
  | "invalid-media-type"
  | "invalid-byte-length"
  | "invalid-checksum";

export interface MediaValidationIssue {
  code: MediaValidationCode;
  message: string;
  path?: string;
  foundSchemaVersion?: number;
}

export type MediaValidation =
  | { ok: true; value: MediaRecord }
  | { ok: false; issue: MediaValidationIssue };

/** Exact own-key check used at every persisted object boundary. */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(
  code: MediaValidationCode,
  message: string,
  path?: string,
  foundSchemaVersion?: number,
): MediaValidation {
  return {
    ok: false,
    issue: {
      code,
      message,
      ...(path === undefined ? {} : { path }),
      ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }),
    },
  };
}

/** A canonical UTC ISO timestamp, matching the representation we persist. */
export function isCanonicalMediaTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Alias matching the naming used by other provider-neutral domains. */
export const isValidMediaTimestamp = isCanonicalMediaTimestamp;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export function isValidMediaType(value: unknown): value is MediaType {
  return typeof value === "string" && (MEDIA_TYPES as readonly string[]).includes(value);
}

export function isValidMediaFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (Array.from(value).length > MEDIA_FILE_NAME_MAX_LENGTH) return false;
  if (hasControlCharacter(value) || FILE_NAME_SEPARATOR_PATTERN.test(value)) return false;
  return true;
}

export function isValidMediaByteLength(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MEDIA_MAX_BYTE_LENGTH;
}

export function isValidMediaChecksum(value: unknown): value is string {
  return typeof value === "string" && MEDIA_CHECKSUM_PATTERN.test(value);
}

/** Validate one canonical Media record without mutating or upgrading it. */
export function validateMediaRecord(value: unknown): MediaValidation {
  if (!isPlainObject(value)) return fail("invalid-record", "Media record must be a plain object.");
  if (!exactKeys(value, RECORD_KEYS)) return fail("invalid-record", "Media record must contain exactly its canonical envelope fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Media record must be JSON-safe.");
  if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Media id must be a safe record id.", "id");
  if (!isMediaRevision(value.revision)) return fail("invalid-record", "Media revision must be a positive safe integer.");
  if (!isCanonicalMediaTimestamp(value.createdAt) || !isCanonicalMediaTimestamp(value.updatedAt)) {
    return fail("invalid-timestamp", "Media timestamps must be canonical ISO timestamps.");
  }
  if (value.updatedAt < value.createdAt) return fail("invalid-timestamp-order", "updatedAt cannot precede createdAt.");

  if (isPlainObject(value.document) && typeof value.document.schemaVersion === "number" && value.document.schemaVersion > MEDIA_SCHEMA_VERSION) {
    return fail("future-schema", "Media uses a newer schema version.", "document.schemaVersion", value.document.schemaVersion);
  }
  if (!isPlainObject(value.document) || !exactKeys(value.document, DOCUMENT_KEYS)) {
    return fail("malformed-document", "Media document must contain exactly its canonical fields.");
  }
  const document = value.document;
  if (document.schemaVersion !== MEDIA_SCHEMA_VERSION) return fail("malformed-document", "Media schema version is invalid.", "document.schemaVersion");
  if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.", "document.id");
  if (!isValidMediaFileName(document.fileName)) return fail("invalid-file-name", "Media fileName must be a non-empty safe display name.", "document.fileName");
  if (document.folderId !== null && !isSafeRecordId(document.folderId)) return fail("malformed-document", "Media folderId must be a logical id or null.");
  if (typeof document.note !== "string" || document.note.length > 10000 || (document.state !== "active" && document.state !== "trash")) return fail("malformed-document", "Media note or state is invalid.");
  if (!Array.isArray(document.versions) || document.versions.length === 0) return fail("malformed-document", "Media requires an immutable version.");
  const ids = new Set<string>();
  for (const version of document.versions) {
    if (!isPlainObject(version) || !exactKeys(version, ["id", "mediaType", "byteLength", "checksum", "url", "createdAt"])) return fail("malformed-document", "Invalid immutable version fields.");
    if (!isValidMediaType(version.mediaType)) return fail("invalid-media-type", "Invalid version MIME type.");
    if (!isValidMediaByteLength(version.byteLength) || version.byteLength === 0) return fail("invalid-byte-length", "Invalid version byte length.");
    if (!isValidMediaChecksum(version.checksum) || version.id !== version.checksum || ids.has(version.checksum)) return fail("invalid-checksum", "Invalid or duplicate version identity.");
    if (version.url !== mediaVersionUrl(version.checksum, version.mediaType) || !isCanonicalMediaTimestamp(version.createdAt) || version.createdAt < value.createdAt || version.createdAt > value.updatedAt) return fail("malformed-document", "Invalid version URL or timestamp.");
    ids.add(version.checksum);
  }
  if (typeof document.currentVersionId !== "string" || !ids.has(document.currentVersionId)) return fail("malformed-document", "Current version must exist.");
  return { ok: true, value: value as unknown as MediaRecord };
}

export function isMediaRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function mediaPinKey(ref: MediaVersionRef): string {
  return JSON.stringify([ref.providerId, ref.assetId, ref.versionId]);
}
export function validateMediaVersionRef(value: unknown): value is MediaVersionRef {
  return isPlainObject(value) && exactKeys(value, ["providerId", "assetId", "versionId"])
    && isSafeRecordId(value.providerId) && isSafeRecordId(value.assetId) && isValidMediaChecksum(value.versionId);
}
export function validateMediaVersionPin(value: unknown, expected?: MediaVersionRef): value is MediaVersionPin {
  if (!isPlainObject(value) || !exactKeys(value, ["providerId", "assetId", "versionId", "checksum", "byteLength", "mediaType", "url"])) return false;
  const ref = { providerId: value.providerId, assetId: value.assetId, versionId: value.versionId };
  return validateMediaVersionRef(ref) && value.checksum === ref.versionId
    && isValidMediaType(value.mediaType) && isValidMediaByteLength(value.byteLength) && value.byteLength > 0
    && value.url === mediaVersionUrl(ref.versionId, value.mediaType)
    && (expected === undefined || (validateMediaVersionRef(expected) && mediaPinKey(ref) === mediaPinKey(expected)));
}
export function validateMediaPinManifest(value: unknown, expected?: readonly MediaVersionRef[]): value is MediaPinManifest {
  if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "pins"]) || value.schemaVersion !== 1
    || !Array.isArray(value.pins) || !value.pins.every((pin) => validateMediaVersionPin(pin))) return false;
  const keys = (value.pins as MediaVersionPin[]).map(mediaPinKey);
  if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) return false;
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || !expected.every(validateMediaVersionRef)) return false;
  const requested = [...new Set(expected.map(mediaPinKey))].sort();
  return keys.length === requested.length && keys.every((key, index) => key === requested[index]);
}

export function validateMediaFolder(value: unknown): value is MediaFolder {
  return isPlainObject(value) && exactKeys(value, ["id", "parentId", "name", "state", "revision", "createdAt", "updatedAt"])
    && isSafeRecordId(value.id) && (value.parentId === null || isSafeRecordId(value.parentId))
    && isValidMediaFileName(value.name) && value.name === value.name.trim()
    && (value.state === "active" || value.state === "trash") && isMediaRevision(value.revision)
    && isCanonicalMediaTimestamp(value.createdAt) && isCanonicalMediaTimestamp(value.updatedAt)
    && value.updatedAt >= value.createdAt;
}

/** Validates the complete logical graph, including trash. Active sibling names
 * collide case-insensitively after NFC normalization. Trash keeps its parent;
 * only empty folders may be trashed, and restore requires an active parent. */
export function validateMediaSnapshot(value: unknown): value is MediaSnapshot {
  if (!isPlainObject(value) || !isJsonSafe(value) || !exactKeys(value, ["schemaVersion", "mutationToken", "records", "folders"])
    || value.schemaVersion !== MEDIA_SCHEMA_VERSION || !isValidMediaChecksum(value.mutationToken)
    || !Array.isArray(value.records) || !Array.isArray(value.folders)) return false;
  if (!value.records.every((record) => validateMediaRecord(record).ok) || !value.folders.every(validateMediaFolder)) return false;
  const snapshot = value as unknown as MediaSnapshot;
  const folders = new Map(snapshot.folders.map((folder) => [folder.id, folder]));
  if (folders.size !== snapshot.folders.length || new Set(snapshot.records.map((record) => record.id)).size !== snapshot.records.length) return false;
  const names = new Set<string>();
  for (const folder of snapshot.folders) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      const parent = folders.get(parentId);
      if (!parent || visited.has(parentId)) return false;
      if (folder.state === "active" && parent.state !== "active") return false;
      visited.add(parentId);
      parentId = parent.parentId;
    }
    if (folder.state === "active") {
      const key = JSON.stringify([folder.parentId, folder.name.normalize("NFC").toLowerCase()]);
      if (names.has(key)) return false;
      names.add(key);
    }
  }
  return snapshot.records.every(({ document }) => document.folderId === null
    || (folders.has(document.folderId) && (document.state === "trash" || folders.get(document.folderId)!.state === "active")));
}
