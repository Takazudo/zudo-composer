// Seeding a demo package: its committed Assets store, then an activated release.
//
// Assets go straight into the package's `cms/assets` through the tool's own
// filesystem store, preserving whatever an author already uploaded. The
// release goes through `zudo-composer release` — the same JSON-stdin sequence
// `scripts/run-site-project-browser.mjs` drives — because on-disk CMS records
// are a transactional pointer format and are never written by hand.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { assetAuthoringUrl, assetMimeTypeForExtension } from "../../../src/assets/model";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import type { ReleasePlan, SiteProjectActiveSelection, SiteProjectApiRequest, SiteProjectApiResponse, SiteProjectListEntry } from "../../../src/site-project/api/types";
import type { SiteProject } from "../../../src/site-project/model/types";
import { readSiteProjectFile } from "./generate";

export const ASSET_MANIFEST_FILE = "images-src/manifest.json";

/** One committed source file under `images-src/`, uploaded under its own file name; `alt` is the note when `note` is absent. */
export interface AssetManifestEntry {
  file: string;
  note?: string;
  alt?: string;
}

/**
 * File name → canonical authoring URL (`/uploaded-assets/asset-<id>`) for every
 * active asset in the package's committed store. Asset ids are minted at upload,
 * so a `site-project.ts` looks its images up by file name instead of pinning ids.
 */
export function readAssetUrls(packageRoot: string): Record<string, string> {
  const catalog = JSON.parse(readFileSync(resolve(packageRoot, "cms/assets/catalog.json"), "utf8")) as { records: { id: string; document: { fileName: string; state: "active" | "trash" } }[] };
  const urls: Record<string, string> = {};
  for (const record of catalog.records) {
    if (record.document.state !== "active") continue;
    if (urls[record.document.fileName]) throw new Error(`Two active assets are named ${record.document.fileName}.`);
    urls[record.document.fileName] = assetAuthoringUrl(record.id);
  }
  return urls;
}

export async function readAssetManifest(packageRoot: string): Promise<AssetManifestEntry[]> {
  const raw: unknown = JSON.parse(await readFile(resolve(packageRoot, ASSET_MANIFEST_FILE), "utf8"));
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "object" || entry === null || typeof (entry as AssetManifestEntry).file !== "string")) {
    throw new Error(`${ASSET_MANIFEST_FILE} must be a JSON list of { "file": string, "note"?: string }.`);
  }
  return raw as AssetManifestEntry[];
}

/** Idempotent: a file whose name and checksum already exist — active, trashed or historical — is skipped. */
export async function seedAssets(packageRoot: string, manifest: readonly AssetManifestEntry[]): Promise<{ added: number; skipped: number }> {
  const store = await createFilesystemAssetStore({ assetsStoreRoot: resolve(packageRoot, "cms/assets") });
  let added = 0;
  for (const entry of manifest) {
    const fileName = entry.file.split("/").at(-1)!;
    const bytes = await readFile(resolve(packageRoot, "images-src", entry.file));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const declaredMimeType = assetMimeTypeForExtension(fileName.slice(fileName.lastIndexOf(".") + 1));
    if (declaredMimeType === undefined) throw new Error(`No Assets MIME contract for seed file: ${entry.file}`);
    const snapshot = await store.snapshot();
    if (snapshot.records.some(({ document }) => document.fileName === fileName && document.versions.some((version) => version.checksum === checksum))) continue;
    await store.upload({ fileName, bytes, declaredMimeType, note: entry.note ?? entry.alt ?? "", expectedMutationToken: snapshot.mutationToken });
    added++;
  }
  return { added, skipped: manifest.length - added };
}

interface RunResult { status: number | null; stdout: string; stderr: string }

function run(command: string, args: string[], options: { cwd: string; input: string; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  return new Promise((settle, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (status) => settle({ status, stdout, stderr }));
    child.stdin.end(options.input);
  });
}

/** The installed tool's bin, resolved from the package root exactly as `pnpm dev` would. */
export function resolveComposerBin(packageRoot: string): string {
  const manifestPath = createRequire(join(resolve(packageRoot), "package.json")).resolve("zudo-composer/package.json");
  return join(dirname(manifestPath), "bin/zudo-composer.mjs");
}

export interface ReleaseCall {
  (request: SiteProjectApiRequest): Promise<unknown>;
}

/** One JSON request in, one canonical JSON response out, with cwd = the package root. */
export function createReleaseCall(packageRoot: string, env?: NodeJS.ProcessEnv): ReleaseCall {
  const bin = resolveComposerBin(packageRoot);
  return async (request) => {
    const result = await run(process.execPath, [bin, "release"], { cwd: packageRoot, input: `${JSON.stringify(request)}\n`, env });
    if (result.status !== 0) throw new Error(`${request.operation} exited ${result.status}: ${result.stderr || result.stdout}`);
    let response: SiteProjectApiResponse;
    try { response = JSON.parse(result.stdout) as SiteProjectApiResponse; }
    catch (error) { throw new Error(`${request.operation} did not return one JSON response: ${result.stdout}`, { cause: error }); }
    if (!response.ok) throw new Error(`${request.operation} was rejected: ${JSON.stringify(response.error)}`);
    return response.result;
  };
}

export interface SeedReleaseResult { projectId: string; revision: string; buildId: string }

/**
 * plan → apply → build → activate, publishing every content entry. Re-running
 * against an already-activated package replaces the active triple (the CAS
 * precondition is the current one), so a regenerated aggregate can be re-seeded.
 */
export async function seedRelease(packageRoot: string, options: { project?: SiteProject; call?: ReleaseCall } = {}): Promise<SeedReleaseResult> {
  const root = resolve(packageRoot);
  const call = options.call ?? createReleaseCall(root);
  const project = options.project ?? await readSiteProjectFile(root);
  // Both preconditions are CAS values the store compares verbatim: the
  // project's current head (null before the first apply) and the active triple.
  const state = (await call({ protocolVersion: 2, operation: "list" })) as { projects: readonly SiteProjectListEntry[]; active: SiteProjectActiveSelection | null };
  const expectedRevision = state.projects.find((entry) => entry.projectId === project.id)?.head ?? null;
  const expectedActive = state.active;
  const plan = (await call({
    protocolVersion: 2,
    operation: "plan",
    project,
    workingPrecondition: null,
    selection: project.providers.content.flatMap((provider) => provider.entries.map((entry) => ({ ref: { providerId: provider.id, modelId: entry.modelId, recordId: entry.id }, action: "publish" as const }))),
    expectedRevision,
    expectedActive,
  })) as ReleasePlan;
  const applied = (await call({ protocolVersion: 2, operation: "apply", plan })) as { revision: string; buildId: string };
  if (typeof applied.revision !== "string" || !/^[a-f0-9]{64}$/u.test(applied.revision)) throw new Error("The release CLI did not return a revision digest.");
  await call({ protocolVersion: 2, operation: "build", projectId: project.id, buildId: applied.buildId });
  await call({ protocolVersion: 2, operation: "activate", projectId: project.id, revision: applied.revision, buildId: applied.buildId, expectedActive });
  return { projectId: project.id, revision: applied.revision, buildId: applied.buildId };
}
