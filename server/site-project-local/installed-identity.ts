import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { releaseJson } from "../../src/site-project/api/review";

/** Attests the actual installed package, not its declared URL. Package-manager
 * indirection is resolved by the caller; no link inside this tree is followed.
 *
 * A nested `node_modules` is skipped rather than hashed. It is never part of a
 * package's published bytes, and under pnpm/workspaces it is a tree of symlinks
 * into the store — hashing it would make a checkout and an install of the same
 * package attest differently, which is the opposite of the point. */
export async function installedPackageDigest(directory: string): Promise<string> {
  const root = resolve(directory), pinned = await realpath(root);
  const entries: [string, string, number, string][] = [];
  const visit = async (path: string, relative: string): Promise<void> => {
    const before = await lstat(path);
    if (before.isSymbolicLink() || await realpath(root) !== pinned || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package tree contains a link or changed root.");
    if (before.isDirectory()) {
      const names = (await readdir(path)).sort().filter((name) => name !== "node_modules"); entries.push([relative, "directory", before.mode & 0o777, ""]);
      for (const name of names) await visit(join(path, name), relative ? `${relative}/${name}` : name);
      if (JSON.stringify((await readdir(path)).sort().filter((name) => name !== "node_modules")) !== JSON.stringify(names)) throw new Error("Installed package directory changed during hashing.");
    } else if (before.isFile()) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.mode !== before.mode) throw new Error("Installed package file changed before hashing.");
        const hash = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Installed package file changed during hashing.");
        entries.push([relative, "file", before.mode & 0o777, hash.digest("hex")]);
      } finally { await handle.close(); }
    } else throw new Error("Installed package contains a non-regular entry.");
    const after = await lstat(path); if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.isSymbolicLink() || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package entry changed during hashing.");
  };
  await visit(root, "");
  return createHash("sha256").update(releaseJson(entries)).digest("hex");
}
