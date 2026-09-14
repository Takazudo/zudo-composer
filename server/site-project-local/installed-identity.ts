import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
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
/** Host-local component source selected by the pack source graph. `files` are
 * host-root-relative POSIX paths, sorted and in-host; `dependencies` are the
 * resolved bare packages the graph reaches, sorted by name. */
export interface PackSourceGraphInput {
  readonly files: readonly string[];
  readonly dependencies: readonly { readonly name: string; readonly version: string }[];
}

type DigestMode = { readonly kind: "directory" } | { readonly kind: "contract" } | { readonly kind: "graph"; readonly graph: PackSourceGraphInput };

const compareCodePoints = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function assertStrictlySorted(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) if (compareCodePoints(values[index - 1]!, values[index]!) >= 0) throw new Error(`Pack source graph ${label} must be sorted and unique.`);
}

function graphFiles(root: string, graph: PackSourceGraphInput): string[] {
  const files = [...graph.files];
  for (const file of files) {
    if (typeof file !== "string" || !file || isAbsolute(file) || file.includes("\\") || file.includes("\0") || file.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`Pack source graph file ${JSON.stringify(file)} must be a normalized host-relative path.`);
    if (!resolve(root, file).startsWith(root + sep)) throw new Error(`Pack source graph file ${JSON.stringify(file)} escapes the host root.`);
  }
  assertStrictlySorted(files, "files");
  return files;
}

function graphDependencies(graph: PackSourceGraphInput): [string, string, number, string][] {
  for (const { name, version } of graph.dependencies) if (typeof name !== "string" || !name || typeof version !== "string" || !version) throw new Error("Pack source graph dependencies need a resolved name and version.");
  assertStrictlySorted(graph.dependencies.map(({ name }) => name), "dependencies");
  return graph.dependencies.map(({ name, version }) => [name, "dependency", 0, version]);
}

/** The host manifest fields that decide how graph-selected source resolves:
 * identity, module type, the `exports` self-reference (condition order kept)
 * and dependency ranges. Other fields (description, scripts...) are not part
 * of the pack's identity. */
function hostManifestProjection(text: string): string {
  const manifest = JSON.parse(text) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Host package manifest must be an object.");
  const ranges = (field: string): unknown => {
    const value = manifest[field];
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Host package ${field} must be an object.`);
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareCodePoints(a, b)));
  };
  return JSON.stringify([manifest.name ?? null, manifest.type ?? null, manifest.exports ?? null, ranges("dependencies") ?? null, ranges("peerDependencies") ?? null, ranges("optionalDependencies") ?? null]);
}

async function packageDigest(directory: string, mode: DigestMode): Promise<string> {
  const root = resolve(directory), pinned = await realpath(root);
  const contractOnly = mode.kind === "contract", graphOnly = mode.kind === "graph";
  const selected = mode.kind === "contract" ? [...CONTRACT_IDENTITY_ENTRIES].sort() : mode.kind === "graph" ? graphFiles(root, mode.graph) : undefined;
  const entries: [string, string, number, string][] = [];
  const visit = async (path: string, relative: string, manifest = false): Promise<void> => {
    const before = await lstat(path);
    if (before.isSymbolicLink() || await realpath(root) !== pinned || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package tree contains a link or changed root.");
    if (before.isDirectory() && !graphOnly) {
      const names = (await readdir(path)).sort().filter((name) => contractOnly || name !== "node_modules"); entries.push([relative, "directory", before.mode & 0o777, ""]);
      for (const name of names) await visit(join(path, name), relative ? `${relative}/${name}` : name);
      if (JSON.stringify((await readdir(path)).sort().filter((name) => contractOnly || name !== "node_modules")) !== JSON.stringify(names)) throw new Error("Installed package directory changed during hashing.");
    } else if (before.isFile()) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.mode !== before.mode) throw new Error("Installed package file changed before hashing.");
        const hash = createHash("sha256");
        if (contractOnly && relative === "package.json") hash.update(publishedContractManifest(await handle.readFile("utf8")));
        else if (manifest) hash.update(hostManifestProjection(await handle.readFile("utf8")));
        else for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Installed package file changed during hashing.");
        entries.push(manifest ? [relative, "manifest", 0, hash.digest("hex")] : [relative, "file", before.mode & 0o777, hash.digest("hex")]);
      } finally { await handle.close(); }
    } else throw new Error("Installed package contains a non-regular entry.");
    const after = await lstat(path); if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.isSymbolicLink() || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package entry changed during hashing.");
  };
  if (selected) {
    const before = await lstat(root);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("Installed package root contains a link or is not a directory.");
    for (const entry of selected) await visit(join(root, entry), entry);
    if (mode.kind === "graph") { await visit(join(root, "package.json"), "package.json", true); entries.push(...graphDependencies(mode.graph)); }
    const after = await lstat(root);
    if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.isSymbolicLink() || await realpath(root) !== pinned) throw new Error("Installed package root changed during hashing.");
  } else await visit(root, "");
  return createHash("sha256").update(releaseJson(entries)).digest("hex");
}

export const installedPackageDigest = (directory: string): Promise<string> => packageDigest(directory, { kind: "directory" });
export const installedContractDigest = (directory: string): Promise<string> => packageDigest(directory, { kind: "contract" });
/** Attests only the host files a pack source graph selected, plus the host
 * manifest projection and the resolved bare dependencies. Every listed path
 * must be a regular in-host file reached without links. */
export const installedPackGraphDigest = (hostRoot: string, graph: PackSourceGraphInput): Promise<string> => packageDigest(hostRoot, { kind: "graph", graph });
