// @ts-check

// The canonical entry for the installed-host browser lane.
//
// Builds one disposable host project under the OS temporary directory, activates
// the sample SiteProject into it through the package's own `zudo-composer
// seed` CLI, runs the lane against `zudo-composer dev`, and removes the whole
// tree. Nothing the lane authors touches this repository, and nothing survives
// the run.
//
// The activation step is what the retired `dist` lane got for free from the
// bundled sample: without an activated project every library initializes into
// "No development SiteProject is activated" and renders no table, so a listing
// proof would have nothing to look at. Booting with NO activation is a separate
// claim, and `smoke-host-install.mjs` is where it is made.

import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** @typedef {import("node:child_process").SpawnOptions} SpawnOptions */
/** @typedef {{status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}} RunResult */
/** @typedef {{devDependencies: Record<string, string>, peerDependencies: Record<string, string>}} PackageManifest */

const root = resolve(import.meta.dirname, "..");
// Extra arguments pass straight through to Playwright, so a single spec can be
// re-run against a real host fixture (`... -- tests/browser/x.pw.ts -g "name"`).
// Without this the whole lane is the only way to reproduce one failure.
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--");

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

/**
 * The smallest tree `zudo-composer dev` can be rooted at: its own `cms/`, its
 * own static directory, its own `node_modules`, and the config and stylesheet
 * copied from `fixtures/host` so the two hosts cannot drift apart.
 *
 * The symlinks are what an install produces. `zudo-composer` is the package
 * itself; the component pack and Preact peer are resolved from the HOST root.
 */
/** @param {string} parent */
function createHostFixture(parent) {
  const hostRoot = join(parent, "host");
  for (const directory of ["node_modules", "styles", "public/uploaded-assets",
    "cms/compositions", "cms/content", "cms/mappings", "cms/sitemaps", "cms/assets"]) {
    mkdirSync(join(hostRoot, directory), { recursive: true });
  }
  symlinkSync(root, join(hostRoot, "node_modules/zudo-composer"), "dir");
  symlinkSync(join(root, "node_modules/@zudo-sg"), join(hostRoot, "node_modules/@zudo-sg"), "dir");
  symlinkSync(join(root, "node_modules/preact"), join(hostRoot, "node_modules/preact"), "dir");
  for (const file of ["zudo-composer.config.ts", "styles/base.css"]) {
    cpSync(join(root, "fixtures/host", file), join(hostRoot, file));
  }
  cpSync(join(root, "packages/demo-studio/site-project.json"), join(hostRoot, "site-project.json"));
  // The manifest is generated rather than copied, because a release attests how
  // its pack was installed and therefore reads the pack's dependency spec out of
  // the HOST manifest. The spec is taken from this package's own manifest so the
  // two cannot drift.
  const manifest = /** @type {PackageManifest} */ (JSON.parse(readFileSync(join(root, "package.json"), "utf8")));
  const packPackage = "@zudo-sg/ui";
  writeFileSync(join(hostRoot, "package.json"), `${JSON.stringify({
    name: "zudo-composer-host-browser-fixture",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: { dev: "zudo-composer dev" },
    devDependencies: {
      "zudo-composer": "workspace:*",
      [packPackage]: manifest.devDependencies[packPackage],
      preact: manifest.peerDependencies.preact,
    },
  }, null, 2)}\n`);
  return hostRoot;
}

/** @param {string} hostRoot */
async function activateSampleProject(hostRoot) {
  const result = await run(process.execPath, [join(root, "bin/zudo-composer.mjs"), "seed"], { cwd: hostRoot });
  if (result.status !== 0) throw new Error(`seed exited ${result.status}: ${result.stderr || result.stdout}`);
}

/**
 * One spec file, one host project.
 *
 * Each target invocation owns a fresh server and host project. Explicitly
 * grouped named specs share that host state. The automatic host fixture checks
 * every adopted document transition in its own test: fresh pages, later routes,
 * reloads, desktop/coarse projects and replacement workers all receive the
 * same bounded semantic-readiness policy. Listener readiness is separate.
 *
 * Authored state used to be per browser CONTEXT — an IndexedDB database that
 * Playwright discarded with the page. It is a directory tree now, shared by
 * every spec the same server answers, so one spec's renames and binding edits
 * are the next spec's starting position. Giving each file its own tree and its
 * own server restores the isolation the storage change took away; ordering
 * inside a file is still the file's own business.
 */
const SPEC_FILES = readdirSync(join(root, "tests/browser"))
  .filter((name) => name.endsWith(".pw.ts") && name !== "site-project-acceptance.pw.ts")
  .sort()
  .map((name) => `tests/browser/${name}`);

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
      `--output=test-results/playwright-host/${file.slice("tests/browser/".length, -".pw.ts".length)}`,
      ...playwrightArgs,
    ]);

for (const target of specTargets) {
  // `realpath` matters rather than being cosmetic: macOS `os.tmpdir()` is a
  // symlink, and the lane compares this root against Vite's own resolved paths.
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-host-browser-")));
  try {
    const hostRoot = createHostFixture(temporaryRoot);
    await activateSampleProject(hostRoot);
    const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = await run(playwright, ["exec", "playwright", "test", "--config", "playwright.host.config.ts", ...target], {
      env: { ...process.env, ZUDO_COMPOSER_HOST_ROOT: hostRoot },
      stdio: "inherit",
    });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
