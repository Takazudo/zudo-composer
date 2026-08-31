import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { AUTHORING_ROUTES, SITE_ROUTES, SPA_ROUTES } from "./deployment-artifact-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const packageJson = readJson("package.json");
const wrangler = readJson("wrangler.jsonc");
const vite = read("vite.config.ts");
const plugin = read("plugins/site-project-source-plugin.mjs");
const store = read("server/site-project-local/store.ts");
const browser = read("tests/browser/site-project-acceptance.pw.ts");
const browserRunner = read("scripts/run-site-project-browser.mjs");
const browserConfig = read("playwright.site-project.config.ts");
const browserDistConfig = read("playwright.site-project-dist.config.ts");

assert.deepEqual(AUTHORING_ROUTES, ["/", "/composer", "/composer/preview", "/content", "/mapping", "/sitemapper", "/media"]);
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
assert.ok(browser.includes("requestfailed"), "browser proof must watch failed requests");
assert.ok(browser.includes("console"), "browser proof must watch console errors");
assert.ok(browserRunner.includes("mkdtemp"), "browser runner must create an isolated local-project root");
assert.ok(browserRunner.includes("ZUDO_SITE_PROJECT_ROOT"), "browser runner must pass the isolated root to CLI and Vite");
assert.ok(browserRunner.includes('operation: "apply"'), "browser runner must apply through the JSON CLI");
assert.ok(browserRunner.includes('operation: "activate"'), "browser runner must activate through the JSON CLI");
assert.ok(browserRunner.includes('"dist", "index.html"'), "production browser runner must consume an existing build");
assert.ok(browserRunner.includes('"playwright.site-project-dist.config.ts"'), "production browser runner must use the Wrangler config");
assert.ok(browserRunner.includes("env: { ...process.env, ...environment }"), "browser runner must preserve the parent process environment");
assert.doesNotMatch(browserRunner, /\b(?:pnpm|npm)\s+(?:run\s+)?build\b/, "browser lanes must not rebuild the production artifact");
assert.ok(browserConfig.includes("reuseExistingServer: false"), "isolated dev browser config must own its server");
assert.ok(browserConfig.includes("workers: 1"), "isolated browser config must use one deterministic worker");
assert.ok(browserDistConfig.includes("wrangler dev --local"), "production browser config must use local Wrangler");
assert.ok(browserDistConfig.includes('CLOUDFLARE_API_TOKEN: ""'), "production browser config must be unauthenticated");

assert.ok(vite.includes("bundledProject"), "Vite config must inject an explicit bundled SiteProject");
assert.ok(vite.includes("bundledRevision"), "Vite config must inject the bundled project's canonical revision");
assert.ok(vite.includes("sample-site-project.json"), "Vite config must point at the checked-in sample");
assert.ok(vite.includes("publicDir: 'media-store/public'"), "Vite dev server must expose the Media public asset root");
assert.ok(vite.includes("exclude: ['@zudo-sg/ui', '@takazudo/zfb-md-wasm']"), "Vite dev optimizer must leave provider and WASM resource packages in the normal asset graph");
assert.match(plugin, /if \(command === "build"\) return serializedModule\(options\.bundledProject, options\.bundledRevision\)/);
assert.match(plugin, /export const siteProjectRevision/);
assert.match(plugin, /readActivatedSiteProject/);
assert.match(plugin, /process\.env\.ZUDO_SITE_PROJECT_ROOT/);
assert.match(store, /SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT"/);
assert.match(store, /options\.testRoot \?\? configuredLocalRoot\(\)/);
assert.ok(read(".gitignore").includes(".zudo-site-project/"), "disposable local project state must remain ignored");

assert.equal(packageJson.scripts["site-project:api"], "tsx server/site-project-local/cli.ts");
assert.equal(packageJson.scripts["site-project:boundary"], "node scripts/check-site-project-boundary.mjs");
assert.equal(packageJson.scripts["test:browser:site-project"], "node scripts/run-site-project-browser.mjs --dev");
assert.equal(packageJson.scripts["test:browser:site-project:dist"], "node scripts/run-site-project-browser.mjs --dist");
const workflow = read(".github/workflows/ci.yml");
assert.ok(workflow.includes("pnpm test:browser:site-project\n"), "CI must run the isolated dev acceptance lane");
assert.ok(workflow.includes("pnpm test:browser:site-project:dist\n"), "CI must run the no-rebuild production acceptance lane");

const allowedWranglerKeys = ["$schema", "name", "compatibility_date", "workers_dev", "preview_urls", "assets", "routes"].sort();
assert.deepEqual(Object.keys(wrangler).sort(), allowedWranglerKeys, "Worker config must remain assets-only");
assert.equal(wrangler.assets.directory, "./dist");
assert.equal(wrangler.assets.not_found_handling, "single-page-application");
assert.ok(!Object.hasOwn(wrangler, "main"), "Worker must not claim a main entry");
assert.ok(!Object.hasOwn(wrangler, "bindings"), "Worker must not claim bindings");
assert.ok(!Object.hasOwn(wrangler, "vars"), "Worker must not claim backend variables");

const forbiddenProductionMarkers = [
  ".zudo-site-project",
  "ZUDO_SITE_PROJECT_ROOT",
  "virtual:site-project-source",
  "readActivatedSiteProject",
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
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "active-build.json",
  "complete.json",
  "projects/",
  "builds/",
  "atomicApply",
  "atomicActivate",
  "atomicDiscard",
];
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
  assert.match(document, /Cloudflare[\s\S]{0,160}(?:future|not a claim)/i, `${file} must mark hosted persistence/API/auth as future work`);
}

console.log("SiteProject boundary passed: exact routes, bundled-vs-local source, assets-only Worker, disposable state, and browser proofs are wired.");
