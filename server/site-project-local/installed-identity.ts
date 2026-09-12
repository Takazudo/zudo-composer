import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { releaseJson } from "../../src/site-project/api/review";
import { CONTRACT_IDENTITY_ENTRIES } from "./contract-entries.mjs";

/** pnpm 11.5.2's createExportableManifest removes these unpublished fields and
 * lifecycle scripts. Normalize JSON formatting and top-level property order;
 * nested order (notably export conditions) can change resolution and is kept.
 * Every remaining manifest value is still attested. This projection
 * applies only to the contract; component pack manifests retain their bytes. */
function publishedContractManifest(text: string): string {
  const manifest = JSON.parse(text) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Contract package manifest must be an object.");
  delete manifest.packageManager;
  delete manifest.pnpm;
  if (manifest.scripts !== undefined) {
    if (!manifest.scripts || typeof manifest.scripts !== "object" || Array.isArray(manifest.scripts)) throw new Error("Contract package scripts must be an object.");
    const scripts = manifest.scripts as Record<string, unknown>;
    for (const name of ["prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"]) delete scripts[name];
  }
  return JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, manifest[key]])));
}

/** Attests the actual installed package, not its declared URL. Package-manager
 * indirection is resolved by the caller; no link inside this tree is followed.
 *
 * A nested `node_modules` is skipped rather than hashed. It is never part of a
 * package's published bytes, and under pnpm/workspaces it is a tree of symlinks
 * into the store — hashing it would make a checkout and an install of the same
 * package attest differently, which is the opposite of the point.
 *
 * The contract's fixed published entry set excludes the containing directory's
 * mode and unrelated children, while still checking the root and requiring
 * each selected entry to exist. */
async function packageDigest(directory: string, contractOnly = false): Promise<string> {
  const root = resolve(directory), pinned = await realpath(root);
  const selected = contractOnly ? [...CONTRACT_IDENTITY_ENTRIES].sort() : undefined;
  const entries: [string, string, number, string][] = [];
  const visit = async (path: string, relative: string): Promise<void> => {
    const before = await lstat(path);
    if (before.isSymbolicLink() || await realpath(root) !== pinned || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package tree contains a link or changed root.");
    if (before.isDirectory()) {
      const names = (await readdir(path)).sort().filter((name) => contractOnly || name !== "node_modules"); entries.push([relative, "directory", before.mode & 0o777, ""]);
      for (const name of names) await visit(join(path, name), relative ? `${relative}/${name}` : name);
      if (JSON.stringify((await readdir(path)).sort().filter((name) => contractOnly || name !== "node_modules")) !== JSON.stringify(names)) throw new Error("Installed package directory changed during hashing.");
    } else if (before.isFile()) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.mode !== before.mode) throw new Error("Installed package file changed before hashing.");
        const hash = createHash("sha256");
        if (contractOnly && relative === "package.json") hash.update(publishedContractManifest(await handle.readFile("utf8")));
        else for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Installed package file changed during hashing.");
        entries.push([relative, "file", before.mode & 0o777, hash.digest("hex")]);
      } finally { await handle.close(); }
    } else throw new Error("Installed package contains a non-regular entry.");
    const after = await lstat(path); if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.isSymbolicLink() || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package entry changed during hashing.");
  };
  if (selected) {
    const before = await lstat(root);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("Installed package root contains a link or is not a directory.");
    for (const entry of selected) await visit(join(root, entry), entry);
    const after = await lstat(root);
    if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.isSymbolicLink() || await realpath(root) !== pinned) throw new Error("Installed package root changed during hashing.");
  } else await visit(root, "");
  return createHash("sha256").update(releaseJson(entries)).digest("hex");
}

export const installedPackageDigest = (directory: string): Promise<string> => packageDigest(directory);
export const installedContractDigest = (directory: string): Promise<string> => packageDigest(directory, true);
