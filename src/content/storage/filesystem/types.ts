import type { RecordMutationTokenSource, SafeRootFilesystemOperations } from "../../../shared/node-fs";

export {
  CONTENT_ENTRY_RECORD_PREFIX,
  CONTENT_FILESYSTEM_LAYOUT,
  CONTENT_META_RECORD_ID,
  CONTENT_MODEL_RECORD_PREFIX,
  CONTENT_RECORD_SCHEMA_VERSION,
  MAX_CONTENT_ID_LENGTH,
  type ContentFilesystemLayout,
} from "./layout";

export interface FilesystemContentStoreOptions {
  /** The fixed directory below which every Content record file lives. */
  contentRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<SafeRootFilesystemOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
  /** Only isolated reproducible workspace generation overrides live random tokens. */
  newMutationToken?: RecordMutationTokenSource;
  /** Clock used when a provider-owned operation restamps `updatedAt`. */
  now?: () => string;
}
