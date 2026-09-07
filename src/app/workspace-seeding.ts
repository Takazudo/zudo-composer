// Cleanup of an abandoned workspace creation attempt.
//
// Seeding writes into four directories a workspace owns exclusively, so
// discarding an attempt is a directory removal rather than four database
// deletions. The persisted `seedCleanupPending` marker is what makes it
// restartable: the registry records the intent, the directories go, and only
// then is the attempt removed. A crash between the marker and the removal
// leaves an attempt that the next open of that exact attempt finishes cleaning,
// never one whose records are half gone but still reachable.

import type { WorkspaceStorage } from "./workspace-storage";

/**
 * Discard one owned, unselected seeding attempt.
 *
 * The caller holds that workspace's initialization lock for the whole sequence:
 * the registry refuses each step unless the attempt is still seeding, still
 * unselected and still on the same baseline, and those checks are only worth
 * anything if nothing else may interleave between them.
 */
export async function discardWorkspaceSeed(storage: WorkspaceStorage, id: string, baselineRevision: string): Promise<void> {
  await storage.markSeedCleanup(id, baselineRevision);
  await storage.deleteDirectories(id);
  await storage.discardSeeding(id, baselineRevision);
}
