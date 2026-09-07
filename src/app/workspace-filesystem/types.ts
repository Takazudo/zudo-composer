import type { SafeRootFilesystemOperations } from "../../shared/node-fs";

/** Pointer/generation protocol version owned by the transactional record store. */
export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 1;

/** Reserved record ids inside the registry; no workspace id may use them. */
export const WORKSPACE_META_RECORD_ID = "meta";
export const WORKSPACE_SELECTION_RECORD_ID = "selection";

/**
 * The registry's on-disk layout marker. A directory of JSON documents cannot be
 * interrogated for its stores and key paths, so the layout it was written with
 * is recorded once and compared on every read. A registry whose marker differs
 * is refused; its records are preserved exactly as found and nothing is
 * re-shaped.
 */
export const WORKSPACE_REGISTRY_LAYOUT = Object.freeze({
  layoutVersion: 1,
  workspaceRecordSchemaVersion: 1,
});

export type WorkspaceRegistryLayout = typeof WORKSPACE_REGISTRY_LAYOUT;

export type WorkspaceRegistryOperation =
  | "initialize"
  | "read"
  | "create"
  | "complete"
  | "update"
  | "discard"
  | "select";

export type WorkspaceRegistryErrorCode =
  | "blocked"
  | "read-failed"
  | "write-failed"
  | "conflict"
  | "commit-uncertain"
  | "validation"
  | "unsupported-version";

/** Registry failures carry the same operation/code/retryable shape as the domains. */
export class WorkspaceRegistryError extends Error {
  constructor(
    readonly operation: WorkspaceRegistryOperation,
    readonly code: WorkspaceRegistryErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WorkspaceRegistryError";
  }
}

export interface FilesystemWorkspaceRegistryOptions {
  /** The fixed directory holding the registry documents, e.g. `<cms>/workspaces`. */
  registryRoot: string;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<SafeRootFilesystemOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
  now?: () => string;
  /** Identity source for `create()`; defaults to `crypto.randomUUID()`. */
  newWorkspaceId?: () => string;
}
