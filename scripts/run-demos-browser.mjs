// @ts-check
// `pnpm test:browser:demos`: for each demo host package, seed its release in
// place, boot its own `zudo-composer dev` on the shared demos port, crawl
// every compiled sitemap route plus one mock interaction, tear the server
// down, then move to the next demo. One demo at a time — like every other
// browser lane in this repository, this one owns a single machine-global
// port and none may run concurrently.
//
// Only the committed Assets store needs a disposable copy: `seed`'s release
// step and `zudo-composer dev` both honor `ZUDO_ASSETS_STORE_ROOT`, so
// pointing it at a temporary copy keeps `cms/assets/catalog.json` untouched.
// Every other CMS directory a demo writes (`.zudo-site-project/`,
// `cms/{compositions,content,mappings,sitemaps}`) is already gitignored and
// reseeded in place, exactly as running `pnpm --filter demo-<name> seed` by
// hand would leave it.

import { spawn } from "node:child_process";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");

// Never one of the other browser lanes' ports.
const PORT = 4176;
const RESERVED_PORTS = [4173, 4174, 4175, 5173];
if (RESERVED_PORTS.includes(PORT)) throw new Error(`Demos lane port ${PORT} collides with an existing browser lane.`);

const DEMOS = ["webshop", "landing", "blog"];

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{env?: NodeJS.ProcessEnv, capture?: boolean}} [options]
 * @returns {Promise<{status: number | null, signal: NodeJS.Signals | null, stdout: string}>}
 */
function run(command, args, { env, capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", env: env ?? process.env });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal, stdout }));
  });
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = false;

for (const name of DEMOS) {
  const packageRoot = join(root, "packages", `demo-${name}`);
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-demos-browser-")));
  try {
    const assetsStoreRoot = join(temporaryRoot, "assets");
    await cp(join(packageRoot, "cms/assets"), assetsStoreRoot, { recursive: true });
    const environment = { ...process.env, ZUDO_ASSETS_STORE_ROOT: assetsStoreRoot };

    // Gitignored release state, cleared before every run: seeding a package
    // that is already active with the exact same intent is rejected as
    // "nothing to publish", which a fresh CI checkout never sees but a
    // developer re-running this lane locally would.
    await rm(join(packageRoot, ".zudo-site-project"), { recursive: true, force: true });

    console.log(`\n[demos-lane] Seeding demo-${name}…`);
    const seeded = await run(pnpm, ["--filter", `demo-${name}`, "seed"], { env: environment });
    if (seeded.status !== 0) throw new Error(`Seeding demo-${name} exited ${seeded.status}.`);

    const routesResult = await run(process.execPath, ["--import", "tsx", "server/site-build/print-routes.ts", packageRoot, assetsStoreRoot], { env: environment, capture: true });
    if (routesResult.status !== 0) throw new Error(`Route discovery for demo-${name} exited ${routesResult.status}.`);
    /** @type {string[]} */
    const routes = JSON.parse(routesResult.stdout);
    console.log(`[demos-lane] demo-${name}: ${routes.length} routes to crawl on port ${PORT}.`);

    const playwrightEnv = { ...environment, DEMOS_LANE_NAME: name, DEMOS_LANE_ROUTES: JSON.stringify(routes) };
    const tested = await run(pnpm, ["exec", "playwright", "test", "--config", "playwright.demos.config.ts"], { env: playwrightEnv });
    if (tested.status !== 0) failed = true;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
if (failed) process.exitCode = 1;
