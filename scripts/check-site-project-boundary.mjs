import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { AUTHORING_ROUTES, SITE_ROUTES, SPA_ROUTES } from "./routes.mjs";
import { resolveLocalReleaseToolchain } from "../server/site-project-local/toolchain-config.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(`${canonical(value)}\n`).digest("hex");
const packageJson = readJson("package.json");
const vite = read("vite.config.ts");
const bundledRelease = readJson("artifacts/site-release/bundled-release.json");
const plugin = read("plugins/site-project-source-plugin.mjs");
const store = read("server/site-project-local/store.ts");
const browser = read("tests/browser/site-project-acceptance.pw.ts");
const browserRunner = read("scripts/run-site-project-browser.mjs");
const browserConfig = read("playwright.site-project.config.ts");

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
assert.ok(browserRunner.includes("env: { ...process.env, ...environment }"), "browser runner must preserve the parent process environment");
assert.ok(browserConfig.includes("reuseExistingServer: false"), "isolated dev browser config must own its server");
assert.ok(browserConfig.includes("workers: 1"), "isolated browser config must use one deterministic worker");

assert.ok(vite.includes("bundled-release.json"), "Vite config must inject an explicit completed bundled release artifact");
assert.ok(vite.includes("bundledSource"), "Vite config must pass the immutable bundled delivery source");
assert.ok(vite.includes("resolveLocalReleaseToolchain"), "Vite config must resolve the current installed release toolchain");
assert.ok(vite.includes("currentToolchain"), "Vite config must reject a stale bundled runtime attestation");
assert.equal(bundledRelease.status, "ready");
assert.ok(bundledRelease.artifact?.toolchain?.installedProviderDigest, "Bundled release must retain its installed runtime attestation");
assert.deepEqual(bundledRelease.artifact.toolchain, await resolveLocalReleaseToolchain(), "Bundled release must attest the exact current installed runtime");
assert.equal(bundledRelease.artifact.completionDigest, digest({ identity: bundledRelease.artifact.identity, files: bundledRelease.artifact.files }), "Bundled completion digest must bind its identity and files");
assert.equal(bundledRelease.artifact.files["build.json"], digest(bundledRelease.artifact.build), "Bundled build digest must bind the embedded compiled plan");
assert.ok(!existsSync(join(root, "src/features/delivery/bundled-release.json")), "Bundled release data must stay outside the application source boundary");
assert.ok(vite.includes("publicDir: 'media-store/public'"), "Vite dev server must expose the Media public asset root");
assert.ok(vite.includes("exclude: ['@zudo-sg/ui', '@takazudo/zfb-md-wasm']"), "Vite dev optimizer must leave provider and WASM resource packages in the normal asset graph");
assert.match(plugin, /command === "build" \? options\.bundledSource : await delivery\(\)/);
assert.match(plugin, /readActivatedSiteRelease/);
assert.match(plugin, /readActivatedSiteMedia/);
assert.match(plugin, /release:changed/);
assert.match(plugin, /export const siteProjectRevision/);
assert.match(plugin, /process\.env\.ZUDO_SITE_PROJECT_ROOT/);
assert.match(store, /SITE_PROJECT_LOCAL_ROOT_ENV = "ZUDO_SITE_PROJECT_ROOT"/);
assert.match(store, /options\.testRoot \?\? configuredLocalRoot\(\)/);
assert.ok(read(".gitignore").includes(".zudo-site-project/"), "disposable local project state must remain ignored");

assert.equal(packageJson.scripts["site-project:api"], "tsx server/site-project-local/cli.ts");
assert.equal(packageJson.scripts["site-project:boundary"], "node scripts/check-site-project-boundary.mjs");
assert.equal(packageJson.scripts["site-project:bundle"], "tsx scripts/generate-bundled-release.ts --write");
assert.equal(packageJson.scripts["site-project:bundle:check"], "tsx scripts/generate-bundled-release.ts --check");
assert.equal(packageJson.scripts["test:browser:site-project"], "node scripts/run-site-project-browser.mjs --dev");
const workflow = read(".github/workflows/ci.yml");
assert.ok(workflow.includes("pnpm test:browser:site-project\n"), "CI must run the isolated dev acceptance lane");

const forbiddenProductionMarkers = [
  ".zudo-site-project",
  "ZUDO_SITE_PROJECT_ROOT",
  "virtual:site-project-source",
  "readActivatedSiteProject",
  "readActivatedSiteRelease",
  "readActivatedSiteMedia",
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
}

console.log("SiteProject boundary passed: exact routes, bundled-vs-local source, disposable state, and browser proofs are wired.");
