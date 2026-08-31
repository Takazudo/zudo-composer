import type { RecordId } from "../../shared";

/** The only Media document schema understood by this build. */
export const MEDIA_SCHEMA_VERSION = 1 as const;
export type MediaSchemaVersion = typeof MEDIA_SCHEMA_VERSION;

/**
 * Media types accepted by the first Media provider.  Keep this list in the
 * domain so every provider applies the same boundary to untrusted metadata.
 */
export const MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Alias retained as a descriptive name for callers building MIME pickers. */
export const MEDIA_TYPE_ALLOWLIST = MEDIA_TYPES;

/** Maximum display filename length, measured in Unicode code points. */
export const MEDIA_FILE_NAME_MAX_LENGTH = 255;

/** The upload ceiling used by the Media transport and filesystem providers. */
export const MEDIA_MAX_BYTE_LENGTH = 25 * 1024 * 1024;

/** Lowercase hexadecimal SHA-256 digest. */
export const MEDIA_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** Persisted Media metadata. Binary bytes are stored by providers separately. */
export interface MediaDocument {
  schemaVersion: MediaSchemaVersion;
  id: RecordId;
  fileName: string;
  mediaType: MediaType;
  byteLength: number;
  checksum: string;
}

/** The canonical record envelope persisted by a Media provider. */
export interface MediaRecord {
  id: RecordId;
  createdAt: string;
  updatedAt: string;
  document: MediaDocument;
}
