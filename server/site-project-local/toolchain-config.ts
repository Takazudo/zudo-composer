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
import { installedContractDigest, installedPackGraphDigest, installedPackageDigest } from "./installed-identity";
import { collectPackSourceGraph } from "./pack-source-graph";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

interface PackToolchainInputs {
  /** The loaded pack. Its manifest, not a literal, names the component pack. */
  pack?: TrustedComponentPack;
  packIdentity?: ResolvedComponentPack;
  /** Host project root, whose `package.json` records how the pack was installed. */
  workspaceRoot?: string;
}

/**
 * Either a caller-supplied `toolchain` (every test fixture uses it), or the
 * inputs to derive one — which always include `stylesPath`: the absolute path
 * of the host's configured `styles` setting (`composerConfig.paths.styles`). A
 * host-self pack does not import its own Tailwind entry — the generated
 * composition modules do — so the graph digest adds it as an extra root. It has
 * no default: a guessed path would attest a stale file, or fail on a host whose
 * stylesheet lives elsewhere.
 */
export type LocalReleaseToolchainOptions =
  | (PackToolchainInputs & { toolchain: ReleaseToolchain; stylesPath?: string })
  | (PackToolchainInputs & { toolchain?: ReleaseToolchain; stylesPath: string });

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

/** Every component's public `source.module`, deduped and sorted: exactly the
 * specifiers `collectPackSourceGraph` must resolve and walk as roots, since
 * every generated composition module imports one of them. */
function sourceModulesOf(manifest: TrustedComponentPack["manifest"]): string[] {
  return [...new Set(manifest.components.map((component) => component.source.module))].sort();
}

/**
 * The attested source boundary for a host-self pack: the module graph reached
 * from the pack entry plus every component `source.module`, the host's
 * configured stylesheet root, the host `package.json` projection, and the
 * resolved bare dependencies that graph reaches. A published pack keeps the
 * whole-directory digest below — its published `files` allowlist is already
 * the boundary, and it carries no host CMS state to leak into the hash.
 */
async function hostSelfPackDigest(workspaceRoot: string, pack: TrustedComponentPack, packIdentity: ResolvedComponentPack, stylesPath: string): Promise<string> {
  // The dev server and site build refuse to start without it (host-styles
  // plugin), so a release never attests a host that could not be built.
  if (!existsSync(stylesPath)) {
    throw new Error(`The host's configured \`styles\` stylesheet does not exist at ${stylesPath}. It is the host's base stylesheet — the only importer of the component pack's CSS. Create it, or set \`styles\` in zudo-composer.config.ts.`);
  }
  const graph = await collectPackSourceGraph({
    hostRoot: workspaceRoot,
    entryPath: packIdentity.entryPath,
    sourceModules: sourceModulesOf(pack.manifest),
    extraRoots: [stylesPath],
  });
  return installedPackGraphDigest(workspaceRoot, graph);
}

/**
 * Resolve exact installed release identity. The installed pack digest covers
 * component metadata and bytes; the client also checks the loaded pack identity.
 */
export async function resolveLocalReleaseToolchain(options: LocalReleaseToolchainOptions): Promise<ReleaseToolchain> {
  if (options.toolchain) return JSON.parse(JSON.stringify(options.toolchain)) as ReleaseToolchain;
  const { pack, packIdentity } = options;
  if (!pack || !packIdentity) throw new Error("Release toolchain requires the resolved component pack; zudo-composer never falls back to a bundled provider pack.");
  if (!options.stylesPath) throw new Error("Release toolchain requires the host's configured `styles` path (`composerConfig.paths.styles`); it is never guessed.");
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const { packId, packVersion, contractVersion } = pack.manifest;
  const isHostSelfPack = packIdentity.packageRoot === workspaceRoot;
  return {
    compiler: await compilerIdentity(),
    componentPack: { packId, packVersion, contractVersion },
    packSpecifier: packIdentity.specifier,
    packSource: await packSourceSpec(workspaceRoot, packIdentity.packageName, packIdentity.specifier),
    // A host-self pack is attested by its resolved source graph, scoped to
    // exactly the files and dependencies it reaches — never the whole host
    // root, which would also cover unrelated CMS/build state. Everything else
    // (a themeset installed as a normal package) keeps hashing its installed
    // directory; realpath first, because a package manager reaches an
    // installed package through a symlink and the digest refuses to hash one.
    installedPackDigest: isHostSelfPack
      ? await hostSelfPackDigest(workspaceRoot, pack, packIdentity, resolve(workspaceRoot, options.stylesPath))
      : await installedPackageDigest(await realpath(packIdentity.packageRoot)),
    contractDigest: await installedContractDigest(await realpath(contractPackageRoot(import.meta.dirname))),
  };
}
