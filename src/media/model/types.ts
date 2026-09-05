import type { RecordId } from "../../shared";

/** The only Media document schema understood by this build. */
export const MEDIA_SCHEMA_VERSION = 2 as const;
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
  folderId: string | null;
  note: string;
  state: "active" | "trash";
  currentVersionId: string;
  versions: MediaVersion[];
}

export interface MediaVersion {
  /** SHA-256 identifies immutable bytes, independently of the mutable head. */
  id: string;
  mediaType: MediaType;
  byteLength: number;
  checksum: string;
  url: string;
  createdAt: string;
}

/** The canonical record envelope persisted by a Media provider. */
export interface MediaRecord {
  id: RecordId;
  revision: number;
  createdAt: string;
  updatedAt: string;
  document: MediaDocument;
}

export interface MediaFolder {
  id: string;
  parentId: string | null;
  name: string;
  state: "active" | "trash";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** One atomic global metadata snapshot, separate from SiteProject providers. */
export interface MediaSnapshot {
  schemaVersion: MediaSchemaVersion;
  mutationToken: string;
  records: MediaRecord[];
  folders: MediaFolder[];
}

export interface MediaVersionRef { providerId: string; assetId: string; versionId: string }
export interface MediaVersionPin extends MediaVersionRef {
  checksum: string;
  byteLength: number;
  mediaType: MediaType;
  url: string;
}
export interface MediaPinManifest { schemaVersion: 1; pins: MediaVersionPin[] }

export const MEDIA_EXTENSION_BY_TYPE = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "application/pdf": "pdf",
} as const;

export function mediaVersionUrl(checksum: string, mediaType: MediaType): string {
  return `/uploaded-media/sha256-${checksum}.${MEDIA_EXTENSION_BY_TYPE[mediaType]}`;
}

/** Authoring references retain asset identity; release uses exact version URLs. */
export function mediaAuthoringUrl(assetId: string): string {
  return `/uploaded-media/asset-${assetId}`;
}
