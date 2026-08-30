import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import {
  MEDIA_CHECKSUM_PATTERN,
  MEDIA_FILE_NAME_MAX_LENGTH,
  MEDIA_MAX_BYTE_LENGTH,
  MEDIA_SCHEMA_VERSION,
  MEDIA_TYPES,
} from "./types";
import type { MediaRecord, MediaType } from "./types";

const RECORD_KEYS = ["id", "createdAt", "updatedAt", "document"] as const;
const DOCUMENT_KEYS = ["schemaVersion", "id", "fileName", "mediaType", "byteLength", "checksum"] as const;

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
  if (!isValidMediaType(document.mediaType)) return fail("invalid-media-type", "Media mediaType is not allowed.", "document.mediaType");
  if (!isValidMediaByteLength(document.byteLength)) return fail("invalid-byte-length", `Media byteLength must be an integer from 0 to ${MEDIA_MAX_BYTE_LENGTH}.`, "document.byteLength");
  if (!isValidMediaChecksum(document.checksum)) return fail("invalid-checksum", "Media checksum must be a lowercase SHA-256 digest.", "document.checksum");
  return { ok: true, value: value as unknown as MediaRecord };
}
