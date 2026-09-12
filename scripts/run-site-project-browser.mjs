// @ts-check

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** @typedef {import("node:child_process").SpawnOptions} SpawnOptions */
/** @typedef {{status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}} RunResult */

const root = resolve(import.meta.dirname, "..");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {({input?: string} & SpawnOptions)} [runOptions]
 * @returns {Promise<RunResult>}
 */
function run(command, args, { input, ...options } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal, stdout, stderr }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

// `realpath` is harmless here, not required: the store accepts a root behind
// a symlinked ancestor (e.g. macOS `os.tmpdir()` -> `/private/var/folders/...`).
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-site-project-browser-")));
try {
  const releaseRoot = join(temporaryRoot, "release");
  const assetsRoot = join(temporaryRoot, "assets");
  // The data root covers content, mappings, sitemaps and the workspace
  // registry. Without it the lane seeds its workspace into THIS repository's
  // `cms/`, which both leaves state behind and makes the run order matter.
  const dataRoot = join(temporaryRoot, "data");
  await Promise.all([mkdir(releaseRoot), mkdir(assetsRoot), mkdir(dataRoot)]);
  const environment = { ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_ASSETS_STORE_ROOT: assetsRoot, ZUDO_DATA_ROOT: dataRoot };
  const seeded = await run(process.execPath, [join(root, "bin/zudo-composer.mjs"), "seed", "--from", join(root, "src/test/site-project-fixture.json")], {
    env: { ...process.env, ...environment },
  });
  if (seeded.status !== 0) throw new Error(`seed exited ${seeded.status}: ${seeded.stderr || seeded.stdout}`);

  const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await run(playwright, ["exec", "playwright", "test", "--config", "playwright.site-project.config.ts", "tests/browser/site-project-acceptance.pw.ts"], {
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
