// The workspace initialization lock, across processes.
//
// In the browser, once-only multi-provider seeding is serialized with a Web
// Lock (`zudo-workspace-seed-<id>`) so two tabs cannot both seed a workspace.
// Two dev servers are two processes, and a Web Lock cannot reach across them,
// so the filesystem lane uses the shared kernel `O_EXCL` mutation lock instead:
// one lock directory per workspace, holding the same `.mutation.lock` file
// every other durable writer in this codebase agrees on.
//
// The lock is never stolen. A holder that dies leaves the file behind and every
// later seed of that workspace fails closed with `conflict` until a human
// verifies no writer is running and removes it — the same rule the record store
// states for its own lock. Waiting is bounded and optional; the guarantee this
// module makes is that two holders never run at once, not that a caller waits.

import { SafeRootFilesystem, withMutationLock } from "../../shared/node-fs";
import type { DurableExtraErrorCode, SafeRootErrorPolicy, SafeRootFilesystemOperations } from "../../shared/node-fs";
import { join } from "node:path";
import { workspaceDirectoryName } from "../../shared/workspace-scope";
import { WorkspaceRegistryError, type WorkspaceRegistryErrorCode } from "./types";

type Operation = "seed";

/** Lock directories live beside the registry documents, one per workspace. */
export const WORKSPACE_SEED_LOCK_DIRECTORY = "seeding";

/** Every lock failure belongs to the creation attempt that wanted to seed. */
function lockError(code: WorkspaceRegistryErrorCode, message: string, cause?: unknown): WorkspaceRegistryError {
  const retryable = code === "read-failed" || code === "write-failed" || code === "conflict";
  return new WorkspaceRegistryError("create", code, message, retryable, cause === undefined ? undefined : { cause });
}

const errorPolicy: SafeRootErrorPolicy<Operation, DurableExtraErrorCode> = {
  isError: (value) => value instanceof WorkspaceRegistryError,
  create: (_operation, code, message, cause) => lockError(code, message, cause),
  rethrow: (_operation, code, message, cause) => {
    if (cause instanceof WorkspaceRegistryError) throw cause;
    throw lockError(code, message, cause);
  },
};

export interface WorkspaceSeedLockOptions {
  /** The registry root; lock directories are created beneath it. */
  registryRoot: string;
  operations?: Partial<SafeRootFilesystemOperations>;
  randomToken?: () => string;
  now?: () => string;
  /**
   * How long to keep retrying while another process holds the lock. Zero fails
   * immediately, which is what a caller that cannot usefully wait should ask
   * for.
   */
  waitMs?: number;
  /** Delay between acquisition attempts while waiting. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_WAIT_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 50;

function isLockConflict(value: unknown): boolean {
  return value instanceof WorkspaceRegistryError && value.code === "conflict";
}

/**
 * Run `action` while holding this workspace's seed lock. Exactly one holder
 * runs at a time across every process sharing the registry root.
 */
export async function withWorkspaceSeedLock<T>(id: string, options: WorkspaceSeedLockOptions, action: () => Promise<T>): Promise<T> {
  const root = join(options.registryRoot, WORKSPACE_SEED_LOCK_DIRECTORY, workspaceDirectoryName(id));
  const filesystem = await SafeRootFilesystem.create<Operation, DurableExtraErrorCode>({
    root,
    errors: errorPolicy,
    rootLabel: "Workspace seed lock directory",
    ownerLabel: "Workspace seed",
    recordLabel: "workspace seed lock",
    initializeOperation: "seed",
    ...(options.operations === undefined ? {} : { operations: options.operations }),
    ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
  });
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);
  const delay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (;;) {
    // Only a failure to ACQUIRE may be retried. A conflict raised by the action
    // itself is the caller's to handle, so the wait is gated on whether the
    // action was ever entered rather than on the error alone.
    let entered = false;
    try {
      // `run` takes the in-process root queue; `withMutationLock` must not
      // re-enter it, so the cross-process lock is taken inside it.
      return await filesystem.run("seed", () => withMutationLock(filesystem, "seed", { now }, () => {
        entered = true;
        return action();
      }));
    } catch (cause) {
      if (entered || !isLockConflict(cause) || Date.now() >= deadline) throw cause;
      await sleep(delay);
    }
  }
}
