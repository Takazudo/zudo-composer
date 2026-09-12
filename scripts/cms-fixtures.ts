import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import { loadHostConfig, loadHostContext } from "../server/host-context.mjs";
import type { ResolvedComposerConfig } from "../server/config/config";
import { READY_WORKSPACE_ID, type ReadyWorkspaceInventory } from "../server/cli/ready-workspace";
import { SETTING_ENVIRONMENT_KEYS } from "../server/config/settings";
import { resolveWorkspaceRegistryRoot } from "../plugins/workspace-domain-provider.mjs";
import { workspaceDomainRoots } from "../src/shared/workspace-scope";
import { readCmsFixture } from "./cms-fixture-readers";

const exec = promisify(execFile);
export const OWNERSHIP_FILE = "scripts/cms-fixtures.json";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const slash = (path: string) => path.split(sep).join("/");
const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
const canonical = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
interface Ownership { version: 1; hosts: Record<string, string[]> }
interface Context { composerConfig: ResolvedComposerConfig; pack: TrustedComponentPack }

async function stat(path: string) {
  try { return await lstat(path); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
}

function safeRelative(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || part === ".git" || part === "node_modules")) {
    throw new Error(`Invalid generated path: ${String(path)}`);
  }
}

/** Validate every ancestor without following a link, including absent paths. */
async function safePath(root: string, path: string): Promise<void> {
  safeRelative(path);
  let current = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await stat(current);
    if (info?.isSymbolicLink() || (info && index < parts.length - 1 && !info.isDirectory())) throw new Error(`Generated path is not a real directory/file: ${current}`);
  }
}

function decodeOwnership(text: string): Ownership {
  const value = JSON.parse(text) as Ownership;
  if (!value || value.version !== 1 || !value.hosts || typeof value.hosts !== "object" || Array.isArray(value.hosts) || Object.keys(value).sort().join(",") !== "hosts,version") throw new Error("Invalid CMS fixture ownership file.");
  for (const [host, roots] of Object.entries(value.hosts)) {
    safeRelative(host);
    if (!/^(packages|fixtures)\/[^/]+$/.test(host) || !Array.isArray(roots) || roots.length !== 5) throw new Error(`Invalid CMS fixture owner: ${host}`);
    roots.forEach(safeRelative);
    if (roots.some((root, index) => roots.slice(index + 1).some((other) => overlaps(root, other)))) throw new Error(`Overlapping CMS fixture roots for ${host}.`);
  }
  return value;
}

/** Ownership bounds writes; producer output, never this file, defines bytes. */
export function fixtureRoots(config: ResolvedComposerConfig): string[] {
  const roots = [...Object.values(workspaceDomainRoots(config.paths, READY_WORKSPACE_ID)), resolveWorkspaceRegistryRoot(config.paths.data)]
    .map((path) => slash(relative(config.workspaceRoot, path))).sort();
  assertManagedRoots(config, roots);
  return roots;
}

function assertManagedRoots(config: ResolvedComposerConfig, roots: readonly string[]): void {
  const protectedPaths = [config.paths.assets, config.paths.publicAssets, config.configPath, config.paths.styles]
    .map((path) => slash(relative(config.workspaceRoot, path)))
    .concat(["site-project.ts", "site-project.json", "package.json", "components", ".zudo-site-project"]);
  for (const [index, root] of roots.entries()) {
    safeRelative(root);
    if (protectedPaths.some((path) => overlaps(root, path)) || roots.slice(index + 1).some((other) => overlaps(root, other))) {
      throw new Error(`CMS fixture roots overlap protected host material or each other: ${root}`);
    }
  }
}

/** Exact inventory, including empty directories and unexpected extra files. */
export async function inventory(root: string, roots: readonly string[]): Promise<ReadyWorkspaceInventory> {
  const result: ReadyWorkspaceInventory = { directories: [], files: [] };
  const visit = async (path: string): Promise<void> => {
    const info = await stat(join(root, path));
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`CMS fixture contains a symlink: ${join(root, path)}`);
    if (info.isDirectory()) {
      result.directories.push(path);
      for (const name of (await readdir(join(root, path))).sort()) await visit(`${path}/${name}`);
    } else {
      if (!info.isFile()) throw new Error(`CMS fixture is not a regular file: ${join(root, path)}`);
      const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (opened.ino !== info.ino || opened.dev !== info.dev || !opened.isFile()) throw new Error(`CMS fixture changed during inspection: ${path}`);
        result.files.push({ path, digest: sha(await handle.readFile()) });
      } finally { await handle.close(); }
    }
  };
  for (const path of roots) { await safePath(root, path); await visit(path); }
  result.directories.sort();
  result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return result;
}

export function inventoryDifferences(actual: ReadyWorkspaceInventory, expected: ReadyWorkspaceInventory): string[] {
  const differences: string[] = [];
  const directories = new Set(actual.directories), wantedDirectories = new Set(expected.directories);
  for (const path of expected.directories) if (!directories.has(path)) differences.push(`missing directory: ${path}`);
  for (const path of actual.directories) if (!wantedDirectories.has(path)) differences.push(`extra directory: ${path}`);
  const files = new Map(actual.files.map(({ path, digest }) => [path, digest]));
  const wantedFiles = new Map(expected.files.map(({ path, digest }) => [path, digest]));
  for (const { path, digest } of expected.files) {
    if (!files.has(path)) differences.push(`missing file: ${path}`);
    else if (files.get(path) !== digest) differences.push(`stale file: ${path}`);
  }
  for (const { path } of actual.files) if (!wantedFiles.has(path)) differences.push(`extra file: ${path}`);
  return differences.sort();
}

function assertInventory(actual: ReadyWorkspaceInventory, expected: ReadyWorkspaceInventory, label: string): void {
  const differences = inventoryDifferences(actual, expected);
  if (differences.length) throw new Error(`${label}:\n${differences.map((item) => `  ${item}`).join("\n")}\nRun corepack pnpm cms:regenerate and commit all generated hosts with their source.`);
}

export async function checkCmsFixture(options: {
  root: string; config: ResolvedComposerConfig; pack: TrustedComponentPack; expected: ReadyWorkspaceInventory;
}): Promise<void> {
  const managedRoots = fixtureRoots(options.config);
  const actual = await inventory(options.root, managedRoots);
  // Open committed bytes even when their content has drifted, so future
  // schema errors name the actual reader instead of only a digest.
  if (!inventoryDifferences(actual, options.expected).some((line) => line.startsWith("missing"))) {
    await readCmsFixture({ ...options, managedRoots });
  }
  assertInventory(actual, options.expected, `${options.root}: committed CMS differs from canonical production`);
}

/** Discover source-bearing hosts from disk; ownership prevents deleted inputs hiding a host. */
export async function discoverFixtureHosts(root: string, ownership: Ownership): Promise<string[]> {
  const hosts = new Set(Object.keys(ownership.hosts));
  for (const parent of ["packages", "fixtures"]) {
    if (!await stat(join(root, parent))) continue;
    for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const host = `${parent}/${entry.name}`;
      if (await stat(join(root, host, "site-project.ts")) || await stat(join(root, host, "site-project.json")) || await stat(join(root, host, "cms/workspaces"))) hosts.add(host);
      else if (await stat(join(root, host, "zudo-composer.config.ts"))) {
        await safePath(root, `${host}/zudo-composer.config.ts`);
        const config = await loadHostConfig(join(root, host), {}) as ResolvedComposerConfig;
        if (await stat(resolveWorkspaceRegistryRoot(config.paths.data))) hosts.add(host);
      }
    }
  }
  for (const host of hosts) {
    await safePath(root, `${host}/site-project.ts`);
    for (const name of ["site-project.ts", "zudo-composer.config.ts", "package.json"]) {
      await safePath(root, `${host}/${name}`);
      if (!(await stat(join(root, host, name)))?.isFile()) throw new Error(`CMS fixture host is missing ${host}/${name}.`);
    }
  }
  if (!hosts.size) throw new Error("No CMS fixture hosts found.");
  return [...hosts].sort();
}

/** Invoke the installed public bin, resolving it from the host's dependency. */
export async function runInstalledComposer(host: string, args: readonly string[]): Promise<string> {
  const manifestPath = createRequire(join(host, "package.json")).resolve("zudo-composer/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { bin: Record<string, string> };
  const bin = manifest.bin["zudo-composer"];
  if (typeof bin !== "string") throw new Error(`No installed zudo-composer bin in ${host}. Run corepack pnpm install --frozen-lockfile.`);
  try {
    const env = { ...process.env };
    for (const key of Object.values(SETTING_ENVIRONMENT_KEYS)) delete env[key];
    const { stdout } = await exec(process.execPath, [resolve(dirname(manifestPath), bin), ...args], {
      cwd: host, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (cause) {
    const error = cause as Error & { stderr?: string };
    throw new Error(`${host}: zudo-composer ${args[0]} failed: ${error.stderr || error.message}`, { cause });
  }
}

async function git(root: string, args: string[]): Promise<Buffer> {
  return (await exec("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 })).stdout;
}

interface Baseline { entries: Map<string, { mode: string; oid: string }>; ownership: Ownership }
async function baseline(root: string): Promise<Baseline> {
  const entries = new Map<string, { mode: string; oid: string }>();
  for (const line of (await git(root, ["ls-tree", "-r", "-z", "HEAD"])).toString().split("\0").filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line);
    if (match) entries.set(match[3]!, { mode: match[1]!, oid: match[2]! });
  }
  const metadata = entries.get(OWNERSHIP_FILE);
  return { entries, ownership: metadata ? decodeOwnership((await git(root, ["cat-file", "blob", metadata.oid])).toString()) : { version: 1, hosts: {} } };
}

async function baselineInventory(root: string, host: string, roots: readonly string[], base: Baseline): Promise<ReadyWorkspaceInventory> {
  const directories = new Set<string>();
  const files: ReadyWorkspaceInventory["files"] = [];
  for (const [path, entry] of base.entries) {
    if (!path.startsWith(`${host}/`)) continue;
    const local = path.slice(host.length + 1), managed = roots.find((item) => within(local, item));
    if (!managed) continue;
    if (!/^100(644|755)$/.test(entry.mode)) throw new Error(`Committed CMS fixture is not a regular file: ${path}`);
    files.push({ path: local, digest: sha(await git(root, ["cat-file", "blob", entry.oid])) });
    for (let parent = slash(dirname(local)); within(parent, managed); parent = slash(dirname(parent))) directories.add(parent);
  }
  return { directories: [...directories].sort(), files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}

/**
 * Generate only the aggregate in a disposable host copy. The installed seed
 * still uses the original host config/pack/Assets, with --from pointing here.
 */
async function stageSource(host: string, target: string, managedRoots: readonly string[]): Promise<string> {
  const ignored = new Set(["node_modules", ".git", ".zudo-site-project", "dist", "dist-site", ".vite", "coverage", "test-results", "playwright-report"]);
  await cp(host, target, {
    recursive: true, errorOnExist: true, force: false,
    filter: async (path) => {
      const local = slash(relative(host, path));
      if (!local) return true;
      if (ignored.has(local.split("/")[0]!) || managedRoots.some((root) => within(local, root))) return false;
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Source staging refuses a host symlink: ${path}`);
      return true;
    },
  });
  await symlink(join(host, "node_modules"), join(target, "node_modules"), "dir");
  await runInstalledComposer(host, ["generate", "--root", target]);
  return join(target, "site-project.json");
}

interface PreparedHost {
  host: string;
  context: Context;
  roots: string[];
  oldRoots: string[];
  output: string;
  source: string;
  expected: ReadyWorkspaceInventory;
  before: ReadyWorkspaceInventory;
  sourceBefore?: Buffer;
}

/** Refuse local authoring, untracked extras, and unknown destinations before replacing anything. */
async function assertReplaceable(root: string, item: PreparedHost, base: Baseline): Promise<void> {
  const allRoots = [...new Set([...item.oldRoots, ...item.roots])].sort();
  const current = await inventory(join(root, item.host), allRoots);
  if (inventoryDifferences(current, item.expected).length) {
    const committed = await baselineInventory(root, item.host, item.oldRoots, base);
    const differences = inventoryDifferences(current, committed);
    if (differences.length) throw new Error(`${item.host}: refusing to replace authored or untracked CMS. Preserve those changes separately.\n${differences.map((line) => `  ${line}`).join("\n")}`);
  }
  const next = await readFile(item.source);
  if (item.sourceBefore && !item.sourceBefore.equals(next)) {
    const tracked = base.entries.get(`${item.host}/site-project.json`);
    if (!tracked || !/^100(644|755)$/.test(tracked.mode) || !item.sourceBefore.equals(await git(root, ["cat-file", "blob", tracked.oid]))) {
      throw new Error(`${item.host}: refusing to replace edited site-project.json; preserve it separately and author site-project.ts.`);
    }
  }
}

/** Reserve each directory and publish transactional pointers after their records. */
async function publishDirectory(source: string, target: string): Promise<void> {
  await mkdir(target);
  const names = (await readdir(source)).sort((a, b) => Number(a === "current.json") - Number(b === "current.json") || (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const from = join(source, name), to = join(target, name);
    const info = await lstat(from);
    if (info.isDirectory()) await publishDirectory(from, to);
    else {
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Generated source is not a regular file: ${from}`);
      await copyFile(from, to, constants.COPYFILE_EXCL);
    }
  }
}

async function publishFile(source: string, target: string): Promise<void> {
  const temporary = await mkdtemp(join(dirname(target), ".cms-fixture-publish-"));
  try {
    const staged = join(temporary, "file");
    await copyFile(source, staged, constants.COPYFILE_EXCL);
    await rename(staged, target);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** Check or regenerate all discovered hosts. No host-private imports or hand-written records. */
export async function runCmsFixtures(options: { root?: string; check: boolean; report?: (message: string) => void }): Promise<void> {
  const root = await realpath(options.root ?? repositoryRoot);
  const report = options.report ?? console.log;
  await safePath(root, OWNERSHIP_FILE);
  const ownershipBefore = await readFile(join(root, OWNERSHIP_FILE), "utf8");
  const ownership = decodeOwnership(ownershipBefore);
  const hosts = await discoverFixtureHosts(root, ownership);
  const base = options.check ? undefined : await baseline(root);
  const temporary = await mkdtemp(join(tmpdir(), "cms-fixtures-"));
  const prepared: PreparedHost[] = [];
  const nextOwnership: Ownership = { version: 1, hosts: {} };
  try {
    for (const [index, host] of hosts.entries()) {
      report(`${options.check ? "Checking" : "Preparing"} CMS fixtures: ${host}`);
      const hostRoot = join(root, host);
      const context = await loadHostContext({ workspaceRoot: hostRoot, env: {} }) as Context;
      const roots = fixtureRoots(context.composerConfig);
      const oldRoots = (base?.ownership ?? ownership).hosts[host] ?? [];
      assertManagedRoots(context.composerConfig, oldRoots);
      const allRoots = [...new Set([...oldRoots, ...roots])].sort();
      // Reject nested old/new destinations: a path move must not take over a
      // parent containing other source or another generated domain.
      assertManagedRoots(context.composerConfig, allRoots);
      const before = await inventory(hostRoot, allRoots);
      await safePath(hostRoot, "site-project.json");
      const sourceBefore = await stat(join(hostRoot, "site-project.json")) ? await readFile(join(hostRoot, "site-project.json")) : undefined;
      let source = join(hostRoot, "site-project.json");
      if (options.check) await runInstalledComposer(hostRoot, ["generate", "--check", "--root", hostRoot]);
      else source = await stageSource(hostRoot, join(temporary, `source-${index}`), allRoots);
      const output = join(temporary, `output-${index}`);
      const response = JSON.parse(await runInstalledComposer(hostRoot, ["seed", "--ready-workspace", "--root", hostRoot, "--from", source, "--output", output])) as ReadyWorkspaceInventory;
      const expected = await inventory(output, roots);
      // Validate the producer's declared inventory against its real output.
      assertInventory(expected, response, `${host}: producer inventory differs from output`);
      await readCmsFixture({ root: output, config: context.composerConfig, pack: context.pack, managedRoots: roots });
      nextOwnership.hosts[host] = roots;
      const item = { host, context, roots, oldRoots, output, source, expected, before, sourceBefore };
      if (options.check) {
        if (canonical(ownership.hosts[host]) !== canonical(roots)) throw new Error(`${host}: generated directory ownership is stale. Run corepack pnpm cms:regenerate.`);
        await checkCmsFixture({ root: hostRoot, config: context.composerConfig, pack: context.pack, expected });
      } else await assertReplaceable(root, item, base!);
      prepared.push(item);
    }
    if (options.check) {
      if (ownershipBefore !== canonical(nextOwnership)) throw new Error("CMS fixture ownership is stale. Run corepack pnpm cms:regenerate.");
      report(`CMS fixtures passed: ${hosts.length} hosts; current readers and exact canonical inventories.`);
      return;
    }
    const nextMetadata = canonical(nextOwnership);
    const trackedMetadata = base!.entries.get(OWNERSHIP_FILE);
    if (ownershipBefore !== nextMetadata && (!trackedMetadata || ownershipBefore !== (await git(root, ["cat-file", "blob", trackedMetadata.oid])).toString())) {
      throw new Error("Refusing to replace edited CMS fixture ownership metadata.");
    }
    // Recheck after all hosts have been prepared, before the first mutation.
    for (const item of prepared) {
      const hostRoot = join(root, item.host);
      assertInventory(await inventory(hostRoot, [...new Set([...item.oldRoots, ...item.roots])].sort()), item.before, `${item.host}: files changed during generation`);
      const current = await stat(join(hostRoot, "site-project.json")) ? await readFile(join(hostRoot, "site-project.json")) : undefined;
      if (current === undefined ? item.sourceBefore !== undefined : !item.sourceBefore || !current.equals(item.sourceBefore)) throw new Error(`${item.host}: site-project.json changed during generation.`);
    }
    for (const item of prepared) {
      const hostRoot = join(root, item.host);
      assertInventory(await inventory(hostRoot, [...new Set([...item.oldRoots, ...item.roots])].sort()), item.before, `${item.host}: files changed before replacement`);
      if (inventoryDifferences(item.before, item.expected).length) {
        for (const path of item.oldRoots) {
          await safePath(hostRoot, path);
          await rm(join(hostRoot, path), { recursive: true, force: true });
        }
        // A just-created host may already have exactly the desired output;
        // otherwise every new path was proved absent by assertReplaceable.
        const registry = slash(relative(hostRoot, resolveWorkspaceRegistryRoot(item.context.composerConfig.paths.data)));
        const publicationOrder = [...item.roots.filter((path) => path !== registry), registry];
        for (const path of publicationOrder) {
          await safePath(hostRoot, path);
          await mkdir(dirname(join(hostRoot, path)), { recursive: true });
          await publishDirectory(join(item.output, path), join(hostRoot, path));
        }
      }
      const bytes = await readFile(item.source);
      if (!item.sourceBefore?.equals(bytes)) {
        await safePath(hostRoot, "site-project.json");
        if (item.sourceBefore) await publishFile(item.source, join(hostRoot, "site-project.json"));
        else await copyFile(item.source, join(hostRoot, "site-project.json"), constants.COPYFILE_EXCL);
      }
      assertInventory(await inventory(hostRoot, item.roots), item.expected, `${item.host}: regenerated inventory differs`);
      report(`Regenerated CMS fixtures: ${item.host} (${item.expected.files.length} files)`);
    }
    if (ownershipBefore !== nextMetadata) {
      const metadata = join(temporary, "ownership.json");
      await writeFile(metadata, nextMetadata);
      await publishFile(metadata, join(root, OWNERSHIP_FILE));
    }
    report(`CMS fixtures regenerated: ${hosts.length} hosts. Commit generated JSON/CMS and ownership with their authored source.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--regenerate"].includes(args[0]!)) {
    console.error("Usage: tsx scripts/cms-fixtures.ts --check|--regenerate");
    process.exitCode = 1;
  } else runCmsFixtures({ check: args[0] === "--check" }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
