/** Serialize Sitemapper metadata/storage mutations per workspace across tabs. */

const localLocks = new Map<string, Promise<unknown>>();

export async function withSitemapperWorkspaceLock<T>(workspaceId: string | undefined, action: () => Promise<T>): Promise<T> {
  if (!workspaceId) return action();
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`zudo-sitemapper-workspace-${workspaceId}`, action);
  }

  const previous = localLocks.get(workspaceId) ?? Promise.resolve();
  const pending = previous.then(action, action);
  localLocks.set(workspaceId, pending);
  try {
    return await pending;
  } finally {
    if (localLocks.get(workspaceId) === pending) localLocks.delete(workspaceId);
  }
}
