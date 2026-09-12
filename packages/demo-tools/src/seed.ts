// Seeding a demo package: its committed Assets store, then an activated release.
//
// Assets go straight into the package's `cms/assets` through the tool's own
// filesystem store, preserving whatever an author already uploaded. The
// release goes through `zudo-composer seed`, which owns the release protocol
// and its CAS preconditions. On-disk CMS records are never written by hand.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { assetAuthoringUrl, assetMimeTypeForExtension } from "../../../src/assets/model";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";

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

export interface SeedReleaseResult { projectId: string; revision: string; buildId: string; status: "activated" | "unchanged" }

/** Seed the committed project through the installed tool's command. */
export async function seedRelease(packageRoot: string, options: { env?: NodeJS.ProcessEnv } = {}): Promise<SeedReleaseResult> {
  const root = resolve(packageRoot);
  const result = await run(process.execPath, [resolveComposerBin(root), "seed"], { cwd: root, input: "", env: options.env });
  if (result.status !== 0) throw new Error(`seed exited ${result.status}: ${result.stderr || result.stdout}`);
  const response = JSON.parse(result.stdout) as SeedReleaseResult;
  if (typeof response.projectId !== "string" || !/^[a-f0-9]{64}$/u.test(response.revision) || !/^[a-f0-9]{64}$/u.test(response.buildId)
    || !["activated", "unchanged"].includes(response.status)) throw new Error("The seed CLI did not return a release identity and status.");
  return response;
}
