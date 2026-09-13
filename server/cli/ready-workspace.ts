import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComponentPack } from "../../plugins/component-pack.d.mts";
import { resolveWorkspaceRegistryRoot } from "../../plugins/workspace-domain-provider.mjs";
import { createWorkspaceRegistryService } from "../../src/app/workspace-filesystem/dev-server-entry";
import { createFilesystemWorkspaceRegistry } from "../../src/app/workspace-filesystem/registry";
import { createComponentCatalog } from "../../src/composer/model/types";
import { planLinkedJsxModules } from "../../src/composer/source/plan-linked-jsx";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { createFilesystemContentStore } from "../../src/content/storage/filesystem";
import { createFilesystemMappingStore } from "../../src/mapping/storage/filesystem";
import { createFilesystemSitemapStore } from "../../src/sitemapper/storage/filesystem";
import type { RecordMutationTokenSource } from "../../src/shared/node-fs";
import { workspaceDomainRoots } from "../../src/shared/workspace-scope";
import { releaseJson } from "../../src/site-project/api/review";
import type { ReleaseToolchain, SiteProjectActiveSelection } from "../../src/site-project/api/types";
import type { SiteProject } from "../../src/site-project/model";
import type { ResolvedComposerConfig } from "../config/config";
import { readActivatedSiteRelease } from "../site-project-local/dev-reader";
import { seedSiteProject } from "../site-project-local/seed";

export const READY_WORKSPACE_ID = "initial";
const FORMAT = "zudo-composer-ready-workspace/1";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export interface ReadyWorkspaceOptions {
  config: ResolvedComposerConfig;
  pack: TrustedComponentPack;
  packIdentity?: ResolvedComponentPack;
  /** Same release-service seam used by bounded core tests. */
  toolchain?: ReleaseToolchain;
  /** Fresh output tree, with the host's configured relative layout; assets still come from the host. */
  outputRoot?: string;
}

export interface ReadyWorkspaceInventory {
  /** Every generated directory, including empty domains, relative to the output root. */
  directories: string[];
  /** Exact generated file inventory, relative to the output root, in path order. */
  files: { path: string; digest: string }[];
}

export interface ReadyWorkspaceResult extends SiteProjectActiveSelection, ReadyWorkspaceInventory {
  workspaceId: string;
  status: "created" | "unchanged";
}

function childPath(root: string, path: string): string {
  const part = relative(root, path);
  if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error(`Ready workspace output must be inside its root: ${path}`);
  return part;
}

async function stat(path: string) {
  try { return await lstat(path); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
}

/** Inspect without following a symlink, including each ancestor below the chosen root. */
async function checkParents(root: string, path: string): Promise<void> {
  const part = childPath(root, path);
  let current = root;
  for (const segment of part.split(sep).slice(0, -1)) {
    current = join(current, segment);
    const info = await stat(current);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Ready workspace output parent is not a real directory: ${current}`);
  }
}

async function inventory(root: string, destinations: readonly string[]): Promise<ReadyWorkspaceInventory> {
  const result: ReadyWorkspaceInventory = { directories: [], files: [] };
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path);
    const name = childPath(root, path).split(sep).join("/");
    if (info.isSymbolicLink()) throw new Error(`Ready workspace output contains a symlink: ${path}`);
    if (info.isDirectory()) {
      result.directories.push(name);
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
    } else {
      if (!info.isFile()) throw new Error(`Ready workspace output contains a non-regular file: ${path}`);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.ino !== info.ino || current.dev !== info.dev) throw new Error(`Ready workspace output changed during inspection: ${path}`);
        result.files.push({ path: name, digest: sha(await handle.readFile()) });
      } finally { await handle.close(); }
    }
  };
  for (const destination of destinations) {
    await checkParents(root, join(root, destination));
    await visit(join(root, destination));
  }
  result.directories.sort();
  result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return result;
}

/** Reserve directories and copy writer-produced bytes, publishing pointers last. */
async function publishDirectory(source: string, target: string): Promise<void> {
  await mkdir(target);
  const names = (await readdir(source)).sort((a, b) => Number(a === "current.json") - Number(b === "current.json") || (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const from = join(source, name), to = join(target, name);
    const info = await lstat(from);
    if (info.isDirectory()) await publishDirectory(from, to);
    else {
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Generated workspace contains a non-regular file: ${from}`);
      await copyFile(from, to, constants.COPYFILE_EXCL);
      const handle = await open(to, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
    }
  }
  await syncDirectory(target);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Reuse the real seed release service, authoring stores and registry completion.
 * Only a disposable tree gets deterministic tokens. The ready record is copied
 * last, so a failed publication cannot select partly copied domain records.
 * Existing bytes are compared, never overwritten or silently repaired.
 *
 * `outputRoot` plus the returned inventory is the regeneration interface: a
 * caller can generate new source in a fresh tree before reviewing/replacing its
 * previously generated files. This function does not replace authored state.
 */
export async function produceReadyWorkspace(input: unknown, options: ReadyWorkspaceOptions): Promise<ReadyWorkspaceResult> {
  const { config, pack } = options;
  const domainRoots = workspaceDomainRoots(config.paths, READY_WORKSPACE_ID);
  const destinations = [...Object.values(domainRoots), resolveWorkspaceRegistryRoot(config.paths.data)]
    .map((path) => childPath(config.workspaceRoot, path));
  const assets = childPath(config.workspaceRoot, config.paths.assets);
  const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
  for (const [index, destination] of destinations.entries()) {
    if (overlaps(destination, assets)) throw new Error("Ready workspace output directories must not overlap the global Assets store.");
    for (const other of destinations.slice(index + 1)) {
      if (overlaps(destination, other)) throw new Error("Ready workspace output directories must not overlap; check the host's domain settings.");
    }
  }

  const temporary = await realpath(await mkdtemp(join(tmpdir(), "zudo-ready-workspace-")));
  try {
    const releaseOptions = {
      workspaceRoot: config.workspaceRoot, testRoot: join(temporary, "release"),
      assetsStoreRoot: config.paths.assets, pack, packIdentity: options.packIdentity, toolchain: options.toolchain,
    };
    // This is the same publish/plan/apply/build/activate mechanism as plain
    // seed, isolated from the host's disposable active-release directory.
    const { projectId, revision, buildId } = await seedSiteProject(input, releaseOptions);
    const activated = await readActivatedSiteRelease({ ...releaseOptions, componentPack: pack.manifest });
    if (!activated) throw new Error("Ready workspace seed did not produce a verified active release.");
    const project = activated.project;
    const identity = { projectId, revision, buildId };
    const tokenSource = (domain: string): RecordMutationTokenSource => (next) => sha(releaseJson({ format: FORMAT, identity, domain, ...next }));
    const stagedRoot = join(temporary, "workspace");
    const stagedUnscoped = {
      compositions: join(stagedRoot, childPath(config.workspaceRoot, config.paths.compositions)),
      content: join(stagedRoot, childPath(config.workspaceRoot, config.paths.content)),
      mappings: join(stagedRoot, childPath(config.workspaceRoot, config.paths.mappings)),
      sitemaps: join(stagedRoot, childPath(config.workspaceRoot, config.paths.sitemaps)),
    };
    const stagedDomains = workspaceDomainRoots(stagedUnscoped, READY_WORKSPACE_ID);
    const registryRoot = join(stagedRoot, destinations[4]!);
    const registry = await createFilesystemWorkspaceRegistry({ registryRoot, newMutationToken: tokenSource("workspace") });
    const created = await registry.create(project, revision, READY_WORKSPACE_ID, true);
    const catalog = createComponentCatalog(pack.manifest);
    const compositions = await createFilesystemCompositionStore({
      compositionsRoot: stagedDomains.compositions,
      provideJsx: (record, request) => {
        const planned = planLinkedJsxModules({
          manifest: catalog, records: request.records,
          sourceOutcomes: new Map(request.sourceOutcomes.map(({ id, outcome }) => [id, outcome])),
          moduleSpecifier: (id) => `./composition-${id}`,
        }).byRecordId.get(record.id);
        if (planned?.status !== "generated") throw new Error(`Ready workspace Composition ${record.id} has blocked generated JSX: ${releaseJson(planned)}`);
        return planned.code;
      },
    });
    const records = requireProvider(project, "compositions", "files").records;
    const template = (record: typeof records[number]) => Number(record.document.publication?.kind === "global-template");
    for (const record of [...records].sort((a, b) => template(b) - template(a))) {
      const result = await compositions.put(record);
      if (result.derived.status === "blocked") throw new Error(`Ready workspace Composition ${record.id} was not fully persisted: ${releaseJson(result)}`);
    }
    // Git cannot retain an empty directory. The Composer reader ignores this
    // marker; the other three domains retain their canonical metadata records.
    if (records.length === 0) await writeFile(join(stagedDomains.compositions, ".gitkeep"), "", { flag: "wx" });
    const content = await createFilesystemContentStore({ contentRoot: stagedDomains.content, newMutationToken: tokenSource("content") });
    const contentSource = requireProvider(project, "content", "content-filesystem");
    await content.seed({ models: contentSource.models, entries: contentSource.entries });
    const mappings = await createFilesystemMappingStore({ mappingsRoot: stagedDomains.mappings, newMutationToken: tokenSource("mappings") });
    await mappings.seed({ mappings: requireProvider(project, "mappings", "mapping-filesystem").records });
    const sitemaps = await createFilesystemSitemapStore({ sitemapsRoot: stagedDomains.sitemaps, newMutationToken: tokenSource("sitemaps") });
    await sitemaps.seed(requireProvider(project, "sitemaps", "sitemap-filesystem").records);
    const ready = await registry.complete(READY_WORKSPACE_ID, true);
    if (ready.status !== "ready" || ready.mutationToken !== created.mutationToken + 1
      || "seed" in ready || "requiresBeforeComplete" in ready || "seedCleanupPending" in ready
      || await registry.selection() !== READY_WORKSPACE_ID) throw new Error("Ready workspace registry completion invariants failed.");
    const reader = await createWorkspaceRegistryService({ registryRoot, domainRoots: stagedUnscoped });
    if ((await reader.missingDirectories(READY_WORKSPACE_ID)).length) throw new Error("Ready workspace is missing a domain directory.");
    // Reopen each transactional reader: their digest checks cover every current
    // generation document, including the completed record and selection.
    await reader.open();
    await content.readAll();
    await mappings.readAll();
    await sitemaps.readAll();
    const expected = await inventory(stagedRoot, destinations);
    const output = resolve(options.outputRoot ?? config.workspaceRoot);
    await mkdir(output, { recursive: true });
    const outputRoot = await realpath(output);
    for (const destination of destinations) await checkParents(outputRoot, join(outputRoot, destination));
    const present = await Promise.all(destinations.map((destination) => stat(join(outputRoot, destination))));
    if (present.some(Boolean)) {
      if (!present.every(Boolean) || releaseJson(await inventory(outputRoot, destinations)) !== releaseJson(expected)) {
        throw new Error("Ready workspace destination differs from generated state. Existing files were preserved. Generate with --output <fresh-directory> and review its inventory before replacing previously generated files; preserve authored changes separately.");
      }
      return { ...identity, workspaceId: READY_WORKSPACE_ID, status: "unchanged", ...expected };
    }
    for (const destination of destinations) {
      const path = join(outputRoot, destination);
      await checkParents(outputRoot, path);
      await mkdir(dirname(path), { recursive: true });
      // Reserve each absent destination without a replace-capable rename. A
      // competing writer or interrupted prior run fails closed. Registry last.
      await publishDirectory(join(stagedRoot, destination), path);
      // Retain every newly created ancestor name before the later registry
      // pointer claims this domain exists, including custom nested layouts.
      for (let parent = dirname(path); ; parent = dirname(parent)) {
        await syncDirectory(parent);
        if (parent === outputRoot) break;
      }
    }
    if (releaseJson(await inventory(outputRoot, destinations)) !== releaseJson(expected)) throw new Error("Ready workspace output changed during publication; inspect the generated destinations before retrying.");
    return { ...identity, workspaceId: READY_WORKSPACE_ID, status: "created", ...expected };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function requireProvider<K extends keyof SiteProject["providers"]>(project: SiteProject, domain: K, id: string): SiteProject["providers"][K][number] {
  const providers = project.providers[domain];
  if (providers.length !== 1 || providers[0]!.id !== id) throw new Error(`Ready workspace requires exactly the ${id} ${domain} provider, matching the dev reader.`);
  return providers[0]!;
}
