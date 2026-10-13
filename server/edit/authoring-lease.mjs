// @ts-check
import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";

const scopeKey = Symbol.for("zudo-composer.authoring-lease-scope.v1");
const processScopes = /** @type {typeof globalThis & {[key: symbol]: AsyncLocalStorage<{root: string, active(): boolean}> | undefined}} */ (globalThis);
const scopes = processScopes[scopeKey] ??= new AsyncLocalStorage();

/** Only a live lease holder can establish this scope; it never crosses HTTP.
 * @template T
 * @param {string} hostRoot
 * @param {() => Promise<T>} action
 * @returns {Promise<T>}
 */
export async function executeAuthoringOperation(hostRoot, action) {
  const root = await realpath(hostRoot);
  const scope = scopes.getStore();
  if (scope?.root === root && scope.active()) return action();
  const lease = await acquireAuthoringLease(root, "reviewed-edit");
  try { return await lease.execute(action); } finally { await lease.release(); }
}

/** An exclusive host session, shared by dev servers and deterministic editors.
 * Never infer crash recovery permission from a PID or timeout.
 * @param {string} hostRoot
 * @param {string} owner
 */
export async function acquireAuthoringLease(hostRoot, owner) {
  const root = await realpath(hostRoot);
  const path = join(root, ".zudo-authoring.lock");
  let handle;
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch (cause) {
    throw Object.assign(new Error("Authoring is busy. Save pending browser edits and stop the authoring server before planning, applying or undoing. After a crash, verify no authoring process remains before removing .zudo-authoring.lock.", { cause }), { code: "authoring-busy" });
  }
  const identity = await handle.stat();
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, owner, createdAt: new Date().toISOString() }));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(path);
    throw error;
  }
  /** @type {Promise<void> | undefined} */
  let releasing;
  let released = false;
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  return {
    /** @template T @param {() => Promise<T>} action @returns {Promise<T>} */
    execute(action) {
      if (releasing || released) return Promise.reject(new Error("Authoring lease is closing."));
      const pending = tail.then(() => {
        if (released) throw new Error("Authoring lease is closed.");
        return scopes.run({ root, active: () => !released }, action);
      });
      tail = pending.catch(() => {});
      return pending;
    },
    release() {
    // Vite and the CLI can close concurrently on one signal. Every caller must
    // await the same unlink, otherwise one exits while another still owns it.
    releasing ??= (async () => {
      await tail;
      released = true;
      await handle.close();
      const current = await lstat(path);
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("Authoring lease ownership changed; preserved conflicting lock.");
      await unlink(path);
    })();
    return releasing;
  } };
}
