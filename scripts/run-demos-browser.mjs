// @ts-check
// `pnpm test:browser:demos`: for each demo host package, seed its release in
// place, boot its own `zudo-composer dev` on the shared demos port, crawl
// every compiled sitemap route plus one mock interaction, tear the server
// down, then move to the next demo. One demo at a time — like every other
// browser lane in this repository, this one owns a single machine-global
// port and none may run concurrently.
//
// The committed CMS is a ready workspace, so every CMS directory needs a
// disposable copy. `ZUDO_COMPOSER_DATA_DIR` rebases all four JSON domains and
// the workspace registry to a host-local temporary directory, while the
// absolute `ZUDO_ASSETS_STORE_ROOT` keeps the Assets copy on that same tree.
// Seed's derived release is separate again under `ZUDO_SITE_PROJECT_ROOT`; the
// lane never removes or mutates a developer's own `.zudo-site-project`.

import { spawn } from "node:child_process";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { loadHostConfig } from "../server/host-context.mjs";
import { resolveWorkspaceRegistryRoot } from "../plugins/workspace-domain-provider.mjs";
import { readVerifiedHostManifest } from "./host-site-routes.mjs";
import { DEMOS_LANE_DIRECTORY } from "./demos-lane-paths.mjs";

const root = resolve(import.meta.dirname, "..");

// Never one of the other browser lanes' ports.
const PORT = 4176;
const RESERVED_PORTS = [4173, 4174, 4175, 5173];
if (RESERVED_PORTS.includes(PORT)) throw new Error(`Demos lane port ${PORT} collides with an existing browser lane.`);

const DEMOS = ["webshop", "landing", "blog"];

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, capture?: boolean}} [options]
 * @returns {Promise<{status: number | null, signal: NodeJS.Signals | null, stdout: string}>}
 */
function run(command, args, { cwd = root, env, capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", env: env ?? process.env });
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal, stdout }));
  });
}

const ABSOLUTE_ROOT_NAMES = [
  "ZUDO_ASSETS_STORE_ROOT",
  "ZUDO_COMPOSITIONS_ROOT",
  "ZUDO_DATA_ROOT",
  "ZUDO_SITE_PROJECT_ROOT",
  "ZUDO_HOST_ROOT",
  "ZUDO_COMPOSER_HOST_ROOT",
];

/**
 * Keep both config-level and plugin-level root overrides inside this demo's
 * disposable tree. Config-level paths are host-relative by contract, while
 * the older absolute root variables are still inherited by some package
 * entrypoints and therefore must not be allowed to point at another host.
 *
 * @param {string} packageRoot
 * @param {string} disposableCmsRoot
 * @param {string} assetsStoreRoot
 * @param {string} disposableReleaseRoot
 * @returns {NodeJS.ProcessEnv}
 */
function isolatedEnvironment(packageRoot, disposableCmsRoot, assetsStoreRoot, disposableReleaseRoot) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("ZUDO_COMPOSER_")) delete environment[key];
  }
  for (const key of ABSOLUTE_ROOT_NAMES) delete environment[key];

  const disposableDataDir = relative(packageRoot, disposableCmsRoot).split(sep).join("/");
  Object.assign(environment, {
    ZUDO_COMPOSER_DATA_DIR: disposableDataDir,
    ZUDO_COMPOSER_COMPOSITIONS_DIR: posix.join(disposableDataDir, "compositions"),
    ZUDO_COMPOSER_CONTENT_DIR: posix.join(disposableDataDir, "content"),
    ZUDO_COMPOSER_MAPPINGS_DIR: posix.join(disposableDataDir, "mappings"),
    ZUDO_COMPOSER_SITEMAPS_DIR: posix.join(disposableDataDir, "sitemaps"),
    ZUDO_COMPOSER_ASSETS_DIR: posix.join(disposableDataDir, "assets"),
    ZUDO_COMPOSER_PUBLIC_ASSETS_DIR: "public/uploaded-assets",
    ZUDO_COMPOSER_STYLES: "styles/base.css",
    ZUDO_ASSETS_STORE_ROOT: assetsStoreRoot,
    ZUDO_COMPOSITIONS_ROOT: join(disposableCmsRoot, "compositions"),
    ZUDO_DATA_ROOT: disposableCmsRoot,
    ZUDO_SITE_PROJECT_ROOT: disposableReleaseRoot,
  });
  return environment;
}

/** @param {string} root @param {string} candidate @param {string} label */
function assertInside(root, candidate, label) {
  const path = resolve(candidate);
  const part = relative(root, path);
  if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw new Error(`[demos-lane] ${label} escaped the disposable CMS root: ${path}`);
  }
  return path;
}

/**
 * Resolve the same config that both the installed seed and host dev command
 * consume. This catches explicit config settings and inherited low-level root
 * overrides before either process can read or mutate the committed CMS.
 *
 * @param {string} packageRoot
 * @param {string} disposableCmsRoot
 * @param {string} assetsStoreRoot
 * @param {string} disposableReleaseRoot
 * @param {NodeJS.ProcessEnv} environment
 */
async function assertIsolatedRoots(packageRoot, disposableCmsRoot, assetsStoreRoot, disposableReleaseRoot, environment) {
  const composerConfig = await loadHostConfig(packageRoot, environment);
  const { paths } = composerConfig;
  const cmsPaths = {
    data: paths.data,
    compositions: paths.compositions,
    content: paths.content,
    mappings: paths.mappings,
    sitemaps: paths.sitemaps,
    assets: paths.assets,
    workspaces: resolveWorkspaceRegistryRoot(paths.data),
  };
  const expectedCmsPaths = {
    data: disposableCmsRoot,
    compositions: join(disposableCmsRoot, "compositions"),
    content: join(disposableCmsRoot, "content"),
    mappings: join(disposableCmsRoot, "mappings"),
    sitemaps: join(disposableCmsRoot, "sitemaps"),
    assets: assetsStoreRoot,
    workspaces: join(disposableCmsRoot, "workspaces"),
  };
  for (const [label, path] of Object.entries(cmsPaths)) {
    const resolvedPath = assertInside(disposableCmsRoot, path, label);
    const expectedPath = expectedCmsPaths[/** @type {keyof typeof expectedCmsPaths} */ (label)];
    if (resolvedPath !== resolve(expectedPath)) {
      throw new Error(`[demos-lane] ${label} did not resolve to its copied CMS directory: ${resolvedPath}`);
    }
  }
  if (resolve(paths.data) !== resolve(disposableCmsRoot)
    || resolve(paths.assets) !== resolve(assetsStoreRoot)
    || resolve(environment.ZUDO_ASSETS_STORE_ROOT ?? "") !== resolve(assetsStoreRoot)
    || resolve(environment.ZUDO_COMPOSITIONS_ROOT ?? "") !== resolve(paths.compositions)
    || resolve(environment.ZUDO_DATA_ROOT ?? "") !== resolve(paths.data)
    || resolve(environment.ZUDO_SITE_PROJECT_ROOT ?? "") !== resolve(disposableReleaseRoot)) {
    throw new Error("[demos-lane] resolved seed/dev roots did not match the disposable CMS and release roots.");
  }
  if (resolve(paths.publicAssets) !== resolve(packageRoot, "public/uploaded-assets")
    || resolve(paths.styles) !== resolve(packageRoot, "styles/base.css")) {
    throw new Error("[demos-lane] inherited host asset or style settings were not confined to this demo.");
  }
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = false;

for (const name of DEMOS) {
  const packageRoot = join(root, "packages", `demo-${name}`);
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-demos-browser-")));
  const disposableHostRoot = join(packageRoot, DEMOS_LANE_DIRECTORY);
  const disposableHostRunRoot = join(disposableHostRoot, basename(temporaryRoot));
  const disposableCmsRoot = join(disposableHostRunRoot, "cms");
  const disposableReleaseRoot = join(temporaryRoot, "release");
  try {
    await cp(join(packageRoot, "cms"), disposableCmsRoot, { recursive: true });
    const assetsStoreRoot = join(disposableCmsRoot, "assets");
    const environment = isolatedEnvironment(packageRoot, disposableCmsRoot, assetsStoreRoot, disposableReleaseRoot);
    await assertIsolatedRoots(packageRoot, disposableCmsRoot, assetsStoreRoot, disposableReleaseRoot, environment);

    console.log(`\n[demos-lane] Seeding demo-${name}…`);
    const seeded = await run(pnpm, ["run", "seed"], { cwd: packageRoot, env: environment });
    if (seeded.status !== 0) throw new Error(`Seeding demo-${name} exited ${seeded.status}.`);

    const { routes } = await readVerifiedHostManifest(packageRoot, { env: environment });
    console.log(`[demos-lane] demo-${name}: ${routes.length} routes to crawl on port ${PORT}.`);

    const playwrightEnv = { ...environment, DEMOS_LANE_NAME: name, DEMOS_LANE_ROUTES: JSON.stringify(routes) };
    const tested = await run(pnpm, ["exec", "playwright", "test", "--config", "playwright.demos.config.ts"], { env: playwrightEnv });
    if (tested.status !== 0) failed = true;
  } finally {
    await rm(disposableHostRunRoot, { recursive: true, force: true });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
if (failed) process.exitCode = 1;
