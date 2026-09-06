import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const require = createRequire(import.meta.url);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const releaseJson = (value) => `${canonical(value)}\n`;
const clone = (value) => JSON.parse(JSON.stringify(value));
async function installedPackageDigest(directory) {
  const root = resolve(directory), pinned = await realpath(root), entries = [];
  const visit = async (path, relative) => {
    const before = await lstat(path);
    if (before.isSymbolicLink() || await realpath(root) !== pinned || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package tree contains a link or changed root.");
    if (before.isDirectory()) {
      const names = (await readdir(path)).sort(); entries.push([relative, "directory", before.mode & 0o777, ""]);
      for (const name of names) await visit(join(path, name), relative ? `${relative}/${name}` : name);
      if (JSON.stringify((await readdir(path)).sort()) !== JSON.stringify(names)) throw new Error("Installed package directory changed during hashing.");
    } else if (before.isFile()) {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.mode !== before.mode) throw new Error("Installed package file changed before hashing.");
        const digest = createHash("sha256"); for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
        const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Installed package file changed during hashing.");
        entries.push([relative, "file", before.mode & 0o777, digest.digest("hex")]);
      } finally { await handle.close(); }
    } else throw new Error("Installed package contains a non-regular entry.");
    const after = await lstat(path); if (after.ino !== before.ino || after.dev !== before.dev || after.mode !== before.mode || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.isSymbolicLink() || await realpath(path) !== join(pinned, relative)) throw new Error("Installed package entry changed during hashing.");
  };
  await visit(root, ""); return sha(releaseJson(entries));
}
// Sources that decide a release's compiler identity. Tests are excluded — both
// `__tests__` directories and colocated `*.test.ts` — because they are stripped
// from the published package's `files` allowlist; including them would give an
// installed zudo-composer a different identity from the repository it came from.
async function compilerIdentity() {
  const root = resolve(import.meta.dirname, "../../src"), files = [];
  const visit = async (relativePath) => { for (const entry of await readdir(join(root, relativePath), { withFileTypes: true })) {
    if (entry.name === "__tests__") continue; if (entry.isSymbolicLink()) throw new Error("Compiler identity cannot follow symlinks.");
    const path = `${relativePath}/${entry.name}`; if (entry.isDirectory()) await visit(path); else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push([path, await readFile(join(root, path), "utf8")]);
  } };
  for (const domain of ["site-project", "composer", "content", "mapping", "sitemapper", "media", "shared", "../packages/component-contract/src"]) await visit(domain);
  files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `site-project-release/2:${sha(releaseJson(files))}`;
}

/** Resolve exact installed release identity. The installed package digest covers
 * component metadata and bytes; the client also checks the loaded pack identity. */
export async function resolveLocalReleaseToolchain(options = {}) {
  if (options.toolchain) return clone(options.toolchain);
  const componentPack = { packId: "@zudo-sg/ui", packVersion: "1.0.0", contractVersion: 2 };
  const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8"));
  const providerCommit = String(packageJson.dependencies["@zudo-sg/ui"]).split("#").at(-1);
  const contractText = await readFile(resolve(import.meta.dirname, "../../contract-handoff.json"), "utf8");
  const installedRoot = await realpath(dirname(dirname(require.resolve("@zudo-sg/ui/composer-pack"))));
  return { compiler: await compilerIdentity(), componentPack, providerCommit, providerTree: "1c3cbfd3a25d1425f447cdadd5ba538916394309", installedProviderDigest: await installedPackageDigest(installedRoot), contractDigest: sha(contractText) };
}
