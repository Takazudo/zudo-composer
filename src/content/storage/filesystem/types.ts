import type { SafeRootFilesystemOperations } from "../../../shared/node-fs";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_MODEL_SCHEMA_VERSION } from "../../model";

/** Pointer/generation protocol version owned by the transactional record store. */
export const CONTENT_RECORD_SCHEMA_VERSION = 1;

/** `model-<id>.json` and `entry-<id>.json` share one record-id namespace. */
export const CONTENT_MODEL_RECORD_PREFIX = "model-";
export const CONTENT_ENTRY_RECORD_PREFIX = "entry-";
export const CONTENT_META_RECORD_ID = "meta";

/**
 * Longest Content id that still yields a path-safe prefixed record id. Both
 * prefixes are the same length, so one cap covers models and entries.
 */
export const MAX_CONTENT_ID_LENGTH = 128 - CONTENT_MODEL_RECORD_PREFIX.length;

/**
 * The filesystem counterpart of the IndexedDB provider's exact-physical-shape
 * check.
 *
 * IndexedDB can interrogate a live database for its keyPaths, indexes and
 * uniqueness. A directory of JSON documents cannot be interrogated that way, so
 * the layout it was written with is recorded once, in the domain metadata
 * document, and compared on every open. A store whose marker differs is refused
 * with `unsupported-version`: the records are preserved exactly as found and
 * nothing is re-shaped to fit the current expectation.
 */
export const CONTENT_FILESYSTEM_LAYOUT = Object.freeze({
  layoutVersion: 1,
  modelRecordPrefix: CONTENT_MODEL_RECORD_PREFIX,
  entryRecordPrefix: CONTENT_ENTRY_RECORD_PREFIX,
  modelRecordSchemaVersion: CONTENT_MODEL_SCHEMA_VERSION,
  entryRecordSchemaVersion: CONTENT_ENTRY_SCHEMA_VERSION,
  entryOrder: "modelId-createdAt-id",
});

export type ContentFilesystemLayout = typeof CONTENT_FILESYSTEM_LAYOUT;

export interface FilesystemContentStoreOptions {
  /** The fixed directory below which every Content record file lives. */
  contentRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<SafeRootFilesystemOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
  /** Clock used when a provider-owned operation restamps `updatedAt`. */
  now?: () => string;
}
