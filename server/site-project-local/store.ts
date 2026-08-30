import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access, lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, stat, unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  SiteProjectActiveSelection, SiteProjectAdapterMutationResult, SiteProjectAdapterReadResult,
  SiteProjectBuildAdapter, SiteProjectListEntry, SiteProjectStoreAdapter, StoredSiteProject,
} from "../../src/site-project/api/types";
import { canonicalStringifyJson, serializeSiteProject } from "../../src/site-project/model/canonical";
import type { SiteBuildPlan } from "../../src/site-project/compiler/types";
import type { SiteProject } from "../../src/site-project/model/types";
import { isSafeRecordId } from "../../src/shared/record-identity";

export const SITE_PROJECT_LOCAL_ROOT_NAME = ".zudo-site-project";
/** Optional disposable-root override used by isolated dev/browser acceptance runs. */
export const SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT";
export const SITE_PROJECT_ACTIVE_FILENAME = "active.json";
const PROJECTS = "projects";
const BUILDS = "builds";
const ACTIVE_BUILD = "active-build.json";
const LOCK = ".transaction-lock";
const JOURNAL = ".transaction.json";
const TEMP_PREFIX = ".site-project-tmp-";
const TRASH_PREFIX = ".site-project-trash-";
const OWNED_ORPHAN = /^\.site-project-(?:tmp|trash)-[0-9]+-[a-f0-9]{24}$/;
const REVISION = /^[a-f0-9]{64}$/;
const PROJECT_SUFFIX = ".site-project.json";

export const DEFAULT_SITE_PROJECT_LOCAL_ROOT = resolve(import.meta.dirname, "../..", SITE_PROJECT_LOCAL_ROOT_NAME);

function configuredLocalRoot(): string {
  const configured = process.env[SITE_PROJECT_LOCAL_ROOT_ENV]?.trim();
  return configured ? resolve(configured) : DEFAULT_SITE_PROJECT_LOCAL_ROOT;
}

export interface LocalSiteProjectStoreOptions {
  /** Internal test seam. Normal callers use the fixed repository-local root; isolated dev runs may use the env override. */
  testRoot?: string;
  lockTimeoutMs?: number;
  fault?: (point: string) => void | Promise<void>;
}

type ActiveFile = SiteProjectActiveSelection | null;
interface Journal {
  version: 1;
  projectId: string;
  projectText: string | null;
  active: ActiveFile;
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sameActive(left: ActiveFile, right: ActiveFile): boolean {
  return left === null || right === null
    ? left === right
    : left.projectId === right.projectId && left.revision === right.revision;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function isActive(value: unknown): value is SiteProjectActiveSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "projectId,revision"
    && isSafeRecordId(record.projectId)
    && typeof record.revision === "string" && REVISION.test(record.revision);
}

function unavailable(message: string): { status: "unavailable"; message: string } {
  return { status: "unavailable", message };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export class LocalSiteProjectStore implements SiteProjectStoreAdapter, SiteProjectBuildAdapter {
  readonly root: string;
  private readonly lockTimeoutMs: number;
  private readonly fault?: (point: string) => void | Promise<void>;

  constructor(options: LocalSiteProjectStoreOptions = {}) {
    this.root = resolve(options.testRoot ?? configuredLocalRoot());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
    this.fault = options.fault;
  }

  private async hit(point: string): Promise<void> { await this.fault?.(point); }

  private async ensureRoot(): Promise<string> {
    const parent = dirname(this.root);
    const parentReal = await realpath(parent);
    if (await exists(this.root)) {
      const info = await lstat(this.root);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Local SiteProject root is not a real directory.");
    } else {
      try { await mkdir(this.root, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await syncDirectory(parentReal);
    }
    const rootReal = await realpath(this.root);
    if (!isInside(parentReal, rootReal) || rootReal !== this.root) throw new Error("Local SiteProject root escaped its fixed location.");
    for (const directory of [PROJECTS, BUILDS]) {
      const target = join(this.root, directory);
      if (await exists(target)) {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe ${directory} directory.`);
      } else {
        try { await mkdir(target, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        await syncDirectory(this.root);
      }
      if (!isInside(rootReal, await realpath(target))) throw new Error(`Unsafe ${directory} path.`);
    }
    return rootReal;
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await this.ensureRoot();
    const lockPath = join(this.root, LOCK);
    const deadline = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        const nonce = randomBytes(12).toString("hex");
        const ownerText = `${JSON.stringify({ pid: process.pid, nonce })}\n`;
        const ownerPath = join(lockPath, "owner.json");
        const owner = await open(ownerPath, "wx", 0o600);
        try {
          await owner.writeFile(ownerText, "utf8");
          await owner.sync();
        } finally { await owner.close(); }
        await syncDirectory(lockPath);
        await syncDirectory(this.root);
        return async () => {
          const info = await lstat(lockPath);
          const ownerInfo = await lstat(ownerPath);
          if (info.isSymbolicLink() || !info.isDirectory() || ownerInfo.isSymbolicLink() || !ownerInfo.isFile()
            || await readFile(ownerPath, "utf8") !== ownerText) {
            throw new Error("Transaction lock ownership changed before release.");
          }
          await unlink(ownerPath);
          await rmdir(lockPath);
          await syncDirectory(this.root);
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.removeStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the SiteProject transaction lock.", { cause: error });
        await new Promise((resolveWait) => setTimeout(resolveWait, 15));
      }
    }
  }

  private async removeStaleLock(lockPath: string): Promise<boolean> {
    let lockInfo;
    try { lockInfo = await lstat(lockPath); } catch { return false; }
    if (lockInfo.isSymbolicLink() || !lockInfo.isDirectory()) throw new Error("Transaction lock is not a real directory.");
    let entries: string[];
    try { entries = await readdir(lockPath); } catch { return false; }
    if (entries.some((entry) => entry !== "owner.json")) throw new Error("Transaction lock contains unknown files.");
    if (!entries.includes("owner.json")) {
      const age = Date.now() - (await stat(lockPath)).mtimeMs;
      if (age < 2_000) return false;
    } else {
      try {
        const ownerPath = join(lockPath, "owner.json");
        const ownerInfo = await lstat(ownerPath);
        if (ownerInfo.isSymbolicLink() || !ownerInfo.isFile()) throw new Error("Transaction lock owner is unsafe.");
        const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
          || Object.keys(parsed).sort().join(",") !== "nonce,pid"
          || !Number.isSafeInteger((parsed as { pid?: unknown }).pid)
          || (parsed as { pid: number }).pid <= 0
          || typeof (parsed as { nonce?: unknown }).nonce !== "string"
          || !/^[a-f0-9]{24}$/.test((parsed as { nonce: string }).nonce)) {
          throw new Error("Transaction lock owner is invalid.");
        }
        const pid = (parsed as { pid: number }).pid;
        try { process.kill(pid, 0); return false; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
        }
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error("Transaction lock owner is invalid.", { cause: error });
        throw error;
      }
    }
    const ownerPath = join(lockPath, "owner.json");
    if (await exists(ownerPath)) await unlink(ownerPath);
    await rmdir(lockPath);
    await syncDirectory(this.root);
    return true;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.acquireLock();
      await this.cleanupOwnedTemps();
      await this.recover();
      await this.verifyKnownLayout();
      return await operation();
    } finally {
      await release?.();
    }
  }

  private async cleanupOwnedTemps(): Promise<void> {
    const clean = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(TEMP_PREFIX) || entry.name.startsWith(TRASH_PREFIX)) {
          if (!OWNED_ORPHAN.test(entry.name) || entry.isSymbolicLink() || !entry.isFile()) {
            throw new Error(`Unsafe recognizable orphan: ${entry.name}`);
          }
          await unlink(join(directory, entry.name));
        }
      }
      await syncDirectory(directory);
    };
    await clean(this.root);
    await clean(join(this.root, PROJECTS));
    for (const project of await readdir(join(this.root, BUILDS), { withFileTypes: true })) {
      if (!project.isDirectory() || project.isSymbolicLink() || !isSafeRecordId(project.name)) continue;
      const projectPath = join(this.root, BUILDS, project.name);
      await clean(projectPath);
      for (const revision of await readdir(projectPath, { withFileTypes: true })) {
        if (revision.isDirectory() && !revision.isSymbolicLink() && REVISION.test(revision.name)) await clean(join(projectPath, revision.name));
      }
    }
  }

  private async verifyKnownLayout(): Promise<void> {
    const rootAllowed = new Set([PROJECTS, BUILDS, LOCK, JOURNAL, SITE_PROJECT_ACTIVE_FILENAME, ACTIVE_BUILD]);
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!rootAllowed.has(entry.name)) throw new Error(`Unknown file in local SiteProject root: ${entry.name}`);
      if ([SITE_PROJECT_ACTIVE_FILENAME, ACTIVE_BUILD, JOURNAL].includes(entry.name) && !entry.isFile()) throw new Error(`Unsafe local file: ${entry.name}`);
    }
    for (const entry of await readdir(join(this.root, PROJECTS), { withFileTypes: true })) {
      const projectId = entry.name.endsWith(PROJECT_SUFFIX) ? entry.name.slice(0, -PROJECT_SUFFIX.length) : "";
      if (!entry.isFile() || !isSafeRecordId(projectId) || entry.name !== `${projectId}${PROJECT_SUFFIX}`) {
        throw new Error(`Unknown project filename: ${entry.name}`);
      }
    }
    for (const entry of await readdir(join(this.root, BUILDS), { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSafeRecordId(entry.name) || entry.isSymbolicLink()) throw new Error(`Unknown build entry: ${entry.name}`);
      const projectPath = join(this.root, BUILDS, entry.name);
      for (const revision of await readdir(projectPath, { withFileTypes: true })) {
        if (!revision.isDirectory() || revision.isSymbolicLink() || !REVISION.test(revision.name)) throw new Error(`Unknown build revision: ${revision.name}`);
        for (const output of await readdir(join(projectPath, revision.name), { withFileTypes: true })) {
          if (!output.isFile() || !/^(?:build\.json|complete\.json|module-[0-9]{4}\.mjs)$/.test(output.name)) throw new Error(`Unknown build output: ${output.name}`);
        }
      }
    }
    for (const pointer of [SITE_PROJECT_ACTIVE_FILENAME, ACTIVE_BUILD]) {
      const path = join(this.root, pointer);
      if (!(await exists(path))) continue;
      const text = await readFile(path, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!isActive(parsed) || canonicalStringifyJson(parsed as unknown as import("@zudo-composer/component-contract").JsonValue) !== text) {
        throw new Error(`Invalid local pointer: ${pointer}`);
      }
      if (pointer === SITE_PROJECT_ACTIVE_FILENAME) {
        const stored = await this.readStored(parsed.projectId);
        if (!stored || stored.revision !== parsed.revision) throw new Error("Active SiteProject pointer is stale.");
      } else {
        const complete = join(this.root, BUILDS, parsed.projectId, parsed.revision, "complete.json");
        if (!(await exists(complete))) throw new Error("Active build pointer is stale.");
        await this.verifyTarget(complete, false);
      }
    }
  }

  private projectPath(projectId: string): string {
    if (!isSafeRecordId(projectId)) throw new Error("Unsafe project id.");
    return join(this.root, PROJECTS, `${projectId}${PROJECT_SUFFIX}`);
  }

  private async verifyTarget(path: string, allowMissing = true): Promise<void> {
    if (!isInside(this.root, path)) throw new Error("Target escaped the local root.");
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Target is not a regular file.");
      if (!isInside(await realpath(this.root), await realpath(path))) throw new Error("Target escaped the local root.");
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  private async atomicWrite(path: string, text: string): Promise<void> {
    const directory = dirname(path);
    await this.verifyTarget(path);
    const temp = join(directory, `${TEMP_PREFIX}${process.pid}-${randomBytes(12).toString("hex")}`);
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await this.hit("after-write");
      await handle.sync();
      await this.hit("after-file-sync");
    } finally { await handle.close(); }
    await this.hit("after-close");
    const rootReal = await realpath(this.root);
    const rootInfo = await lstat(this.root);
    const directoryInfo = await lstat(directory);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()
      || rootReal !== this.root || !isInside(rootReal, await realpath(directory))) throw new Error("Root changed during write.");
    await this.verifyTarget(path);
    await this.hit("before-rename");
    await rename(temp, path);
    await this.hit("after-rename");
    await syncDirectory(directory);
    await this.hit("after-directory-sync");
  }

  private async atomicDelete(path: string): Promise<void> {
    if (!(await exists(path))) return;
    await this.verifyTarget(path, false);
    const trash = join(dirname(path), `${TRASH_PREFIX}${process.pid}-${randomBytes(12).toString("hex")}`);
    await rename(path, trash);
    await this.hit("after-delete-rename");
    await syncDirectory(dirname(path));
    await this.hit("after-delete-directory-sync");
    await unlink(trash);
    await syncDirectory(dirname(path));
  }

  private async readActive(): Promise<ActiveFile> {
    const path = join(this.root, SITE_PROJECT_ACTIVE_FILENAME);
    if (!(await exists(path))) return null;
    await this.verifyTarget(path, false);
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isActive(parsed)) throw new Error("Active SiteProject pointer is invalid.");
    return parsed;
  }

  private async writeActive(active: ActiveFile): Promise<void> {
    const path = join(this.root, SITE_PROJECT_ACTIVE_FILENAME);
    if (active === null) await this.atomicDelete(path);
    else await this.atomicWrite(path, canonicalStringifyJson(active as unknown as import("@zudo-composer/component-contract").JsonValue));
  }

  private async writeJournal(journal: Journal): Promise<void> {
    await this.atomicWrite(join(this.root, JOURNAL), canonicalStringifyJson(journal as unknown as import("@zudo-composer/component-contract").JsonValue));
    await this.hit("journal-durable");
  }

  private parseJournal(value: unknown): Journal {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Transaction journal is invalid.");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "active,projectId,projectText,version" || record.version !== 1
      || !isSafeRecordId(record.projectId)
      || !(record.projectText === null || typeof record.projectText === "string")
      || !(record.active === null || isActive(record.active))) throw new Error("Transaction journal is invalid.");
    if (typeof record.projectText === "string") {
      const project = JSON.parse(record.projectText) as SiteProject;
      if (project.id !== record.projectId || serializeSiteProject(project) !== record.projectText) throw new Error("Transaction project is not canonical.");
      if (isActive(record.active) && record.active.projectId === record.projectId && record.active.revision !== hash(record.projectText)) {
        throw new Error("Transaction active revision does not match its project.");
      }
    } else if (isActive(record.active) && record.active.projectId === record.projectId) {
      throw new Error("Transaction cannot retain a pointer to a discarded project.");
    }
    return record as unknown as Journal;
  }

  private async applyJournal(journal: Journal): Promise<void> {
    const projectPath = this.projectPath(journal.projectId);
    if (journal.projectText === null) await this.atomicDelete(projectPath);
    else await this.atomicWrite(projectPath, journal.projectText);
    await this.hit("project-installed");
    await this.writeActive(journal.active);
    await this.hit("active-installed");
    await this.atomicDelete(join(this.root, JOURNAL));
  }

  private async recover(): Promise<void> {
    const path = join(this.root, JOURNAL);
    if (!(await exists(path))) return;
    await this.verifyTarget(path, false);
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (canonicalStringifyJson(parsed as import("@zudo-composer/component-contract").JsonValue) !== text) throw new Error("Transaction journal is not canonical.");
    const journal = this.parseJournal(parsed);
    await this.applyJournal(journal);
  }

  private async readStored(projectId: string): Promise<StoredSiteProject | undefined> {
    const path = this.projectPath(projectId);
    if (!(await exists(path))) return undefined;
    await this.verifyTarget(path, false);
    const text = await readFile(path, "utf8");
    const project = JSON.parse(text) as SiteProject;
    if (project.id !== projectId || serializeSiteProject(project) !== text) throw new Error("Stored SiteProject is not canonical.");
    return { project, revision: hash(text) };
  }

  async list(): Promise<SiteProjectAdapterReadResult<{ projects: readonly SiteProjectListEntry[]; active: ActiveFile }>> {
    try {
      return await this.withLock(async () => {
        const projects: SiteProjectListEntry[] = [];
        for (const entry of await readdir(join(this.root, PROJECTS))) {
          const projectId = entry.slice(0, -PROJECT_SUFFIX.length);
          const stored = await this.readStored(projectId);
          if (stored) projects.push({ projectId, name: stored.project.name, revisions: [stored.revision] });
        }
        return { status: "ok" as const, value: { projects, active: await this.readActive() } };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async get(input: { projectId: string; revision: string }): Promise<SiteProjectAdapterReadResult<StoredSiteProject>> {
    try {
      return await this.withLock(async () => {
        const stored = await this.readStored(input.projectId);
        return stored?.revision === input.revision ? { status: "ok" as const, value: stored } : { status: "not-found" as const };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async readActiveProject(): Promise<SiteProjectAdapterReadResult<StoredSiteProject | null>> {
    try {
      return await this.withLock(async () => {
        const active = await this.readActive();
        if (active === null) return { status: "ok" as const, value: null };
        const stored = await this.readStored(active.projectId);
        if (!stored || stored.revision !== active.revision) throw new Error("Active SiteProject pointer is stale.");
        return { status: "ok" as const, value: stored };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async apply(input: Parameters<SiteProjectStoreAdapter["apply"]>[0]): Promise<SiteProjectAdapterMutationResult<{ revision: string; active: ActiveFile }>> {
    try {
      return await this.withLock(async () => {
        const current = await this.readStored(input.project.id);
        const active = await this.readActive();
        if (!sameActive(active, input.expectedActive)
          || (input.expectedRevision === null ? current !== undefined : current?.revision !== input.expectedRevision)) return { status: "conflict" as const };
        const projectText = serializeSiteProject(input.project);
        const revision = hash(projectText);
        const nextActive = active?.projectId === input.project.id && active.revision === input.expectedRevision
          ? { projectId: input.project.id, revision } : active;
        const journal: Journal = { version: 1, projectId: input.project.id, projectText, active: nextActive };
        await this.writeJournal(journal);
        await this.applyJournal(journal);
        return { status: "ok" as const, value: { revision, active: nextActive } };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async activate(input: Parameters<SiteProjectStoreAdapter["activate"]>[0]): Promise<SiteProjectAdapterMutationResult<{ active: SiteProjectActiveSelection }>> {
    try {
      return await this.withLock(async () => {
        const stored = await this.readStored(input.target.projectId);
        if (!stored || stored.revision !== input.target.revision) return { status: "not-found" as const };
        if (!sameActive(await this.readActive(), input.expectedActive)) return { status: "conflict" as const };
        await this.writeActive(input.target);
        return { status: "ok" as const, value: { active: { ...input.target } } };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async discard(input: Parameters<SiteProjectStoreAdapter["discard"]>[0]): Promise<SiteProjectAdapterMutationResult<{ active: ActiveFile }>> {
    try {
      return await this.withLock(async () => {
        const stored = await this.readStored(input.projectId);
        if (!stored || stored.revision !== input.expectedRevision) return { status: "not-found" as const };
        const active = await this.readActive();
        if (!sameActive(active, input.expectedActive)) return { status: "conflict" as const };
        const nextActive = active?.projectId === input.projectId && active.revision === input.expectedRevision ? null : active;
        const journal: Journal = { version: 1, projectId: input.projectId, projectText: null, active: nextActive };
        await this.writeJournal(journal);
        await this.applyJournal(journal);
        return { status: "ok" as const, value: { active: nextActive } };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Local storage failed."); }
  }

  async publish(input: { projectId: string; revision: string; build: SiteBuildPlan }): Promise<{ status: "ok" } | { status: "unavailable"; message: string }> {
    try {
      return await this.withLock(async () => {
        if (!isSafeRecordId(input.projectId) || !REVISION.test(input.revision) || input.build.projectId !== input.projectId) throw new Error("Unsafe build identity.");
        const stored = await this.readStored(input.projectId);
        if (!stored || stored.revision !== input.revision) throw new Error("Build input revision is unavailable.");
        const projectDir = join(this.root, BUILDS, input.projectId);
        if (!(await exists(projectDir))) { await mkdir(projectDir, { mode: 0o700 }); await syncDirectory(join(this.root, BUILDS)); }
        else { const info = await lstat(projectDir); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe build project directory."); }
        const revisionDir = join(projectDir, input.revision);
        const outputs = new Map<string, string>([["build.json", canonicalStringifyJson(input.build as unknown as import("@zudo-composer/component-contract").JsonValue)]]);
        input.build.modules.forEach((module, index) => outputs.set(`module-${String(index).padStart(4, "0")}.mjs`, module.code));
        const fileDigests = Object.fromEntries([...outputs].map(([name, text]) => [name, hash(text)]));
        const completeText = canonicalStringifyJson({ files: fileDigests });
        const expectedOutputEntries = [...outputs.keys()].sort();
        const expectedEntries = [...outputs.keys(), "complete.json"].sort();
        if (await exists(revisionDir)) {
          const info = await lstat(revisionDir);
          if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe immutable build directory.");
          const entries = (await readdir(revisionDir)).sort();
          if (entries.some((entry) => !expectedEntries.includes(entry))) throw new Error("Immutable build contains unknown files.");
          const hasComplete = entries.includes("complete.json");
          if (hasComplete && entries.join(",") !== expectedEntries.join(",")) throw new Error("Immutable completed build is partial.");
          if (!hasComplete && entries.join(",") !== expectedOutputEntries.join(",")) throw new Error("Immutable build is partial.");
          for (const name of entries) {
            const path = join(revisionDir, name);
            await this.verifyTarget(path, false);
            const expected = name === "complete.json" ? completeText : outputs.get(name);
            if (expected === undefined || await readFile(path, "utf8") !== expected) {
              throw new Error(name === "complete.json" ? "Immutable build completion marker conflicts." : "Immutable build conflicts with existing output.");
            }
          }
          if (!hasComplete) {
            await this.hit("build-files-durable");
            await this.atomicWrite(join(revisionDir, "complete.json"), completeText);
            await syncDirectory(revisionDir);
          }
        } else {
          await mkdir(revisionDir, { mode: 0o700 });
          await syncDirectory(projectDir);
          for (const [name, text] of outputs) await this.atomicWrite(join(revisionDir, name), text);
          await this.hit("build-files-durable");
          await this.atomicWrite(join(revisionDir, "complete.json"), completeText);
          await syncDirectory(revisionDir);
        }
        await this.atomicWrite(join(this.root, ACTIVE_BUILD), canonicalStringifyJson({ projectId: input.projectId, revision: input.revision }));
        return { status: "ok" as const };
      });
    } catch (error) { return unavailable(error instanceof Error ? error.message : "Build storage failed."); }
  }
}

export function createLocalSiteProjectStore(options?: LocalSiteProjectStoreOptions): LocalSiteProjectStore {
  return new LocalSiteProjectStore(options);
}
