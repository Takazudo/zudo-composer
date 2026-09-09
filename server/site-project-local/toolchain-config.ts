// The identity a release is stamped with.
//
// It answers one question: *exactly which code compiled this release?* Three
// things can change the answer — this package's own compiler sources, the
// component pack the host configured, and the contract both sides speak — so
// each is attested separately and none is taken from a hardcoded literal.
//
// The pack half deliberately carries no Git identity. A pack is a package now:
// it may come from a registry, a Git spec, a tarball or the host's own
// `exports`, and only the first of those has a commit at all. What every shape
// does have is a resolvable location and bytes, which is what is hashed.

import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComponentPack } from "../../plugins/component-pack.d.mts";
import type { ReleaseToolchain } from "../../src/site-project/api/types";
import { releaseJson } from "../../src/site-project/api/review";
import { installedPackageDigest } from "./installed-identity";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export interface LocalReleaseToolchainOptions {
  /** A caller-supplied toolchain wins outright; every test fixture uses it. */
  toolchain?: ReleaseToolchain;
  /** The loaded pack. Its manifest, not a literal, names the component pack. */
  pack?: TrustedComponentPack;
  packIdentity?: ResolvedComponentPack;
  /** Host project root, whose `package.json` records how the pack was installed. */
  workspaceRoot?: string;
}

/**
 * Sources that decide a release's compiler identity. Tests are excluded — both
 * `__tests__` directories and colocated `*.test.ts` — because they are stripped
 * from the published package's `files` allowlist; including them would give an
 * installed zudo-composer a different identity from the repository it came from.
 *
 * The contract is NOT in this list: it is attested by `contractDigest`, and an
 * installed zudo-composer does not ship the contract's sources at all.
 */
async function compilerIdentity(): Promise<string> {
  const root = resolve(import.meta.dirname, "../../src");
  const files: [string, string][] = [];
  const visit = async (relativePath: string): Promise<void> => {
    for (const entry of await readdir(join(root, relativePath), { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      if (entry.isSymbolicLink()) throw new Error("Compiler identity cannot follow symlinks.");
      const path = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push([path, await readFile(join(root, path), "utf8")]);
    }
  };
  for (const domain of ["site-project", "composer", "content", "mapping", "sitemapper", "assets", "shared"]) await visit(domain);
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `site-project-release/2:${sha(releaseJson(files))}`;
}

/**
 * The contract package's directory, found by walking the `node_modules` chain
 * rather than through `require.resolve`: the contract is ESM-only, so its
 * `exports` map has no `require` condition and no `./package.json` subpath.
 */
function contractPackageRoot(from: string): string {
  const name = "@zudo-composer/component-contract";
  for (let directory = resolve(from); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(directory) === directory) throw new Error(`Could not locate ${name} above ${from}.`);
  }
}

/** How the host declared the pack's package: its dependency spec, or `"self"`. */
async function packSourceSpec(workspaceRoot: string, packageName: string, specifier: string): Promise<string> {
  const manifestPath = join(workspaceRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, Record<string, string> | string>;
  if (manifest.name === packageName) return "self";
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const spec = (manifest[field] as Record<string, string> | undefined)?.[packageName];
    if (typeof spec === "string" && spec.length > 0) return spec;
  }
  throw new Error(
    `Component pack "${specifier}" resolves to package "${packageName}", which ${manifestPath} does not declare. A release attests how its pack was installed, so the host must depend on it explicitly or expose it through its own "name" + "exports".`,
  );
}

/**
 * Resolve exact installed release identity. The installed pack digest covers
 * component metadata and bytes; the client also checks the loaded pack identity.
 */
export async function resolveLocalReleaseToolchain(options: LocalReleaseToolchainOptions = {}): Promise<ReleaseToolchain> {
  if (options.toolchain) return JSON.parse(JSON.stringify(options.toolchain)) as ReleaseToolchain;
  const { pack, packIdentity } = options;
  if (!pack || !packIdentity) throw new Error("Release toolchain requires the resolved component pack; zudo-composer never falls back to a bundled provider pack.");
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const { packId, packVersion, contractVersion } = pack.manifest;
  const packRoot = packIdentity.packageRoot === workspaceRoot ? dirname(packIdentity.entryPath) : packIdentity.packageRoot;
  return {
    compiler: await compilerIdentity(),
    componentPack: { packId, packVersion, contractVersion },
    packSpecifier: packIdentity.specifier,
    packSource: await packSourceSpec(workspaceRoot, packIdentity.packageName, packIdentity.specifier),
    // Realpath first: a package manager reaches an installed package through a
    // symlink, and the digest refuses to hash a link.
    installedPackDigest: await installedPackageDigest(await realpath(packRoot)),
    contractDigest: await installedPackageDigest(await realpath(contractPackageRoot(import.meta.dirname))),
  };
}
