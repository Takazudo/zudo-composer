import { createHash, randomBytes } from "node:crypto";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SiteProjectActiveSelection, SiteProjectAdapterReadResult, SiteProjectBuildAdapter, SiteProjectStoreAdapter, StoredSiteProject, StagedRelease, CompletedRelease } from "../../src/site-project/api/types";
import { releaseJson, sameRelease } from "../../src/site-project/api/review";
import { serializeSiteProject } from "../../src/site-project/model/canonical";
import { validateSiteProject } from "../../src/site-project/model/validation";
import { validateStagedRelease } from "../../src/site-project/api/validation";
import { sniffMedia } from "../../src/media/storage/filesystem";
import type { MediaVersionPin } from "../../src/media/model";
import type { SiteProject } from "../../src/site-project/model";
import type { SiteBuildPlan } from "../../src/site-project/compiler";
import { isSafeRecordId } from "../../src/shared/record-identity";

export const SITE_PROJECT_LOCAL_ROOT_NAME = ".zudo-site-project";
export const SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT";
export const SITE_PROJECT_ACTIVE_FILENAME = "active.json";
export const DEFAULT_SITE_PROJECT_LOCAL_ROOT = resolve(import.meta.dirname, "../..", SITE_PROJECT_LOCAL_ROOT_NAME);
const configuredLocalRoot = () => process.env[SITE_PROJECT_LOCAL_ROOT_ENV]?.trim() ? resolve(process.env[SITE_PROJECT_LOCAL_ROOT_ENV]!) : DEFAULT_SITE_PROJECT_LOCAL_ROOT;
const SHA = /^[a-f0-9]{64}$/;
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const unavailable = (error: unknown) => ({ status: "unavailable" as const, message: error instanceof Error ? error.message : "Release storage unavailable." });
class ReleaseCommitUncertainError extends Error { constructor(message: string, readonly identity: SiteProjectActiveSelection, options: ErrorOptions) { super(message, options); } }
const mutationFailure = (error: unknown) => error instanceof ReleaseCommitUncertainError ? { status: "uncertain" as const, message: error.message, identity: error.identity } : unavailable(error);
const inside = (root: string, path: string) => { const part = relative(root, path); return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };
const exists = async (path: string) => { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };
async function syncDirectory(path: string) { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
interface Heads { schemaVersion: 2; generation: number; activationGeneration: number; projects: Record<string, { revision: string; buildId: string }>; stageOrder: string[]; stageGenerations: Record<string, number>; approvals: Record<string, string>; discarded: Record<string, { identity: SiteProjectActiveSelection; stageGeneration: number; expectedActive: SiteProjectActiveSelection | null }> }
interface CommitState { identity?: SiteProjectActiveSelection }
interface CleanupTicket { path: string; owner: string; inode: number; phase: "owner" | "directory" | "sync" }
export interface LocalSiteProjectStoreOptions {
  testRoot?: string; lockTimeoutMs?: number; fault?(point: string): void | Promise<void>;
  componentPack?: ComponentPackManifest;
  readMedia?(pin: MediaVersionPin): Promise<AsyncIterable<Uint8Array>>;
}
function validActive(value: unknown): value is SiteProjectActiveSelection {
  const item = value as SiteProjectActiveSelection;
  return !!item && typeof item === "object" && Object.keys(item).sort().join(",") === "buildId,projectId,revision" && isSafeRecordId(item.projectId) && SHA.test(item.revision) && SHA.test(item.buildId);
}
function validStage(value: unknown): value is StagedRelease {
  const stage = value as StagedRelease;
  return validateStagedRelease(stage) && stage.buildId === hash(releaseJson({ projectRevision: stage.revision, mediaLock: stage.mediaLock, toolchain: stage.toolchain }));
}

/** Clean v2 layout: immutable revisions/stages/builds, one independently atomic active pointer. */
export class LocalSiteProjectStore implements SiteProjectStoreAdapter, SiteProjectBuildAdapter {
  readonly root: string;
  private pinnedRoot?: string;
  private commitState?: CommitState;
  private pendingCleanup?: CleanupTicket;
  private cleanupRetry?: Promise<void>;
  constructor(private readonly options: LocalSiteProjectStoreOptions = {}) { this.root = resolve(options.testRoot ?? configuredLocalRoot()); }
  private hit(point: string) { return this.options.fault?.(point); }
  private async directory(path: string) {
    if (!inside(this.root, path)) throw new Error("Directory escaped release root.");
    if (!await exists(path)) { try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } await syncDirectory(dirname(path)); }
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe release directory.");
    const actual = await realpath(path);
    if (this.pinnedRoot && (!inside(this.pinnedRoot, actual) || await realpath(this.root) !== this.pinnedRoot)) throw new Error("Release root changed.");
  }
  private async ensureRoot() {
    const expected = join(await realpath(dirname(this.root)), basename(this.root));
    await this.directory(this.root);
    const actual = await realpath(this.root); if (actual !== expected) throw new Error("Unsafe release root.");
    this.pinnedRoot = actual;
    for (const name of ["projects", "stages", "builds"]) await this.directory(join(this.root, name));
    await syncDirectory(this.root); // Fail before any logical mutation on unsupported platforms.
  }
  private async file(path: string) {
    if (!inside(this.root, path)) throw new Error("File escaped release root.");
    let parent = dirname(path);
    while (inside(this.root, parent)) { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe release file parent."); if (parent === this.root) break; parent = dirname(parent); }
    if (await realpath(this.root) !== this.pinnedRoot || !inside(this.pinnedRoot!, await realpath(dirname(path)))) throw new Error("Release root changed.");
    if (await exists(path)) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe release file."); }
  }
  private async read(path: string): Promise<Buffer> {
    await this.file(path); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const info = await handle.stat(); const current = await lstat(path); if (!info.isFile() || info.ino !== current.ino || info.dev !== current.dev) throw new Error("Release file changed during read."); return await handle.readFile(); } finally { await handle.close(); }
  }
  private async json(path: string): Promise<unknown> { const text = (await this.read(path)).toString("utf8"); const value = JSON.parse(text); if (releaseJson(value) !== text) throw new Error("Noncanonical release data."); return value; }
  private async write(path: string, bytes: string | Uint8Array, immutable = false, commit?: SiteProjectActiveSelection) {
    await this.file(path);
    if (immutable && await exists(path)) { if (!(await this.read(path)).equals(Buffer.from(bytes))) throw new Error("Immutable release output conflicts."); return; }
    const temp = join(dirname(path), `.release-tmp-${process.pid}-${randomBytes(12).toString("hex")}`);
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await this.hit("after-write"); await handle.sync(); await this.hit("after-file-sync"); } finally { await handle.close(); }
    await this.hit("after-close"); await this.file(path); await this.hit("before-rename");
    await rename(temp, path);
    if (commit && this.commitState) this.commitState.identity = { ...commit };
    try { await this.hit("after-rename"); await syncDirectory(dirname(path)); await this.hit("after-directory-sync"); }
    catch (error) { if (commit) throw new ReleaseCommitUncertainError(`Release commit acknowledgment is uncertain. Inspect exact identity ${releaseJson(commit).trim()} before retrying.`, commit, { cause: error }); throw error; }
  }
  private async lock<T>(action: () => Promise<T>): Promise<T> {
    await this.retryCleanup();
    await this.ensureRoot(); const path = join(this.root, ".transaction-lock"); const deadline = Date.now() + (this.options.lockTimeoutMs ?? 10_000);
    const nonce = randomBytes(12).toString("hex"), owner = releaseJson({ pid: process.pid, nonce });
    while (true) {
      try { await mkdir(path, { mode: 0o700 }); const handle = await open(join(path, "owner.json"), "wx", 0o600); try { await handle.writeFile(owner); await handle.sync(); } finally { await handle.close(); } await syncDirectory(path); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await this.recoverDeadWriter(path)) continue;
        if (Date.now() >= deadline) throw new Error("Release writer lock unavailable; inspect ownership before recovery.", { cause: error });
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
    const state: CommitState = {}; this.commitState = state;
    const cleanup: CleanupTicket = { path, owner, inode: (await lstat(path)).ino, phase: "owner" };
    try {
      await this.verifyLayout();
      return await action();
    } finally { await this.finishOperation(cleanup, state); }
  }
  private async finishOperation(ticket: CleanupTicket, state: CommitState) {
    try { await this.releaseLock(ticket); }
    catch (error) {
      this.pendingCleanup = ticket;
      // Phase-aware retry never removes a later writer's lock. A persistent
      // failure keeps the ticket for this instance's next recovery attempt.
      try { await this.retryCleanup(); } catch { /* Original outcome remains explicit. */ }
      if (state.identity) throw new ReleaseCommitUncertainError(`Release committed but lock cleanup failed. Inspect exact identity ${releaseJson(state.identity).trim()} before retrying.`, state.identity, { cause: error });
      throw error;
    }
  }
  private async retryCleanup() {
    if (!this.pendingCleanup) return;
    if (!this.cleanupRetry) {
      const ticket = this.pendingCleanup;
      const retry = this.releaseLock(ticket).then(() => { if (this.pendingCleanup === ticket) this.pendingCleanup = undefined; });
      this.cleanupRetry = retry;
      void retry.finally(() => { if (this.cleanupRetry === retry) this.cleanupRetry = undefined; }).catch(() => undefined);
    }
    await this.cleanupRetry;
  }
  private async recoverDeadWriter(path: string): Promise<boolean> {
    const recovery = join(this.root, ".recovery-lock");
    try { await mkdir(recovery, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    const recoveryInfo = await lstat(recovery);
    try {
      if (!await exists(path)) return true;
      const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe release lock.");
      const ownerPath = join(path, "owner.json"); if (!await exists(ownerPath)) return false;
      const ownerInfo = await lstat(ownerPath); if (!ownerInfo.isFile() || ownerInfo.isSymbolicLink()) throw new Error("Unsafe release lock owner.");
      const text = await readFile(ownerPath, "utf8"), parsed = JSON.parse(text);
      if (!parsed || Object.keys(parsed).sort().join(",") !== "nonce,pid" || !Number.isSafeInteger(parsed.pid) || parsed.pid < 1 || !/^[a-f0-9]{24}$/.test(parsed.nonce)) throw new Error("Invalid release lock owner.");
      let dead = false; try { process.kill(parsed.pid, 0); } catch (cause) { dead = (cause as NodeJS.ErrnoException).code === "ESRCH"; }
      if (!dead) return false;
      if ((await lstat(path)).ino !== info.ino || await readFile(ownerPath, "utf8") !== text) return false;
      await unlink(ownerPath); await rmdir(path); await syncDirectory(this.root); return true;
    } catch (error) {
      // A live writer may release normally between our existence/read checks.
      // Re-enter acquisition; never treat that benign race as a stale-owner claim.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return !await exists(path);
      throw error;
    } finally { await this.removeRecoveryLock(recovery, recoveryInfo.ino); }
  }
  private async removeRecoveryLock(path: string, inode: number) {
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink() || info.ino !== inode || await realpath(this.root) !== this.pinnedRoot) throw new Error("Recovery lock ownership changed.");
    await rmdir(path); await syncDirectory(this.root);
  }
  private async releaseLock(ticket: CleanupTicket) {
    const { path, owner, inode } = ticket;
    if (ticket.phase !== "sync") { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink() || info.ino !== inode || await realpath(this.root) !== this.pinnedRoot) throw new Error("Release lock ownership changed."); }
    if (ticket.phase === "owner") {
      const ownerPath = join(path, "owner.json"), info = await lstat(ownerPath);
      if (!info.isFile() || info.isSymbolicLink() || await readFile(ownerPath, "utf8") !== owner) throw new Error("Release lock ownership changed.");
      await this.hit("lock-cleanup-unlink"); await unlink(ownerPath); ticket.phase = "directory";
    }
    if (ticket.phase === "directory") { await this.hit("lock-cleanup-rmdir"); await rmdir(path); ticket.phase = "sync"; }
    await this.hit("lock-cleanup-sync"); await syncDirectory(this.root);
  }
  private async verifyLayout() {
    const temporary = (name: string) => /^\.release-tmp-\d+-[a-f0-9]{24}$/.test(name);
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!["projects", "stages", "builds", "heads.json", "active.json", ".transaction-lock", ".recovery-lock"].includes(entry.name) && !temporary(entry.name)) throw new Error("Unsupported release layout; explicit clean reset required.");
      if (entry.isSymbolicLink() || (!["projects", "stages", "builds", ".transaction-lock", ".recovery-lock"].includes(entry.name) && !entry.isFile())) throw new Error("Unsafe release layout entry.");
    }
    for (const entry of await readdir(join(this.root, "stages"), { withFileTypes: true })) if (!entry.isFile() || entry.isSymbolicLink() || (!/^[a-f0-9]{64}\.json$/.test(entry.name) && !temporary(entry.name))) throw new Error("Unknown staged release file.");
    for (const domain of ["projects", "builds"]) for (const entry of await readdir(join(this.root, domain), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || (domain === "projects" ? !isSafeRecordId(entry.name) : !SHA.test(entry.name))) throw new Error("Unknown immutable release directory.");
      for (const file of await readdir(join(this.root, domain, entry.name), { withFileTypes: true })) if (!file.isFile() || file.isSymbolicLink() || (!temporary(file.name) && !(domain === "projects" ? /^[a-f0-9]{64}\.json$/ : /^(?:build\.json|stage\.json|complete\.json|module-\d{4,8}\.mjs|media-sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/).test(file.name))) throw new Error("Unknown immutable release file.");
    }
  }
  private async heads(): Promise<Heads> {
    const path = join(this.root, "heads.json"); if (!await exists(path)) { if (await exists(join(this.root, "active.json"))) throw new Error("Active pointer has no retained heads catalog."); return { schemaVersion: 2, generation: 0, activationGeneration: 0, projects: {}, stageOrder: [], stageGenerations: {}, approvals: {}, discarded: {} }; }
    const value = await this.json(path) as Heads;
    const object = (item: unknown) => !!item && typeof item === "object" && !Array.isArray(item);
    if (!value || Object.keys(value).sort().join(",") !== "activationGeneration,approvals,discarded,generation,projects,schemaVersion,stageGenerations,stageOrder" || value.schemaVersion !== 2 || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Number.isSafeInteger(value.activationGeneration) || value.activationGeneration < 0 || ![value.projects, value.stageGenerations, value.approvals, value.discarded].every(object) || !Array.isArray(value.stageOrder) || new Set(value.stageOrder).size !== value.stageOrder.length || value.stageOrder.some((id) => !SHA.test(id))) throw new Error("Invalid release heads schema.");
    if (Object.keys(value.stageGenerations).sort().join() !== [...value.stageOrder].sort().join()) throw new Error("Visible stage generations differ from stage order.");
    const lastHeads = new Map<string, { revision: string; buildId: string }>(), stages = new Map<string, StagedRelease>(), generations = new Set<number>();
    let priorGeneration = 0;
    for (const id of value.stageOrder) {
      const generation = value.stageGenerations[id]!;
      if (!Number.isSafeInteger(generation) || generation <= priorGeneration || generation > value.generation || Object.hasOwn(value.discarded, id)) throw new Error("Contradictory visible stage incarnation/order.");
      priorGeneration = generation; generations.add(generation);
      const stage = await this.json(join(this.root, "stages", `${id}.json`));
      if (!validStage(stage) || stage.buildId !== id || !await this.stored(stage.projectId, stage.revision)) throw new Error("Visible stage inputs are missing or corrupt.");
      stages.set(id, stage); lastHeads.set(stage.projectId, { revision: stage.revision, buildId: id });
    }
    if (releaseJson(value.projects) !== releaseJson(Object.fromEntries(lastHeads))) throw new Error("Project heads contradict visible stage lineage.");
    const approved = new Set<string>();
    for (const [digest, id] of Object.entries(value.approvals)) { if (!SHA.test(digest) || !stages.has(id)) throw new Error("Approval receipt is not visible."); approved.add(id); }
    if (approved.size !== stages.size) throw new Error("Visible stage has no approval receipt.");
    for (const [id, receipt] of Object.entries(value.discarded)) {
      if (!object(receipt) || Object.keys(receipt).sort().join() !== "expectedActive,identity,stageGeneration" || !(receipt.expectedActive === null || validActive(receipt.expectedActive)) || !validActive(receipt.identity) || receipt.identity.buildId !== id || stages.has(id) || !Number.isSafeInteger(receipt.stageGeneration) || receipt.stageGeneration < 1 || receipt.stageGeneration >= value.generation || generations.has(receipt.stageGeneration) || await exists(join(this.root, "builds", id, "complete.json"))) throw new Error("Contradictory discarded stage receipt.");
      const stage = await this.json(join(this.root, "stages", `${id}.json`));
      if (!validStage(stage) || !sameRelease(receipt.identity, { projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId }) || !await this.stored(stage.projectId, stage.revision)) throw new Error("Discard receipt identity differs from staged inputs.");
      generations.add(receipt.stageGeneration);
    }
    const active = await this.active();
    if (active && (value.activationGeneration < 1 || !stages.has(active.buildId) || !sameRelease(active, { projectId: stages.get(active.buildId)!.projectId, revision: stages.get(active.buildId)!.revision, buildId: active.buildId }) || !await exists(join(this.root, "builds", active.buildId, "complete.json")))) throw new Error("Active identity is not a retained completed stage.");
    for (const [projectId, head] of Object.entries(value.projects)) if (!validActive({ projectId, ...head })) throw new Error("Invalid project head.");
    return value;
  }
  private async active(): Promise<SiteProjectActiveSelection | null> { const path = join(this.root, "active.json"); if (!await exists(path)) return null; const value = await this.json(path); if (!validActive(value)) throw new Error("Invalid active release pointer."); return value; }
  private async stage(projectId: string, buildId: string): Promise<StagedRelease | undefined> {
    if (!isSafeRecordId(projectId) || !SHA.test(buildId)) throw new Error("Unsafe stage identity.");
    if (!(await this.heads()).stageOrder.includes(buildId)) return undefined;
    const value = await this.json(join(this.root, "stages", `${buildId}.json`));
    if (!validStage(value) || value.buildId !== buildId || !await this.stored(value.projectId, value.revision)) throw new Error("Corrupt staged release."); return value.projectId === projectId ? value : undefined;
  }
  private async stored(projectId: string, revision: string): Promise<StoredSiteProject | undefined> {
    if (!isSafeRecordId(projectId) || !SHA.test(revision)) throw new Error("Unsafe revision identity.");
    const path = join(this.root, "projects", projectId, `${revision}.json`); if (!await exists(path)) return undefined;
    const text = (await this.read(path)).toString("utf8"), project = JSON.parse(text) as SiteProject;
    if (project.schemaVersion !== 2 || project.id !== projectId || serializeSiteProject(project) !== text || hash(text) !== revision) throw new Error("Corrupt immutable project revision.");
    return { project, revision };
  }
  private async completed(projectId: string, buildId: string): Promise<CompletedRelease | undefined> {
    const stage = await this.stage(projectId, buildId); if (!stage) return undefined;
    const directory = join(this.root, "builds", buildId), marker = join(directory, "complete.json"); if (!await exists(marker)) return undefined;
    const complete = await this.json(marker) as { schemaVersion: number; identity: SiteProjectActiveSelection; files: Record<string, string>; completionDigest: string };
    if (!complete || Object.keys(complete).sort().join(",") !== "completionDigest,files,identity,schemaVersion" || complete.schemaVersion !== 2 || !sameRelease(complete.identity, { projectId, revision: stage.revision, buildId }) || complete.completionDigest !== hash(releaseJson({ identity: complete.identity, files: complete.files }))) throw new Error("Invalid completion marker.");
    const expected = ["build.json", "stage.json", ...Object.keys(complete.files).filter((name) => /^(?:module-\d{4,8}\.mjs|media-sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/.test(name))].sort();
    if (Object.keys(complete.files).sort().join() !== expected.join()) throw new Error("Invalid completed output manifest.");
    const entries = (await readdir(directory)).filter((name) => !name.startsWith(".release-tmp-")).sort();
    if (entries.join() !== [...expected, "complete.json"].sort().join()) throw new Error("Completed build is partial or has unknown files.");
    for (const [name, digest] of Object.entries(complete.files)) if (!SHA.test(digest) || hash(await this.read(join(directory, name))) !== digest) throw new Error("Completed build integrity failure.");
    if (releaseJson(await this.json(join(directory, "stage.json"))) !== releaseJson(stage)) throw new Error("Completed stage identity differs.");
    const build = await this.json(join(directory, "build.json")) as SiteBuildPlan;
    if (build.projectId !== projectId) throw new Error("Completed build project differs.");
    for (const pin of stage.mediaLock?.pins ?? []) if (complete.files[`media-${basename(pin.url)}`] !== pin.checksum) throw new Error("Completed build omits pinned Media bytes.");
    await syncDirectory(directory);
    return { ...complete, build, stage };
  }
  private async visibleStages(): Promise<StagedRelease[]> {
    const values: StagedRelease[] = [];
    for (const id of (await this.heads()).stageOrder) { const value = await this.json(join(this.root, "stages", `${id}.json`)); if (!validStage(value) || value.buildId !== id || !await this.stored(value.projectId, value.revision)) throw new Error("Retained staged inputs are corrupt or missing."); values.push(value); }
    return values;
  }
  async list(): ReturnType<SiteProjectStoreAdapter["list"]> {
    try { return await this.lock(async () => {
      const heads = await this.heads(), stages = await this.visibleStages(), active = await this.active();
      if (active) { const completed = await this.completed(active.projectId, active.buildId); if (!completed || !sameRelease(active, completed.identity)) throw new Error("Active pointer is not a verified completed build."); }
      const projects = [];
      for (const [projectId, head] of Object.entries(heads.projects).sort()) {
        const stored = await this.stored(projectId, head.revision); if (!stored) throw new Error("Staged project missing.");
        const retained = stages.filter((stage) => stage.projectId === projectId);
        if (!retained.some((stage) => stage.buildId === head.buildId && stage.revision === head.revision)) throw new Error("Project head is not retained.");
        projects.push({ projectId, name: stored.project.name, revisions: [...new Set(retained.map(({ revision }) => revision))].sort(), head: head.revision, stages: retained.map(({ buildId }) => buildId).sort() });
      }
      return { status: "ok" as const, value: { projects, active, generation: heads.generation, stageGenerations: heads.stageGenerations } };
    }); } catch (error) { return unavailable(error); }
  }
  async get(input: { projectId: string; revision: string }): ReturnType<SiteProjectStoreAdapter["get"]> {
    try { return await this.lock(async () => {
      if (!(await this.visibleStages()).some((stage) => stage.projectId === input.projectId && stage.revision === input.revision)) return { status: "not-found" as const };
      const value = await this.stored(input.projectId, input.revision); return value ? { status: "ok" as const, value } : { status: "not-found" as const };
    }); } catch (error) { return unavailable(error); }
  }
  async getStage(input: { projectId: string; buildId: string; approvalDigest?: string }): ReturnType<SiteProjectStoreAdapter["getStage"]> { try { return await this.lock(async () => { const heads = await this.heads(); if (input.approvalDigest !== undefined && heads.approvals[input.approvalDigest] !== input.buildId) return { status: "not-found" as const }; const value = await this.stage(input.projectId, input.buildId); return value ? { status: "ok" as const, value, stageGeneration: heads.stageGenerations[input.buildId]! } : { status: "not-found" as const }; }); } catch (error) { return unavailable(error); } }
  async getCompleted(input: { projectId: string; buildId: string }): ReturnType<SiteProjectBuildAdapter["getCompleted"]> { try { return await this.lock(async () => { const value = await this.completed(input.projectId, input.buildId); return value ? { status: "ok" as const, value } : { status: "not-found" as const }; }); } catch (error) { return unavailable(error); } }
  async readActiveProject(): Promise<SiteProjectAdapterReadResult<(StoredSiteProject & { buildId: string }) | null>> {
    try { return await this.lock(async () => {
      const active = await this.active(); if (!active) return { status: "ok" as const, value: null };
      const completed = await this.completed(active.projectId, active.buildId);
      if (!completed || !sameRelease(active, completed.identity)) throw new Error("Active completed build is missing or inconsistent.");
      const stored = await this.stored(active.projectId, active.revision); if (!stored) throw new Error("Active revision is missing.");
      return { status: "ok" as const, value: { ...stored, buildId: active.buildId } };
    }); } catch (error) { return unavailable(error); }
  }
  async apply(input: Parameters<SiteProjectStoreAdapter["apply"]>[0]): ReturnType<SiteProjectStoreAdapter["apply"]> {
    try { return await this.lock(async () => {
      if (!validStage(input.stage) || input.project.schemaVersion !== 2 || input.stage.projectId !== input.project.id || (this.options.componentPack && !validateSiteProject(input.project, { componentPack: this.options.componentPack }).ok) || hash(serializeSiteProject(input.project)) !== input.stage.revision) throw new Error("Invalid immutable staged inputs.");
      const heads = await this.heads(), active = await this.active(); const existing = await this.stage(input.project.id, input.stage.buildId);
      if (existing && heads.approvals[input.stage.planDigest] === existing.buildId) return { status: "ok" as const, value: { revision: existing.revision, buildId: existing.buildId, stageGeneration: heads.stageGenerations[existing.buildId]!, active } };
      if (heads.generation !== input.expectedGeneration || (heads.projects[input.project.id]?.revision ?? null) !== input.expectedRevision || !sameRelease(active, input.expectedActive)) return { status: "conflict" as const };
      const directory = join(this.root, "projects", input.project.id); await this.directory(directory);
      await this.write(join(directory, `${input.stage.revision}.json`), serializeSiteProject(input.project), true);
      const stagePath = join(this.root, "stages", `${input.stage.buildId}.json`);
      let retainedStage = input.stage;
      if (await exists(stagePath)) {
        // A new approval can address the same immutable build. Its receipt is
        // recorded separately; preserve the original generation-guarded release
        // reconciliation rather than rewriting a completed stage's provenance.
        const prior = await this.json(stagePath); if (!validStage(prior) || releaseJson({ ...prior, planDigest: input.stage.planDigest, publication: input.stage.publication }) !== releaseJson(input.stage)) throw new Error("Immutable staged inputs conflict."); retainedStage = prior;
      }
      await this.write(stagePath, releaseJson(retainedStage), true); await this.hit("stage-files-durable");
      if (input.verifyApproval && !await input.verifyApproval()) return { status: "conflict" as const };
      heads.projects[input.project.id] = { revision: input.stage.revision, buildId: input.stage.buildId }; heads.stageOrder = heads.stageOrder.filter((id) => id !== input.stage.buildId); heads.stageOrder.push(input.stage.buildId); heads.approvals[input.stage.planDigest] = input.stage.buildId; delete heads.discarded[input.stage.buildId]; heads.generation++;
      heads.stageGenerations[input.stage.buildId] = heads.generation;
      await this.write(join(this.root, "heads.json"), releaseJson(heads), false, { projectId: input.stage.projectId, revision: input.stage.revision, buildId: input.stage.buildId });
      return { status: "ok" as const, value: { revision: input.stage.revision, buildId: input.stage.buildId, stageGeneration: heads.generation, active } };
    }); } catch (error) { return mutationFailure(error); }
  }
  async activate(input: Parameters<SiteProjectStoreAdapter["activate"]>[0]): ReturnType<SiteProjectStoreAdapter["activate"]> {
    try { return await this.lock(async () => {
      if (!validActive(input.target)) throw new Error("Invalid activation identity.");
      const completed = await this.completed(input.target.projectId, input.target.buildId);
      if (!completed || !sameRelease(completed.identity, input.target)) return { status: "not-found" as const };
      const current = await this.active(), heads = await this.heads();
      if (!sameRelease(current, input.target)) {
        if (!sameRelease(current, input.expectedActive)) return { status: "conflict" as const };
        if (heads.activationGeneration >= Number.MAX_SAFE_INTEGER) throw new Error("Activation generation exhausted.");
        heads.activationGeneration++;
        // Reserve the durable fence before publishing its pointer. Crash gaps are safe.
        await this.write(join(this.root, "heads.json"), releaseJson(heads), false);
        await this.hit("before-active-write"); await this.write(join(this.root, "active.json"), releaseJson(input.target), false, input.target);
      }
      let reconciliation: "applied" | "changed" | "unavailable" = "unavailable";
      if (input.reconcile && this.commitState) this.commitState.identity = { ...input.target };
      try { if (input.reconcile) reconciliation = await input.reconcile(completed.stage, heads.activationGeneration); } catch { /* The pointer is committed; reconciliation failure cannot roll it back. */ }
      return { status: "ok" as const, value: { active: input.target, activationGeneration: heads.activationGeneration, reconciliation } };
    }); } catch (error) { return mutationFailure(error); }
  }
  async discard(input: Parameters<SiteProjectStoreAdapter["discard"]>[0]): ReturnType<SiteProjectStoreAdapter["discard"]> {
    try { return await this.lock(async () => {
      const heads = await this.heads(), active = await this.active();
      if (!Number.isSafeInteger(input.expectedStageGeneration) || input.expectedStageGeneration < 1) return { status: "conflict" as const };
      if (!sameRelease(active, input.expectedActive)) return { status: "conflict" as const };
      const discarded = heads.discarded[input.buildId];
      if (discarded?.identity.projectId === input.projectId && discarded.stageGeneration === input.expectedStageGeneration) return sameRelease(discarded.expectedActive, input.expectedActive) ? { status: "ok" as const, value: { active: discarded.expectedActive } } : { status: "conflict" as const };
      if (heads.stageGenerations[input.buildId] !== input.expectedStageGeneration) return { status: "conflict" as const };
      const stage = await this.stage(input.projectId, input.buildId); if (!stage) return { status: "not-found" as const };
      if (active?.buildId === input.buildId || await exists(join(this.root, "builds", input.buildId, "complete.json"))) return { status: "conflict" as const };
      heads.stageOrder = heads.stageOrder.filter((id) => id !== input.buildId);
      delete heads.stageGenerations[input.buildId];
      heads.approvals = Object.fromEntries(Object.entries(heads.approvals).filter(([, id]) => id !== input.buildId));
      if (heads.projects[input.projectId]?.buildId === input.buildId) {
        const remaining = []; for (const id of heads.stageOrder) { const item = await this.stage(input.projectId, id); if (item) remaining.push(item); }
        const next = remaining.at(-1); if (next) heads.projects[input.projectId] = { revision: next.revision, buildId: next.buildId }; else delete heads.projects[input.projectId];
      }
      const identity = { projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId };
      heads.discarded[input.buildId] = { identity, stageGeneration: input.expectedStageGeneration, expectedActive: input.expectedActive }; heads.generation++;
      await this.write(join(this.root, "heads.json"), releaseJson(heads), false, identity);
      return { status: "ok" as const, value: { active } };
    }); } catch (error) { return mutationFailure(error); }
  }
  async complete(input: { stage: StagedRelease; build: SiteBuildPlan }): ReturnType<SiteProjectBuildAdapter["complete"]> {
    try { return await this.lock(async () => {
      const { stage, build } = input; const retained = await this.stage(stage.projectId, stage.buildId);
      if (!retained || releaseJson(retained) !== releaseJson(stage) || build.projectId !== stage.projectId || !await this.stored(stage.projectId, stage.revision)) return { status: "not-found" as const };
      const existing = await this.completed(stage.projectId, stage.buildId); if (existing) { if (releaseJson(existing.build) !== releaseJson(build)) throw new Error("Immutable completed build differs."); return { status: "ok" as const, value: existing }; }
      const directory = join(this.root, "builds", stage.buildId); await this.directory(directory);
      const outputs = new Map<string, string | Uint8Array>([["build.json", releaseJson(build)], ["stage.json", releaseJson(stage)]]);
      build.modules.forEach((module, index) => outputs.set(`module-${String(index).padStart(4, "0")}.mjs`, module.code));
      const fileDigests = new Map([...outputs].map(([name, bytes]) => [name, hash(bytes)]));
      for (const pin of stage.mediaLock?.pins ?? []) {
        const name = `media-${basename(pin.url)}`; if (fileDigests.has(name)) continue;
        const destination = join(directory, name);
        if (await exists(destination)) {
          await this.file(destination);
          const info = await lstat(destination); if (info.size !== pin.byteLength || info.size > 25 * 1024 * 1024) throw new Error("Existing pinned Media size differs.");
          const bytes = await this.read(destination);
          if (hash(bytes) !== pin.checksum || sniffMedia(bytes.subarray(0, 16))?.mediaType !== pin.mediaType) throw new Error("Existing pinned Media integrity differs.");
          await syncDirectory(directory); fileDigests.set(name, pin.checksum); continue;
        }
        if (!this.options.readMedia) throw new Error("Exact Media byte reader unavailable.");
        const parts: Uint8Array[] = []; let length = 0; const checksum = createHash("sha256");
        for await (const chunk of await this.options.readMedia(pin)) { length += chunk.byteLength; if (length > pin.byteLength || length > 25 * 1024 * 1024) throw new Error("Pinned Media byte size exceeded."); checksum.update(chunk); parts.push(chunk); }
        const bytes = Buffer.concat(parts); if (length !== pin.byteLength || checksum.digest("hex") !== pin.checksum || sniffMedia(bytes.subarray(0, 16))?.mediaType !== pin.mediaType) throw new Error("Pinned Media integrity failure.");
        await this.write(join(directory, name), bytes, true); fileDigests.set(name, pin.checksum);
      }
      const expected = [...fileDigests.keys(), "complete.json"].sort();
      for (const entry of await readdir(directory)) if (!expected.includes(entry) && !/^\.release-tmp-\d+-[a-f0-9]{24}$/.test(entry)) throw new Error("Unknown incomplete build output.");
      for (const [name, bytes] of outputs) await this.write(join(directory, name), bytes, true);
      await this.hit("build-files-durable");
      const identity = { projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId }, files = Object.fromEntries(fileDigests);
      const marker = { schemaVersion: 2, identity, files, completionDigest: hash(releaseJson({ identity, files })) };
      await this.write(join(directory, "complete.json"), releaseJson(marker), true, identity); await syncDirectory(directory);
      return { status: "ok" as const, value: (await this.completed(stage.projectId, stage.buildId))! };
    }); } catch (error) { return mutationFailure(error); }
  }
}
export function createLocalSiteProjectStore(options?: LocalSiteProjectStoreOptions) { return new LocalSiteProjectStore(options); }
