import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { basename } from "node:path";
import type { Stats } from "node:fs";
import { errorCode, sameFile, type DurableExtraErrorCode, type SafeRootFilesystem } from "./safe-root";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;

/** Cooperating writers across processes agree on this exact filename. */
export const MUTATION_LOCK_FILENAME = ".mutation.lock";

/**
 * Marks a failure that happened after the commit rename but before durability
 * was proven. The mutation may or may not survive a power loss, so it must
 * never be reported as a plain failed/unchanged mutation and must never be
 * retried blindly.
 */
export const COMMIT_UNCERTAIN = Symbol.for("zudo-composer.commit-uncertain");

export function isCommitUncertain(value: unknown): boolean {
  return typeof value === "object" && value !== null && COMMIT_UNCERTAIN in value;
}

/** Domain-specific re-verification run before every durability-sensitive step. */
export type DurabilityVerifier<Operation extends string> = (operation: Operation) => Promise<void>;

/**
 * fsync a directory so a rename or link inside it is durable. A directory
 * fsync that fails or is unsupported is a hard write failure: without it the
 * store cannot honestly claim the mutation survives a crash.
 */
export async function syncDirectory<Operation extends string>(
  filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
  operation: Operation,
  path: string,
  verify?: DurabilityVerifier<Operation>,
): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    await filesystem.assertRoot(operation);
    await verify?.(operation);
    handle = await filesystem.operations.open(path, constants.O_RDONLY | NO_FOLLOW | DIRECTORY);
    const opened = await handle.stat();
    const current = await filesystem.operations.lstat(path);
    if (!opened.isDirectory() || current.isSymbolicLink() || !sameFile(opened, current)) {
      throw filesystem.errors.create(
        operation,
        "blocked",
        `${filesystem.ownerLabel} directory changed before durability sync.`,
      );
    }
    await handle.sync();
  } catch (cause) {
    filesystem.errors.rethrow(
      operation,
      "write-failed",
      `${filesystem.ownerLabel} directory fsync is required but failed or is unsupported.`,
      cause,
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Cross-process mutation lock built on kernel `O_EXCL`.
 *
 * Never steal an existing lock: after a crash, verify no writer is running
 * before removing `.mutation.lock` by hand. Reads stay available while the
 * lock is held, so recovery never blocks the authoring UI.
 */
export class MutationLock<Operation extends string> {
  private constructor(
    private readonly filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
    private readonly operation: Operation,
    readonly path: string,
    private readonly handle: FileHandle,
    private readonly stats: Stats,
  ) {}

  static async acquire<Operation extends string>(
    filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
    operation: Operation,
    now: () => string,
  ): Promise<MutationLock<Operation>> {
    const path = filesystem.ownedPath(MUTATION_LOCK_FILENAME);
    let handle: FileHandle;
    try {
      handle = await filesystem.operations.open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
        0o600,
      );
    } catch (cause) {
      if (errorCode(cause) === "EEXIST") {
        throw filesystem.errors.create(
          operation,
          "conflict",
          `Another ${filesystem.ownerLabel} writer holds ${MUTATION_LOCK_FILENAME}. Retry after it finishes; after a crash verify no writer is running before manual lock recovery.`,
        );
      }
      filesystem.errors.rethrow(
        operation,
        "write-failed",
        `Could not acquire ${filesystem.ownerLabel} mutation lock.`,
        cause,
      );
    }
    try {
      const stats = await handle.stat();
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: now() }));
      await handle.sync();
      return new MutationLock(filesystem, operation, path, handle, stats);
    } catch (cause) {
      await handle.close().catch(() => undefined);
      await filesystem.operations.unlink(path).catch(() => undefined);
      filesystem.errors.rethrow(
        operation,
        "write-failed",
        `Could not acquire ${filesystem.ownerLabel} mutation lock.`,
        cause,
      );
    }
  }

  /**
   * Release the lock. `retain` keeps the lock file so the next mutation fails
   * closed — the only correct response to an uncertain commit. Cleanup failure
   * must never turn a committed mutation into a reported failure, so every
   * error here is swallowed.
   */
  async release(retain: boolean): Promise<void> {
    await this.handle.close().catch(() => undefined);
    try {
      await this.filesystem.assertRoot(this.operation);
      const current = await this.filesystem.operations.lstat(this.path);
      if (!retain && current.isFile() && !current.isSymbolicLink() && sameFile(current, this.stats)) {
        await this.filesystem.operations.unlink(this.path);
      }
    } catch {
      /* Retained lock fails closed on the next mutation. */
    }
  }
}

export interface MutationLockOptions<Operation extends string> {
  now: () => string;
  /** Directories fsynced before the task observes any state. */
  preflightDirectories?: readonly string[];
  verify?: DurabilityVerifier<Operation>;
  /** Wrapper applied to every failure, e.g. the domain's `rethrow`. */
  onFailure?: (cause: unknown) => never;
}

/**
 * Run one whole mutation under the cross-process lock.
 *
 * The caller must already hold the in-process root queue (`filesystem.run`);
 * this helper never re-enters it, because that queue is not reentrant.
 */
export async function withMutationLock<Operation extends string, T>(
  filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
  operation: Operation,
  options: MutationLockOptions<Operation>,
  task: () => Promise<T>,
): Promise<T> {
  await options.verify?.(operation);
  const lock = await MutationLock.acquire(filesystem, operation, options.now);
  let uncertain = false;
  try {
    for (const directory of options.preflightDirectories ?? []) {
      await syncDirectory(filesystem, operation, directory, options.verify);
    }
    return await task();
  } catch (cause) {
    uncertain = isCommitUncertain(cause);
    if (options.onFailure) options.onFailure(cause);
    throw cause;
  } finally {
    await lock.release(uncertain);
  }
}

export interface DocumentCommitOptions<Operation extends string> {
  signal?: AbortSignal;
  verify?: DurabilityVerifier<Operation>;
  /** Explaining what to inspect before recovery. Retrying blindly is unsafe. */
  uncertainMessage?: string;
}

/**
 * Durably replace one owned document by a single atomic rename, then prove the
 * rename itself is durable.
 *
 * Everything before the rename is discardable: a failure leaves the previous
 * document byte-identical. A failure of the post-rename directory fsync is
 * reported as `commit-uncertain` and marked with {@link COMMIT_UNCERTAIN} so
 * {@link withMutationLock} retains the lock.
 */
export async function commitDocument<Operation extends string>(
  filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
  operation: Operation,
  path: string,
  contents: string,
  options: DocumentCommitOptions<Operation> = {},
): Promise<void> {
  const temporary = await filesystem.openTemporaryFile(operation, path);
  let committed = false;
  try {
    await temporary.handle.writeFile(contents);
    await temporary.handle.sync();
    await temporary.handle.close();
    await filesystem.assertRoot(operation);
    await options.verify?.(operation);
    await filesystem.assertReplaceablePath(operation, path);
    options.signal?.throwIfAborted();
    await filesystem.operations.rename(temporary.path, path);
    committed = true;
    try {
      await syncDirectory(filesystem, operation, filesystem.realRoot, options.verify);
    } catch (cause) {
      throw Object.assign(
        filesystem.errors.create(
          operation,
          "commit-uncertain",
          options.uncertainMessage
            ?? `${basename(path)} was renamed into place but its directory durability is uncertain. Inspect the exact document and the retained lock before recovery; do not retry blindly.`,
          cause,
        ),
        { [COMMIT_UNCERTAIN]: true },
      );
    }
  } finally {
    await temporary.handle.close().catch(() => undefined);
    if (!committed) await filesystem.operations.unlink(temporary.path).catch(() => undefined);
  }
}
