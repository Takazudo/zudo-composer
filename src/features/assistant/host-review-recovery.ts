const prefix = "zudo-host-review-apply:";
export const hostReviewRecoveryKey = (workspaceId: string, reviewId: string) => `${prefix}${workspaceId}:${reviewId}`;
/** Discovery is an untrusted UI pointer only; the service resolves host/workspace ownership. */
export function pendingHostReviewIds(storage: Storage, workspaceId: string): string[] {
  const scoped = `${prefix}${workspaceId}:`, ids: string[] = [];
  for (let index = 0; index < storage.length && ids.length < 100; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(scoped)) continue;
    const id = key.slice(scoped.length);
    if (/^[a-zA-Z0-9_-]{1,256}$/.test(id)) ids.push(id);
  }
  return ids.sort();
}
