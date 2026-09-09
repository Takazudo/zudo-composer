// @ts-check

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** @typedef {import("node:child_process").SpawnOptions} SpawnOptions */
/** @typedef {{status: number | null, signal: NodeJS.Signals | null}} RunResult */

const root = resolve(import.meta.dirname, "..");
// Extra arguments pass straight through to Playwright, so a single spec can be
// re-run against the lane's own disposable roots. Without this the whole lane is
// the only reproduction available.
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {SpawnOptions} options
 * @returns {Promise<RunResult>}
 */
function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal }));
  });
}

/**
 * One spec file, one set of roots.
 *
 * Authored state used to be per browser CONTEXT — an IndexedDB database that
 * Playwright discarded with the page. It is a directory tree now, shared by
 * every spec the same server answers, so one spec's uploads, models and
 * compositions are the next spec's starting position. Giving each file its own
 * roots and its own server restores the isolation the storage change took away;
 * ordering inside a file is still the file's own business.
 */
const SPEC_FILES = (await readdir(join(root, "tests/browser-dev")))
  .filter((name) => name.endsWith(".pw.ts"))
  .sort()
  .map((name) => `tests/browser-dev/${name}`);

/**
 * A run targeting named specs keeps them together; otherwise every file runs on
 * its own. Each run also gets its own output directory, because Playwright
 * clears that directory on start and would otherwise leave only the last file's
 * traces behind.
 */
const specTargets = playwrightArgs.some((argument) => argument.includes(".pw.ts"))
  ? [playwrightArgs]
  : SPEC_FILES.map((file) => [
      file,
      `--output=test-results/playwright-dev/${file.slice("tests/browser-dev/".length, -".pw.ts".length)}`,
      ...playwrightArgs,
    ]);

for (const target of specTargets) {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-dev-browser-")));
  try {
    const releaseRoot = join(temporaryRoot, "release"), assetsRoot = join(temporaryRoot, "assets"),
      compositionsRoot = join(temporaryRoot, "compositions"), dataRoot = join(temporaryRoot, "data");
    await Promise.all([mkdir(releaseRoot), mkdir(assetsRoot), mkdir(compositionsRoot), mkdir(dataRoot)]);
    // The data root covers content, mappings, sitemaps and the workspace registry.
    // Isolating compositions alone left the registry in this repository, so the
    // NEXT run opened a workspace whose composition tree had been deleted.
    const environment = { ...process.env, ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_ASSETS_STORE_ROOT: assetsRoot, ZUDO_COMPOSITIONS_ROOT: compositionsRoot, ZUDO_DATA_ROOT: dataRoot };
    const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = await run(playwright, ["exec", "playwright", "test", "--config", "playwright.dev.config.ts", ...target], { env: environment });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
