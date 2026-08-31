import type { IdFactory } from "../../../shared/id-factory";
import type { SafeRootFilesystemOperations } from "../../../shared/node-fs";
import type { MediaByteSource, MediaType } from "../../library";

export type FilesystemMediaStoreOperations = SafeRootFilesystemOperations;

export interface FilesystemMediaStoreOptions {
  /** The fixed `media-store` directory containing records/ and public/. */
  mediaStoreRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's filesystem. */
  operations?: Partial<FilesystemMediaStoreOperations>;
  /** Used for exclusive temporary names. */
  randomToken?: () => string;
  /** Server-side record-id source. */
  idFactory?: IdFactory;
  /** Clock used for server-created records. */
  now?: () => string;
}

export interface MediaUploadInput {
  fileName: string;
  /** Advisory only. Persisted type and extension come from the byte signature. */
  declaredMediaType: string;
  bytes: MediaByteSource;
  signal?: AbortSignal;
}

export interface SniffedMedia {
  mediaType: MediaType;
  extension: "png" | "jpg" | "gif" | "webp" | "pdf";
}
