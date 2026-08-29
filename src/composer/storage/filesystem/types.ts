import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { CompositionLoadOutcome, CompositionRecord } from "../../library";

/**
 * Browser-produced output for one canonical record. The filesystem core owns
 * every read/write; this payload only carries a pure planner's decision.
 */
export type FilesystemDerivedOutputPlan =
  | { status: "generated"; code: string }
  | { status: "blocked"; reason: string };

/**
 * One immutable same-provider closure. It crosses the dev-only plugin boundary
 * so the browser can run its manifest-aware pure planner without any callback
 * into list/get while the filesystem root queue is held.
 */
export interface FilesystemDerivedOutputRequest {
  records: readonly CompositionRecord[];
  sourceOutcomes: readonly {
    id: string;
    outcome: CompositionLoadOutcome;
  }[];
  targetIds: readonly string[];
}

/**
 * Derived modules are supplied by the browser's pure planner. The optional
 * batch argument is deliberately immutable data, not a store/provider handle.
 * String support retains the direct-core test and embedding seam for ordinary
 * non-linked records.
 */
export type CompositionJsxProvider = (
  record: CompositionRecord,
  request: FilesystemDerivedOutputRequest,
) => string | FilesystemDerivedOutputPlan | Promise<string | FilesystemDerivedOutputPlan>;

/** Narrow injectable seam used to exercise filesystem failure recovery. */
export interface FilesystemStoreOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  open(path: string, flags: number, mode?: number): Promise<FileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface FilesystemCompositionStoreOptions {
  /** The fixed directory below which all Composer-owned artifacts live. */
  compositionsRoot: string;
  /** Supplies the exact production output used to repair missing/stale JSX. */
  provideJsx: CompositionJsxProvider;
  /** Test/fault-injection seam. Omitted methods use Node's real filesystem. */
  operations?: Partial<FilesystemStoreOperations>;
  /** Test-only random source seam; values must contain only URL-safe characters. */
  randomToken?: () => string;
  /** Clock used when a provider-owned lifecycle operation changes a record. */
  now?: () => string;
}
