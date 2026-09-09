import type { IdFactory } from "../../../shared/id-factory";
import type { SafeRootFilesystemOperations } from "../../../shared/node-fs";
import type { link } from "node:fs/promises";
import type { AssetByteSource, AssetType } from "../../library";

export interface FilesystemAssetStoreOperations extends SafeRootFilesystemOperations { link: typeof link }

export interface FilesystemAssetStoreOptions {
  /** The host's configured assets directory: `catalog.json` plus private `versions/`. */
  assetsStoreRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's filesystem. */
  operations?: Partial<FilesystemAssetStoreOperations>;
  /** Used for exclusive temporary names. */
  randomToken?: () => string;
  /** Server-side record-id source. */
  idFactory?: IdFactory;
  /** Clock used for server-created records. */
  now?: () => string;
}

export interface AssetUploadInput {
  fileName: string;
  /** Advisory only. Persisted type and extension come from the byte signature. */
  declaredMimeType: string;
  bytes: AssetByteSource;
  signal?: AbortSignal;
  folderId?: string | null;
  note?: string;
  expectedMutationToken?: string;
}

export interface AssetReplaceInput { bytes: AssetByteSource; signal?: AbortSignal }

export interface SniffedAsset {
  mimeType: AssetType;
  extension: "png" | "jpg" | "gif" | "webp" | "pdf";
}
