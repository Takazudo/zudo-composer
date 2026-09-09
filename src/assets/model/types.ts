import type { RecordId } from "../../shared";
import {
  ASSET_ACCEPT,
  ASSET_CHECKSUM_FILE_NAME_PATTERN,
  ASSET_CHECKSUM_URL_PATTERN,
  ASSET_CONTENT_TYPE_BY_EXTENSION,
  ASSET_EXTENSION_ALTERNATION,
  ASSET_EXTENSION_BY_TYPE,
  ASSET_IMMUTABLE_CACHE_CONTROL,
  ASSET_KINDS,
  ASSET_NOSNIFF,
  ASSET_PIN_FILE_NAME_PATTERN,
  ASSET_TYPES,
  ASSET_TYPE_ALLOWLIST,
  assetContentDisposition,
  assetKindForMime,
  assetMimeTypeForExtension,
} from "./asset-kinds.mjs";
export {
  ASSET_ACCEPT,
  ASSET_CHECKSUM_FILE_NAME_PATTERN,
  ASSET_CHECKSUM_URL_PATTERN,
  ASSET_CONTENT_TYPE_BY_EXTENSION,
  ASSET_EXTENSION_ALTERNATION,
  ASSET_EXTENSION_BY_TYPE,
  ASSET_IMMUTABLE_CACHE_CONTROL,
  ASSET_KINDS,
  ASSET_NOSNIFF,
  ASSET_PIN_FILE_NAME_PATTERN,
  ASSET_TYPES,
  ASSET_TYPE_ALLOWLIST,
  assetContentDisposition,
  assetKindForMime,
  assetMimeTypeForExtension,
};
export type { AssetKindDescriptor, AssetKindName } from "./asset-kinds.mjs";

/** The only Assets document schema understood by this build. */
export const ASSET_SCHEMA_VERSION = 1 as const;
export type AssetSchemaVersion = typeof ASSET_SCHEMA_VERSION;

export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetExtension = (typeof ASSET_KINDS)[keyof typeof ASSET_KINDS]["extension"];
export type AssetKind = (typeof ASSET_KINDS)[keyof typeof ASSET_KINDS]["kind"];

/** Maximum display filename length, measured in Unicode code points. */
export const ASSET_FILE_NAME_MAX_LENGTH = 255;

/** The upload ceiling used by the Assets transport and filesystem providers. */
export const ASSET_MAX_BYTE_LENGTH = 25 * 1024 * 1024;

/** Lowercase hexadecimal SHA-256 digest. */
export const ASSET_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** Persisted Assets metadata. Binary bytes are stored by providers separately. */
export interface AssetDocument {
  schemaVersion: AssetSchemaVersion;
  id: RecordId;
  fileName: string;
  folderId: string | null;
  note: string;
  state: "active" | "trash";
  currentVersionId: string;
  versions: AssetVersion[];
}

export interface AssetVersion {
  /** SHA-256 identifies immutable bytes, independently of the mutable head. */
  id: string;
  mimeType: AssetType;
  byteLength: number;
  checksum: string;
  url: string;
  createdAt: string;
}

/** The canonical record envelope persisted by a Assets provider. */
export interface AssetRecord {
  id: RecordId;
  revision: number;
  createdAt: string;
  updatedAt: string;
  document: AssetDocument;
}

export interface AssetFolder {
  id: string;
  parentId: string | null;
  name: string;
  state: "active" | "trash";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** One atomic global metadata snapshot, separate from SiteProject providers. */
export interface AssetSnapshot {
  schemaVersion: AssetSchemaVersion;
  mutationToken: string;
  records: AssetRecord[];
  folders: AssetFolder[];
}

/** Stable provider-qualified identity used by authoring references. */
export interface AssetAssetRef { providerId: string; assetId: string }
/** Exact immutable version identity used by release/pin operations. */
export interface AssetVersionRef extends AssetAssetRef { versionId: string }
export interface AssetVersionPin extends AssetVersionRef {
  checksum: string;
  byteLength: number;
  mimeType: AssetType;
  url: string;
}
export interface AssetPinManifest { schemaVersion: 1; pins: AssetVersionPin[] }

export function assetVersionUrl(checksum: string, mimeType: AssetType): string {
  return `/uploaded-assets/sha256-${checksum}.${ASSET_EXTENSION_BY_TYPE[mimeType]}`;
}

/** Authoring references retain asset identity; release uses exact version URLs. */
export function assetAuthoringUrl(assetId: string): string {
  return `/uploaded-assets/asset-${assetId}`;
}
