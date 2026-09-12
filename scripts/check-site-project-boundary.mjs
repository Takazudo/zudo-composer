// @ts-check

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { AUTHORING_ROUTES, SITE_ROUTES, SPA_ROUTES } from "./routes.mjs";

const root = resolve(import.meta.dirname, "..");
/** @param {string} path */
const read = (path) => readFileSync(join(root, path), "utf8");
/** @param {string} path */
const readJson = (path) => JSON.parse(read(path));
const packageJson = readJson("package.json");
const vite = read("vite.config.ts");
const plugin = read("plugins/site-project-source-plugin.mjs");
const store = read("server/site-project-local/store.ts");
const roots = read("plugins/roots.mjs");
const browser = read("tests/browser/site-project-acceptance.pw.ts");
const runtimeFailures = read("tests/runtime-failures.ts");
const browserRunner = read("scripts/run-site-project-browser.mjs");
const browserConfig = read("playwright.site-project.config.ts");

assert.deepEqual(AUTHORING_ROUTES, ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/assets"]);
assert.deepEqual(SITE_ROUTES, [
  "/site",
  "/site/about",
  "/site/services",
  "/site/journal",
  "/site/journal/map-the-moving-parts",
  "/site/journal/review-in-small-loops",
  "/site/journal/start-with-the-question",
]);
assert.deepEqual(SPA_ROUTES, [...AUTHORING_ROUTES, ...SITE_ROUTES]);
for (const route of SITE_ROUTES) assert.ok(browser.includes(`"${route}"`) || browser.includes(`'${route}'`), `browser proof is missing ${route}`);
assert.ok(browser.includes("page.reload()"), "browser proof must include direct-refresh assertions");
// Both lanes share one watcher now, so the proof is that the spec uses it and
// that the watcher still watches both channels.
assert.ok(browser.includes("watchRuntimeFailures(page)"), "browser proof must collect runtime failures");
assert.ok(runtimeFailures.includes("requestfailed"), "the shared watcher must watch failed requests");
assert.ok(runtimeFailures.includes('message.type() !== "error"'), "the shared watcher must watch console errors");
assert.ok(browserRunner.includes("mkdtemp"), "browser runner must create an isolated local-project root");
assert.ok(browserRunner.includes("ZUDO_SITE_PROJECT_ROOT"), "browser runner must pass the isolated root to CLI and Vite");
assert.match(browserRunner, /\[join\(root, "bin\/zudo-composer\.mjs"\), "seed", "--from", /, "browser runner must activate its committed fixture through the installed seed command");
assert.match(read("scripts/run-host-browser.mjs"), /\[join\(root, "bin\/zudo-composer\.mjs"\), "seed"\]/, "host browser runner must use the installed seed command");
const demoSeedCommand = "zudo-composer assets import images-src/manifest.json && zudo-composer seed";
const demoHosts = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("demo-"))
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(root, "packages", name, "package.json"))
    && ["ts", "mts", "js", "mjs", "cts", "cjs"].some((extension) => existsSync(join(root, "packages", name, `zudo-composer.config.${extension}`))))
  .sort();
assert.ok(demoHosts.length > 0, "at least one demo host must use the installed seed commands");
for (const name of demoHosts) {
  const file = `packages/${name}/package.json`;
  assert.equal(readJson(file).scripts?.seed, demoSeedCommand, `${file} must use the installed asset-import and seed commands`);
}
for (const file of ["scripts/run-site-project-browser.mjs", "scripts/run-host-browser.mjs"]) {
  assert.doesNotMatch(read(file), /operation:\s*["'](?:plan|apply|build|activate)["']/, "release orchestration must remain in the seed service");
}
assert.ok(browserRunner.includes("env: { ...process.env, ...environment }"), "browser runner must preserve the parent process environment");
assert.ok(browserConfig.includes("reuseExistingServer: false"), "isolated dev browser config must own its server");
assert.ok(browserConfig.includes("workers: 1"), "isolated browser config must use one deterministic worker");

// The committed-assets static root moves with the host config: pinning a
// literal here would re-hardcode the directory `publicAssetsDir` exists to move.
assert.ok(
  vite.includes("publicDir: resolvePublicDir(composerConfig.workspaceRoot, composerConfig.paths.publicAssets)"),
  "Vite dev server must expose the host's committed assets root, resolved from the config",
);
// Assets fall back to the host config through the same domain resolver every
// other CMS root uses, so the fallback is asserted where it is defined.
assert.ok(
  vite.includes("?? domainRoot('assets')") && vite.includes("dataRoot ? resolve(dataRoot, domain) : composerConfig.paths[domain]"),
  "Vite must resolve the Assets store root from the host config",
);
// The excluded pack name is DERIVED from the resolved config, never spelled
// out: pinning the literal here would quietly re-hardcode the provider that
// `pack` exists to make swappable.
assert.ok(
  vite.includes("exclude: [componentPack.identity.packageName, '@takazudo/zfb-md-wasm']"),
  "Vite dev optimizer must leave the configured pack and the WASM resource package in the normal asset graph",
);
assert.ok(vite.includes("componentPackPlugin({ workspaceRoot: composerConfig.workspaceRoot, pack: composerConfig.settings.pack })"), "Vite must resolve its component pack through the host config");
assert.match(plugin, /readActivatedSiteRelease/);
assert.match(plugin, /readActivatedSiteAssets/);
assert.match(plugin, /release:changed/);
assert.match(plugin, /export const siteProjectRevision/);
// One resolver, three consumers: the store, the source plugin's watcher and
// the release CLI. A private second computation is what let the watcher and the
// reader drift apart onto different release trees.
assert.match(plugin, /resolveSiteProjectLocalRoot\(workspaceRoot\)/);
assert.match(store, /resolveSiteProjectLocalRoot\(resolveWorkspaceRoot\(options\.workspaceRoot\), options\.testRoot\)/);
assert.match(roots, /SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT"/);
assert.match(roots, /process\.env\[SITE_PROJECT_LOCAL_ROOT_ENV\]/);
assert.match(roots, /resolve\(workspaceRoot, SITE_PROJECT_LOCAL_ROOT_NAME\)/);
assert.ok(read(".gitignore").includes(".zudo-site-project/"), "disposable local project state must remain ignored");

assert.equal(packageJson.scripts["site-project:api"], "tsx server/site-project-local/cli.ts");
assert.equal(packageJson.scripts["site-project:boundary"], "node scripts/check-site-project-boundary.mjs");
assert.equal(packageJson.scripts["test:browser:site-project"], "node scripts/run-site-project-browser.mjs");
const workflow = read(".github/workflows/ci.yml");
assert.ok(workflow.includes("pnpm test:browser:site-project\n"), "CI must run the isolated dev acceptance lane");

const forbiddenProductionMarkers = [
  ".zudo-site-project",
  "ZUDO_SITE_PROJECT_ROOT",
  "virtual:site-project-source",
  "readActivatedSiteProject",
  "readActivatedSiteRelease",
  "readActivatedSiteAssets",
  "SiteProjectApiService",
  "SiteProjectStoreAdapter",
  "createLocalSiteProjectStore",
  "createLocalSiteProjectApiService",
  "runSiteProjectCli",
  "server/site-project-local",
  "node:fs",
  "node:path",
  "node:os",
  "node:child_process",
  "active-build.json",
  "complete.json",
  "projects/",
  "builds/",
  "atomicApply",
  "atomicActivate",
  "atomicDiscard",
];
/** @param {string} directory @returns {string[]} */
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
if (existsSync(join(root, "dist"))) {
  const files = filesUnder(join(root, "dist"));
  const text = files.filter((path) => [".js", ".mjs", ".css", ".html"].includes(extname(path))).map((path) => readFileSync(path, "utf8")).join("\n");
  for (const marker of forbiddenProductionMarkers) assert.ok(!text.includes(marker), `production asset leaked SiteProject local marker: ${marker}`);
  assert.ok(statSync(join(root, "dist", "index.html")).isFile(), "production artifact must retain index.html");
}

for (const file of ["README.md", "CLAUDE.md", "docs/site-project.md"]) {
  const document = read(file);
  assert.match(document, /provider-scoped/i, `${file} must explain provider scope`);
  assert.match(document, /whole[- ]project/i, `${file} must explain complete-project apply`);
  assert.match(document, /active\s+(?:pointer|identity)/i, `${file} must explain active identity`);
  assert.match(document, /(?:CAS|compare-and-swap)/i, `${file} must explain conflict expectations`);
  assert.match(document, /immutable/i, `${file} must explain immutable builds`);
  assert.match(document, /diagnostic/i, `${file} must explain diagnostics`);
}

console.log("SiteProject boundary passed: exact routes, activated local source, disposable state, and browser proofs are wired.");
