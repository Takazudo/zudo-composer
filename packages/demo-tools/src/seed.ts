// Seeding a demo package: its committed Assets store, then an activated release.
//
// The installed tool owns both asset import and the release protocol. Host
// configuration selects the stores; on-disk CMS records are never written here.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { loadHostContext } from "zudo-composer/vite";

export const ASSET_MANIFEST_FILE = "images-src/manifest.json";

/**
 * Import a manifest through the public verb. Relative manifest paths belong to
 * the resolved host root; each source file belongs to the manifest directory.
 */
export async function seedAssets(packageRoot: string, manifestPath = ASSET_MANIFEST_FILE): Promise<{ added: number; skipped: number }> {
  const { composerConfig } = await loadHostContext({ workspaceRoot: resolve(packageRoot) });
  const root: string = composerConfig.workspaceRoot;
  const result = await run(process.execPath, [resolveComposerBin(root), "assets", "import", resolve(root, manifestPath), "--root", root], { cwd: root, input: "" });
  if (result.status !== 0) throw new Error(`assets import exited ${result.status}: ${result.stderr || result.stdout}`);
  const response = JSON.parse(result.stdout) as { ok?: boolean; result?: { added: number; skipped: number } };
  if (response.ok !== true || !response.result || !Number.isSafeInteger(response.result.added) || response.result.added < 0
    || !Number.isSafeInteger(response.result.skipped) || response.result.skipped < 0) throw new Error("The assets CLI did not return import counts.");
  return response.result;
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
