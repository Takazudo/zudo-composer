import type { RecordMutationTokenSource, SafeRootFilesystemOperations } from "../../../shared/node-fs";
import { MAPPING_SCHEMA_VERSION } from "../../model";

/** Pointer/generation protocol version owned by the transactional record store. */
export const MAPPING_RECORD_SCHEMA_VERSION = 1;

/** Reserved record id for the domain metadata document; no Mapping id may use it. */
export const MAPPING_META_RECORD_ID = "meta";

/**
 * The provider's exact-physical-shape check.
 *
 * A directory of JSON documents cannot be interrogated for its keys and
 * uniqueness, so the layout it was written with is recorded once, in the domain
 * metadata document, and compared on every open. A store whose marker differs is refused
 * with `unsupported-version`: the records are preserved exactly as found and
 * nothing is re-shaped to fit the current expectation.
 */
export const MAPPING_FILESYSTEM_LAYOUT = Object.freeze({
  layoutVersion: 1,
  mappingRecordSchemaVersion: MAPPING_SCHEMA_VERSION,
});

export type MappingFilesystemLayout = typeof MAPPING_FILESYSTEM_LAYOUT;

export interface FilesystemMappingStoreOptions {
  /** The fixed directory below which every Mapping record file lives. */
  mappingsRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<SafeRootFilesystemOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
  /** Only isolated reproducible workspace generation overrides live random tokens. */
  newMutationToken?: RecordMutationTokenSource;
}
