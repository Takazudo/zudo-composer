// @ts-check
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";

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
  return { release() {
    // Vite and the CLI can close concurrently on one signal. Every caller must
    // await the same unlink, otherwise one exits while another still owns it.
    releasing ??= (async () => {
      await handle.close();
      const current = await lstat(path);
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error("Authoring lease ownership changed; preserved conflicting lock.");
      await unlink(path);
    })();
    return releasing;
  } };
}
