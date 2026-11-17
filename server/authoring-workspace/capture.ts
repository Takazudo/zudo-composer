import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonValue, TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComposerConfig } from "../config/config";
import { executeAuthoringOperation } from "../edit/authoring-lease.mjs";
import { captureHost } from "../edit/inspect";
import { captureWorkspaceSnapshot, checkWorkspaceCapture, type WorkspaceSnapshotSource, type WorkspaceToken } from "../../src/app/workspace-snapshot";
import { createWorkspaceSaveRegistry } from "../../src/app/workspace-sessions";
import { projectFromWorkspace } from "../../src/app/workspace-record";
import { createComponentCatalog } from "../../src/composer/model/types";
import { canonicalStringifyJson, serializeSiteProject } from "../../src/site-project/model/canonical";
import { validateSiteProject } from "../../src/site-project/model/validation";
import type { SiteProject } from "../../src/site-project/model/types";
import { captureAuthoringProjectAssetLock } from "../../src/site-project/assets/capture";
import { compileSiteProject } from "../../src/site-project/compiler";
import { validateAssetReferenceLock, type AssetReferenceLock } from "../../src/assets/references";
import { validateAssetSnapshot, type AssetSnapshot } from "../../src/assets/model";
import type { StaticSiteCompilation } from "../site-build/compile";
import type { ResolvedComponentPack } from "../../plugins/component-pack.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface AuthoringRendererIdentity { id: string; version: string; module: string; digest: string }
export interface AuthoringPackIdentity { specifier: string; source: string; digest: string; compiler: string; contractDigest: string }
export interface AuthoringPublicFile { fileName: string; sourcePath: string }
export interface CapturedPublicFile { fileName: string; base64: string; checksum: string; byteLength: number }
export interface AuthoringWorkspaceSnapshot {
  schemaVersion: 1;
  digest: string;
  workspaceId: string;
  tokens: Readonly<Record<string, WorkspaceToken>>;
  project: SiteProject;
  componentPack: AuthoringPackIdentity & { manifestDigest: string };
  renderer: AuthoringRendererIdentity;
  publicFiles: CapturedPublicFile[];
  assets: {
    snapshot: AssetSnapshot;
    lock: AssetReferenceLock;
    files: { fileName: string; base64: string; checksum: string; byteLength: number }[];
  };
}
export interface CaptureAuthoringWorkspaceOptions {
  composerConfig: ResolvedComposerConfig;
  /** Explicit shipping manifest. Paths are normalized, workspace-relative files. */
  publicFiles?: readonly AuthoringPublicFile[];
  pack: TrustedComponentPack;
  packIdentity: AuthoringPackIdentity;
  renderer: AuthoringRendererIdentity;
}
export interface CompileAuthoringWorkspaceSnapshotOptions {
  snapshot: AuthoringWorkspaceSnapshot;
  pack: TrustedComponentPack;
  packIdentity: AuthoringPackIdentity;
  renderer: AuthoringRendererIdentity;
}
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => hash(canonicalStringifyJson(value as JsonValue));
const manifestIdentity = (options: Pick<CaptureAuthoringWorkspaceOptions, "pack" | "packIdentity">) => ({ ...options.packIdentity, manifestDigest: digest(options.pack.manifest) });
async function identityRuntime(): Promise<typeof import("./identity-runtime.mjs")> {
  const root = dirname(fileURLToPath(import.meta.resolve("zudo-composer/package.json")));
  return import(pathToFileURL(join(root, "server/authoring-workspace/identity-runtime.mjs")).href);
}
export async function resolveAuthoringPackIdentity(options: { composerConfig: ResolvedComposerConfig; pack: TrustedComponentPack; packIdentity: ResolvedComponentPack }): Promise<AuthoringPackIdentity> {
  return (await identityRuntime()).resolveAuthoringPackIdentity(options);
}
export async function resolveAuthoringRendererIdentity(options: { composerConfig: ResolvedComposerConfig }): Promise<AuthoringRendererIdentity> {
  return (await identityRuntime()).resolveAuthoringRendererIdentity(options);
}
function validateIdentities(options: Pick<CaptureAuthoringWorkspaceOptions, "renderer" | "packIdentity">) {
  if (!options.renderer.id?.trim() || !options.renderer.version?.trim()
    || !options.packIdentity.specifier?.trim() || !options.packIdentity.source?.trim()
    || !options.renderer.module?.trim() || !/^[a-f0-9]{64}$/.test(options.renderer.digest)
    || !options.packIdentity.compiler?.trim() || !/^[a-f0-9]{64}$/.test(options.packIdentity.contractDigest)
    || !/^[a-f0-9]{64}$/.test(options.packIdentity.digest)) throw new Error("Capture requires explicit renderer and immutable component-pack identities.");
}

async function openCapture(options: Pick<CaptureAuthoringWorkspaceOptions, "composerConfig" | "pack">) {
  const host = await captureHost({ config: options.composerConfig, pack: options.pack });
  const { registry, compositions, content, mappings, sitemaps, assets } = host.stores;
  const recordSource = <T>(id: string, store: { mutationToken(): Promise<WorkspaceToken>; snapshot(): Promise<{ mutationToken: WorkspaceToken; records: T }> }): WorkspaceSnapshotSource<T> => ({
    id, token: () => store.mutationToken(), read: async () => { const snapshot = await store.snapshot(); return { mutationToken: snapshot.mutationToken, value: snapshot.records }; },
  });
  const sources: WorkspaceSnapshotSource[] = [
    { id: "workspace", token: () => registry.generation(), read: async () => {
      const before = await registry.generation();
      if (await registry.selection() !== host.workspaceId) throw new Error("Workspace selection changed during capture.");
      const value = await registry.open(host.workspaceId);
      if (!value || value.status !== "ready") throw new Error("Capture requires a ready workspace.");
      if (before !== await registry.generation()) throw new Error("Workspace metadata changed during capture.");
      return { mutationToken: before, value };
    } },
    recordSource("compositions", compositions), recordSource("mappings", mappings), recordSource("sitemaps", sitemaps),
    { id: "content", token: async () => (await content.readAll()).mutationToken, read: async () => { const value = await content.readAll(); return { mutationToken: value.mutationToken, value }; } },
    { id: "assets", token: () => assets.mutationToken(), read: async () => { const value = await assets.snapshot(); return { mutationToken: value.mutationToken, value }; } },
  ];
  return { host, sources };
}

function nativeProject(host: Awaited<ReturnType<typeof openCapture>>["host"], values: Readonly<Record<string, unknown>>): SiteProject {
  const project = projectFromWorkspace(values.workspace as typeof host.workspace);
  const native = { compositions: "files", content: "content-filesystem", mappings: "mapping-filesystem", sitemaps: "sitemap-filesystem" } as const;
  for (const domain of Object.keys(native) as (keyof typeof native)[]) {
    if (project.providers[domain].length !== 1 || project.providers[domain][0]!.id !== native[domain]) throw new Error("Capture requires exactly the four native filesystem providers.");
  }
  project.providers.compositions[0]!.records = values.compositions as SiteProject["providers"]["compositions"][number]["records"];
  project.providers.mappings[0]!.records = values.mappings as SiteProject["providers"]["mappings"][number]["records"];
  project.providers.sitemaps[0]!.records = values.sitemaps as SiteProject["providers"]["sitemaps"][number]["records"];
  const content = values.content as Awaited<ReturnType<typeof host.stores.content.readAll>>;
  project.providers.content[0]!.models = [...content.models];
  project.providers.content[0]!.entries = [...content.entries];
  return project;
}

/** Offline capture requires Save and a stopped editor. A live server must hold its
 * authoring lease and flush browser sessions before invoking this operation. */
export async function captureAuthoringWorkspace(options: CaptureAuthoringWorkspaceOptions): Promise<AuthoringWorkspaceSnapshot> {
  validateIdentities(options);
  return executeAuthoringOperation(options.composerConfig.workspaceRoot, async () => {
    const { host, sources } = await openCapture(options);
    const sessions = createWorkspaceSaveRegistry();
    const outcome = await captureWorkspaceSnapshot(host.workspaceId, sessions, sources);
    if (outcome.status !== "ready") throw new Error(`Workspace capture ${outcome.status}; save and retry.`);
    const { capture } = outcome;
    const project = nativeProject(host, capture.values);
    const validation = validateSiteProject(project, { componentPack: options.pack.manifest });
    if (!validation.ok) throw new Error(`Captured project is invalid: ${validation.diagnostics.map(({ message }) => message).join(" ")}`);
    const snapshot = capture.values.assets as AssetSnapshot;
    const locked = await captureAuthoringProjectAssetLock(project, host.manifest, host.stores.assets, snapshot);
    if (locked.status !== "ready" || !locked.lock) {
      const diagnostics = locked.status === "blocked" ? [...locked.causes, ...locked.diagnostics] : [];
      throw new Error(`Referenced Assets could not be captured exactly. ${diagnostics.map(({ message }) => message).join(" ")}`);
    }
    const files: AuthoringWorkspaceSnapshot["assets"]["files"] = [];
    for (const pin of locked.lock.pins) {
      if (files.some(({ fileName }) => fileName === pin.url.slice(1))) continue;
      if (!/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(pin.url)) throw new Error("Unsafe captured asset path.");
      const handle = await open(join(options.composerConfig.paths.assets, "versions", basename(pin.url)), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Captured asset is not an immutable file.");
        const bytes = await handle.readFile();
        if (bytes.byteLength !== pin.byteLength || hash(bytes) !== pin.checksum) throw new Error("Captured asset bytes differ from the reviewed version.");
        files.push({ fileName: pin.url.slice(1), base64: bytes.toString("base64"), checksum: pin.checksum, byteLength: pin.byteLength });
      } finally { await handle.close(); }
    }
    const publicFiles = await capturePublicFiles(options);
    if (digest(publicFiles) !== digest(await capturePublicFiles(options))) throw new Error("Public files changed during capture; retry.");
    if (!await checkWorkspaceCapture(capture, host.workspaceId, sessions, sources)) throw new Error("Workspace changed while capturing Assets; retry.");
    const value = { schemaVersion: 1 as const, workspaceId: host.workspaceId, tokens: capture.tokens, project, componentPack: manifestIdentity(options), renderer: { ...options.renderer }, publicFiles, assets: { snapshot, lock: locked.lock, files } };
    return { ...value, digest: digest(value) };
  });
}

/** Reopen durable stores and compare their tokens; Content generation also rejects edit/revert. */
export async function isAuthoringWorkspaceSnapshotCurrent(options: CaptureAuthoringWorkspaceOptions, snapshot: AuthoringWorkspaceSnapshot): Promise<boolean> {
  validateIdentities(options);
  return executeAuthoringOperation(options.composerConfig.workspaceRoot, async () => {
    validateSnapshot(snapshot, options);
    const { host, sources } = await openCapture(options);
    if (digest(await capturePublicFiles(options)) !== digest(snapshot.publicFiles)) return false;
    return checkWorkspaceCapture({ workspaceId: snapshot.workspaceId, sessionGeneration: 0, tokens: snapshot.tokens, values: {} }, host.workspaceId, createWorkspaceSaveRegistry(), sources);
  });
}

/** Migration preflight only: verifies the saved source independently of the newly
 * installed pack/renderer. This does NOT establish build compatibility or switch
 * authority. Keep the source fenced, and recheck after staging before activation. */
export async function isAuthoringWorkspaceSourceCurrent(
  options: Pick<CaptureAuthoringWorkspaceOptions, "composerConfig" | "pack" | "publicFiles">,
  snapshot: AuthoringWorkspaceSnapshot,
): Promise<boolean> {
  snapshot = structuredClone(snapshot);
  validateSnapshotIntegrity(snapshot);
  return executeAuthoringOperation(options.composerConfig.workspaceRoot, async () => {
    const { host, sources } = await openCapture(options);
    const sessions = createWorkspaceSaveRegistry();
    const outcome = await captureWorkspaceSnapshot(host.workspaceId, sessions, sources);
    if (outcome.status !== "ready") return false;
    const { capture } = outcome;
    if (snapshot.workspaceId !== host.workspaceId || digest(snapshot.tokens) !== digest(capture.tokens)
      || digest(snapshot.project) !== digest(nativeProject(host, capture.values))
      || digest(snapshot.assets.snapshot) !== digest(capture.values.assets)
      || digest(snapshot.publicFiles) !== digest(await capturePublicFiles(options))) return false;
    const expectedAssets = new Map(snapshot.assets.lock.pins.map(pin => [pin.url.slice(1), pin]));
    if (snapshot.assets.files.length !== expectedAssets.size) throw new Error("Captured asset file set differs from the lock.");
    for (const file of snapshot.assets.files) {
      const pin = expectedAssets.get(file.fileName);
      if (!pin || file.checksum !== pin.checksum || file.byteLength !== pin.byteLength) throw new Error("Captured asset identity differs from the lock.");
      expectedAssets.delete(file.fileName);
      if (!/^uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(file.fileName)) throw new Error("Unsafe captured asset path.");
      const handle = await open(join(options.composerConfig.paths.assets, "versions", basename(file.fileName)), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await handle.stat()).isFile()) return false;
        const bytes = await handle.readFile();
        if (bytes.byteLength !== file.byteLength || hash(bytes) !== file.checksum || bytes.toString("base64") !== file.base64) return false;
      } finally { await handle.close(); }
    }
    if (digest(snapshot.publicFiles) !== digest(await capturePublicFiles(options))) return false;
    return checkWorkspaceCapture(capture, host.workspaceId, sessions, sources);
  });
}

function validateSnapshotIntegrity(snapshot: AuthoringWorkspaceSnapshot) {
  const { digest: expected, ...body } = snapshot;
  if (snapshot.schemaVersion !== 1 || expected !== digest(body)) throw new Error("Workspace snapshot digest mismatch.");
  if (!validateAssetSnapshot(snapshot.assets.snapshot) || !validateAssetReferenceLock(snapshot.assets.lock)
    || snapshot.assets.snapshot.mutationToken !== snapshot.assets.lock.mutationToken) throw new Error("Workspace snapshot Assets identity is invalid.");
}

function validateSnapshot(snapshot: AuthoringWorkspaceSnapshot, options: Pick<CaptureAuthoringWorkspaceOptions, "pack" | "packIdentity" | "renderer">) {
  validateIdentities(options);
  validateSnapshotIntegrity(snapshot);
  if (digest(snapshot.componentPack) !== digest(manifestIdentity(options)) || digest(snapshot.renderer) !== digest(options.renderer)) throw new Error("Workspace snapshot component-pack or renderer identity mismatch.");
}

/** Compiles only the captured bytes; later drafts and root source files are irrelevant. */
export async function compileAuthoringWorkspaceSnapshot(options: CompileAuthoringWorkspaceSnapshotOptions): Promise<StaticSiteCompilation> {
  const snapshot = structuredClone(options.snapshot);
  validateSnapshot(snapshot, options);
  const validation = validateSiteProject(snapshot.project, { componentPack: options.pack.manifest });
  if (!validation.ok) throw new Error(`Captured project is invalid: ${validation.diagnostics.map(({ message }) => message).join(" ")}`);
  const expectedFiles = new Map(snapshot.assets.lock.pins.map(pin => [pin.url.slice(1), pin]));
  if (snapshot.assets.files.length !== expectedFiles.size) throw new Error("Captured asset file set differs from the lock.");
  const assetFiles: StaticSiteCompilation["assetFiles"] = [];
  for (const file of snapshot.assets.files) {
    const pin = expectedFiles.get(file.fileName);
    const source = Buffer.from(file.base64, "base64");
    if (!pin || !/^uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(file.fileName)
      || source.toString("base64") !== file.base64 || hash(source) !== pin.checksum
      || source.byteLength !== pin.byteLength || file.checksum !== pin.checksum || file.byteLength !== pin.byteLength) throw new Error("Captured asset bytes or path differ from the lock.");
    expectedFiles.delete(file.fileName);
    assetFiles.push({ fileName: file.fileName, source });
  }
  const names = new Set(assetFiles.map(file => file.fileName));
  for (const file of snapshot.publicFiles) {
    const source = Buffer.from(file.base64, "base64");
    if (!safeRelativePath(file.fileName) || names.has(file.fileName) || source.toString("base64") !== file.base64 || source.byteLength !== file.byteLength || hash(source) !== file.checksum) throw new Error("Captured public file path, bytes or identity are invalid.");
    names.add(file.fileName); assetFiles.push({ fileName: file.fileName, source });
  }
  const compilation = await compileSiteProject(validation.project, { componentCatalog: createComponentCatalog(options.pack.manifest), policy: "release", assetLock: snapshot.assets.lock });
  if (compilation.status !== "ready") throw new Error(`Captured build is blocked: ${compilation.diagnostics.map(({ message }) => message).join(" ")}`);
  return { project: validation.project, build: compilation.build, projectSourceRevision: hash(serializeSiteProject(validation.project)), assetFiles };
}

function safeRelativePath(value: string): boolean {
  return !!value && !isAbsolute(value) && !value.includes("\\") && !value.includes("\0") && value.split("/").every(part => !!part && part !== "." && part !== "..");
}
export async function capturePublicFiles(options: Pick<CaptureAuthoringWorkspaceOptions, "composerConfig" | "publicFiles">): Promise<CapturedPublicFile[]> {
  const result: CapturedPublicFile[] = [];
  const root = await realpath(options.composerConfig.workspaceRoot);
  const manifest = options.publicFiles ?? await publicDirectoryManifest(root, options.composerConfig.hostDocument?.publicDir);
  for (const file of manifest) {
    if (!safeRelativePath(file.fileName) || !safeRelativePath(file.sourcePath) || result.some(value => value.fileName === file.fileName)) throw new Error("Public files must have unique normalized artifact and workspace-relative paths.");
    const path = resolve(root, file.sourcePath);
    if (relative(root, await realpath(path)) !== file.sourcePath || !(await lstat(path)).isFile()) throw new Error("Public file escapes the host or is not a regular file.");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat(); const bytes = await handle.readFile(); const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Public file changed during capture.");
      result.push({ fileName: file.fileName, base64: bytes.toString("base64"), checksum: hash(bytes), byteLength: bytes.byteLength });
    } finally { await handle.close(); }
  }
  return result.sort((a, b) => a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0);
}

async function publicDirectoryManifest(root: string, directory: string | undefined): Promise<AuthoringPublicFile[]> {
  if (directory === undefined) return [];
  if (!safeRelativePath(directory)) throw new Error("Public directory must be an explicit directory inside the host root.");
  const files: AuthoringPublicFile[] = [];
  const visit = async (path: string, artifactPath: string) => {
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink() || relative(root, await realpath(absolute)) !== path) throw new Error("Public directory must not contain links or escape the host.");
    if (stat.isFile()) { files.push({ sourcePath: path, fileName: artifactPath }); return; }
    if (!stat.isDirectory()) throw new Error("Public directory contains a nonregular entry.");
    for (const name of (await readdir(absolute)).sort()) await visit(`${path}/${name}`, artifactPath ? `${artifactPath}/${name}` : name);
  };
  if (!(await lstat(resolve(root, directory))).isDirectory()) throw new Error("Public directory is not a directory.");
  await visit(directory, "");
  return files;
}
