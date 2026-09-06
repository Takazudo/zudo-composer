// Removal of a workspace's authoring directories.
//
// The IndexedDB counterpart deletes the four scoped provider databases; here
// the same four scoped directories are removed. It is called only for an owned,
// unselected seeding attempt, under that workspace's seed lock, between
// `markSeedCleanup()` and `discardSeeding()`: the persisted cleanup marker is
// what makes a failed removal retryable without ever leaving a half-removed
// workspace reachable.

import { lstat, rm } from "node:fs/promises";
import { errorCode } from "../../shared/node-fs";
import { workspaceDomainRoots, type WorkspaceDomainRoots } from "../../shared/workspace-scope";
import { WorkspaceRegistryError } from "./types";

export interface WorkspaceDirectoryOperations {
  lstat: typeof lstat;
  rm: typeof rm;
}

const defaultOperations: WorkspaceDirectoryOperations = { lstat, rm };

/**
 * Remove every authoring directory this workspace owns. A path that is not a
 * plain directory is refused rather than removed, so a symlink planted where a
 * workspace directory belongs can never redirect the deletion.
 */
export async function deleteWorkspaceDirectories(
  roots: WorkspaceDomainRoots,
  id: string,
  operations: Partial<WorkspaceDirectoryOperations> = {},
): Promise<void> {
  const filesystem = { ...defaultOperations, ...operations };
  const scoped = workspaceDomainRoots(roots, id);
  const outcomes = await Promise.allSettled(Object.values(scoped).map(async (path) => {
    let stats;
    try {
      stats = await filesystem.lstat(path);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return;
      throw new WorkspaceRegistryError("discard", "read-failed", `Could not inspect the workspace directory ${path}.`, true, { cause });
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new WorkspaceRegistryError("discard", "blocked", `Refusing to remove a non-directory workspace path: ${path}`, false);
    }
    try {
      await filesystem.rm(path, { recursive: true, force: true });
    } catch (cause) {
      throw new WorkspaceRegistryError("discard", "write-failed", `Could not remove the workspace directory ${path}. Retry this same attempt.`, true, { cause });
    }
  }));
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
