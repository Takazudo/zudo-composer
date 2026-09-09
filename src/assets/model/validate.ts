import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import {
  ASSET_CHECKSUM_PATTERN,
  ASSET_FILE_NAME_MAX_LENGTH,
  ASSET_MAX_BYTE_LENGTH,
  ASSET_SCHEMA_VERSION,
  ASSET_TYPES,
  assetVersionUrl,
} from "./types";
import type { AssetRecord, AssetType, AssetSnapshot, AssetFolder, AssetAssetRef, AssetVersionRef, AssetVersionPin, AssetPinManifest } from "./types";

const RECORD_KEYS = ["id", "revision", "createdAt", "updatedAt", "document"] as const;
const DOCUMENT_KEYS = ["schemaVersion", "id", "fileName", "folderId", "note", "state", "currentVersionId", "versions"] as const;

const FILE_NAME_SEPARATOR_PATTERN = /[\\/]/u;

export type AssetValidationCode =
  | "invalid-record"
  | "unsafe-id"
  | "id-mismatch"
  | "invalid-timestamp"
  | "invalid-timestamp-order"
  | "not-json-safe"
  | "malformed-document"
  | "future-schema"
  | "invalid-file-name"
  | "invalid-mime-type"
  | "invalid-byte-length"
  | "invalid-checksum";

export interface AssetValidationIssue {
  code: AssetValidationCode;
  message: string;
  path?: string;
  foundSchemaVersion?: number;
}

export type AssetValidation =
  | { ok: true; value: AssetRecord }
  | { ok: false; issue: AssetValidationIssue };

/** Exact own-key check used at every persisted object boundary. */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(
  code: AssetValidationCode,
  message: string,
  path?: string,
  foundSchemaVersion?: number,
): AssetValidation {
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
export function isCanonicalAssetTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Alias matching the naming used by other provider-neutral domains. */
export const isValidAssetTimestamp = isCanonicalAssetTimestamp;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export function isValidAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && (ASSET_TYPES as readonly string[]).includes(value);
}

export function isValidAssetFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (Array.from(value).length > ASSET_FILE_NAME_MAX_LENGTH) return false;
  if (hasControlCharacter(value) || FILE_NAME_SEPARATOR_PATTERN.test(value)) return false;
  return true;
}

export function isValidAssetByteLength(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= ASSET_MAX_BYTE_LENGTH;
}

export function isValidAssetChecksum(value: unknown): value is string {
  return typeof value === "string" && ASSET_CHECKSUM_PATTERN.test(value);
}

/** Validate one canonical Assets record without mutating or upgrading it. */
export function validateAssetRecord(value: unknown): AssetValidation {
  if (!isPlainObject(value)) return fail("invalid-record", "Assets record must be a plain object.");
  if (!exactKeys(value, RECORD_KEYS)) return fail("invalid-record", "Assets record must contain exactly its canonical envelope fields.");
  if (!isJsonSafe(value)) return fail("not-json-safe", "Assets record must be JSON-safe.");
  if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Assets id must be a safe record id.", "id");
  if (!isAssetRevision(value.revision)) return fail("invalid-record", "Assets revision must be a positive safe integer.");
  if (!isCanonicalAssetTimestamp(value.createdAt) || !isCanonicalAssetTimestamp(value.updatedAt)) {
    return fail("invalid-timestamp", "Assets timestamps must be canonical ISO timestamps.");
  }
  if (value.updatedAt < value.createdAt) return fail("invalid-timestamp-order", "updatedAt cannot precede createdAt.");

  if (isPlainObject(value.document) && typeof value.document.schemaVersion === "number" && value.document.schemaVersion > ASSET_SCHEMA_VERSION) {
    return fail("future-schema", "Assets uses a newer schema version.", "document.schemaVersion", value.document.schemaVersion);
  }
  if (!isPlainObject(value.document) || !exactKeys(value.document, DOCUMENT_KEYS)) {
    return fail("malformed-document", "Assets document must contain exactly its canonical fields.");
  }
  const document = value.document;
  if (document.schemaVersion !== ASSET_SCHEMA_VERSION) return fail("malformed-document", "Assets schema version is invalid.", "document.schemaVersion");
  if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.", "document.id");
  if (!isValidAssetFileName(document.fileName)) return fail("invalid-file-name", "Assets fileName must be a non-empty safe display name.", "document.fileName");
  if (document.folderId !== null && !isSafeRecordId(document.folderId)) return fail("malformed-document", "Assets folderId must be a logical id or null.");
  if (typeof document.note !== "string" || document.note.length > 10000 || (document.state !== "active" && document.state !== "trash")) return fail("malformed-document", "Assets note or state is invalid.");
  if (!Array.isArray(document.versions) || document.versions.length === 0) return fail("malformed-document", "Assets requires an immutable version.");
  const ids = new Set<string>();
  for (const version of document.versions) {
    if (!isPlainObject(version) || !exactKeys(version, ["id", "mimeType", "byteLength", "checksum", "url", "createdAt"])) return fail("malformed-document", "Invalid immutable version fields.");
    if (!isValidAssetType(version.mimeType)) return fail("invalid-mime-type", "Invalid version MIME type.");
    if (!isValidAssetByteLength(version.byteLength) || version.byteLength === 0) return fail("invalid-byte-length", "Invalid version byte length.");
    if (!isValidAssetChecksum(version.checksum) || version.id !== version.checksum || ids.has(version.checksum)) return fail("invalid-checksum", "Invalid or duplicate version identity.");
    if (version.url !== assetVersionUrl(version.checksum, version.mimeType) || !isCanonicalAssetTimestamp(version.createdAt) || version.createdAt < value.createdAt || version.createdAt > value.updatedAt) return fail("malformed-document", "Invalid version URL or timestamp.");
    ids.add(version.checksum);
  }
  if (typeof document.currentVersionId !== "string" || !ids.has(document.currentVersionId)) return fail("malformed-document", "Current version must exist.");
  return { ok: true, value: value as unknown as AssetRecord };
}

export function isAssetRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function assetPinKey(ref: AssetVersionRef): string {
  return JSON.stringify([ref.providerId, ref.assetId, ref.versionId]);
}
export function validateAssetAssetRef(value: unknown): value is AssetAssetRef {
  return isPlainObject(value) && exactKeys(value, ["providerId", "assetId"])
    && isSafeRecordId(value.providerId) && isSafeRecordId(value.assetId);
}
export function validateAssetVersionRef(value: unknown): value is AssetVersionRef {
  return isPlainObject(value) && exactKeys(value, ["providerId", "assetId", "versionId"])
    && validateAssetAssetRef({ providerId: value.providerId, assetId: value.assetId }) && isValidAssetChecksum(value.versionId);
}
export function validateAssetVersionPin(value: unknown, expected?: AssetVersionRef): value is AssetVersionPin {
  if (!isPlainObject(value) || !exactKeys(value, ["providerId", "assetId", "versionId", "checksum", "byteLength", "mimeType", "url"])) return false;
  const ref = { providerId: value.providerId, assetId: value.assetId, versionId: value.versionId };
  return validateAssetVersionRef(ref) && value.checksum === ref.versionId
    && isValidAssetType(value.mimeType) && isValidAssetByteLength(value.byteLength) && value.byteLength > 0
    && value.url === assetVersionUrl(ref.versionId, value.mimeType)
    && (expected === undefined || (validateAssetVersionRef(expected) && assetPinKey(ref) === assetPinKey(expected)));
}
export function validateAssetPinManifest(value: unknown, expected?: readonly AssetVersionRef[]): value is AssetPinManifest {
  if (!isPlainObject(value) || !exactKeys(value, ["schemaVersion", "pins"]) || value.schemaVersion !== 1
    || !Array.isArray(value.pins) || !value.pins.every((pin) => validateAssetVersionPin(pin))) return false;
  const keys = (value.pins as AssetVersionPin[]).map(assetPinKey);
  if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) return false;
  if (expected === undefined) return true;
  if (!Array.isArray(expected) || !expected.every(validateAssetVersionRef)) return false;
  const requested = [...new Set(expected.map(assetPinKey))].sort();
  return keys.length === requested.length && keys.every((key, index) => key === requested[index]);
}

export function validateAssetFolder(value: unknown): value is AssetFolder {
  return isPlainObject(value) && exactKeys(value, ["id", "parentId", "name", "state", "revision", "createdAt", "updatedAt"])
    && isSafeRecordId(value.id) && (value.parentId === null || isSafeRecordId(value.parentId))
    && isValidAssetFileName(value.name) && value.name === value.name.trim()
    && (value.state === "active" || value.state === "trash") && isAssetRevision(value.revision)
    && isCanonicalAssetTimestamp(value.createdAt) && isCanonicalAssetTimestamp(value.updatedAt)
    && value.updatedAt >= value.createdAt;
}

/** Validates the complete logical graph, including trash. Active sibling names
 * collide case-insensitively after NFC normalization. Trash keeps its parent;
 * only empty folders may be trashed, and restore requires an active parent. */
export function validateAssetSnapshot(value: unknown): value is AssetSnapshot {
  if (!isPlainObject(value) || !isJsonSafe(value) || !exactKeys(value, ["schemaVersion", "mutationToken", "records", "folders"])
    || value.schemaVersion !== ASSET_SCHEMA_VERSION || !isValidAssetChecksum(value.mutationToken)
    || !Array.isArray(value.records) || !Array.isArray(value.folders)) return false;
  if (!value.records.every((record) => validateAssetRecord(record).ok) || !value.folders.every(validateAssetFolder)) return false;
  const snapshot = value as unknown as AssetSnapshot;
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
