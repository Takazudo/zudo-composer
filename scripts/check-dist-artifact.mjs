// The built-artifact boundary: what `vite build` may and may not emit.
//
// Split out of `check-provider-boundary.mjs` because every assertion here needs
// a `dist/` on disk, while the provider identity half does not. Run
// `pnpm build` first.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const assetsDir = join(dist, "assets");

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

assert.ok(existsSync(dist) && statSync(dist).isDirectory(), `no build to check at ${dist} — run \`pnpm build\` first`);
const assetFiles = filesUnder(assetsDir);
const textAssets = assetFiles.filter((path) => [".js", ".mjs", ".css", ".html"].includes(extname(path)));
const assetText = textAssets.map((path) => readFileSync(path, "utf8")).join("\n");
const jsFiles = assetFiles.filter((path) => [".js", ".mjs"].includes(extname(path)));
const jsText = jsFiles.map((path) => readFileSync(path, "utf8")).join("\n");

for (const forbidden of [
  "fixture.section",
  "@zudo-composer/fixture-ui",
  "test-support",
  ".stories",
  "styleguide",
  "zudo-doc",
  "zfb app",
  "/src/",
  "/Users/",
  "sourceMappingURL",
]) {
  assert.ok(!assetText.includes(forbidden), `production artifact leaked forbidden marker: ${forbidden}`);
}
// Match the app's `@/…` module alias only when it is emitted as a string-like
// specifier. CodeMirror's style runtime legitimately contains the regular
// expression `/^@/`, whose closing slash creates the same two-byte sequence.
assert.doesNotMatch(
  assetText,
  /["'`]@\/[A-Za-z0-9_.-]/,
  "production artifact leaked forbidden module alias: @/",
);
for (const forbidden of [
  "virtual:composer-file-provider",
  "createComposerFileProviderMiddleware",
  "COMPOSER_FILE_PROVIDER_ENDPOINT",
  "MEDIA_FILE_PROVIDER_ENDPOINT",
  "/__zudo_composer_media_file_provider",
  "cms/media",
  "src/media/storage/file-provider/dev-server-entry.ts",
  "/__zudo_composer_file_provider",
  "x-zudo-composer-capability",
  "dev-server-entry",
  "storage/filesystem",
  "node:fs",
  "node:path",
  "zudo-composer-file-provider",
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
  "node:crypto",
  "node:os",
  "node:child_process",
  "active-build.json",
  "complete.json",
  "projects/",
  "builds/",
  "atomicApply",
  "atomicActivate",
  "atomicDiscard",
]) {
  assert.ok(!jsText.includes(forbidden), `client artifact leaked file-provider server capability: ${forbidden}`);
}

const previewJs = jsFiles.filter((path) => basename(path).startsWith("preview-entry-"));
assert.equal(previewJs.length, 1, "exactly one preview entry chunk must be emitted");
const previewGraph = new Set();
function collectJsGraph(path) {
  if (previewGraph.has(path)) return;
  previewGraph.add(path);
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']\.\/([^"']+)["']/g)) {
    const dependency = join(assetsDir, match[1]);
    if (jsFiles.includes(dependency)) collectJsGraph(dependency);
  }
}
collectJsGraph(previewJs[0]);
const previewText = [...previewGraph].map((path) => readFileSync(path, "utf8")).join("\n");
// Each marker is a string the HOST renders and the preview graph must not.
// A marker whose host string is deleted stops proving anything, so repoint it
// at a live one rather than dropping it: "Structure" is the Composer editor's
// own rail, "Add component…" its insert menu.
for (const forbidden of [
  "How the pieces connect",
  "Composition library",
  "Stored Content needs recovery",
  "Mapping library",
  "Add component…",
  "Back to Compositions",
  "file-provider",
]) {
  assert.ok(!previewText.includes(forbidden), `preview graph leaked host marker: ${forbidden}`);
}

const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
for (const match of indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (url.startsWith("http") || url.startsWith("data:")) continue;
  assert.ok(url.startsWith("/assets/"), `emitted index asset is not rooted under /assets: ${url}`);
  assert.ok(statSync(join(dist, url.slice(1))).isFile(), `emitted index asset is missing: ${url}`);
}

const wasm = assetFiles.filter((path) => extname(path) === ".wasm");
const glue = assetFiles.filter((path) => /zfb_md_wasm_render_glue.*\.mjs$/.test(basename(path)));
assert.equal(wasm.length, 1, "exactly one focused render WASM must be emitted");
assert.match(basename(wasm[0]), /^zfb_md_wasm_render_bg-.*\.wasm$/);
assert.equal(glue.length, 1, "exactly one focused render glue module must be emitted");
assert.ok(!assetFiles.some((path) => /compiler|full|parse|highlight-only/i.test(basename(path))), "non-focused markdown assets leaked");
assert.ok(!assetFiles.some((path) => extname(path) === ".map"), "production source maps must not be emitted");

for (const source of jsFiles.map((path) => readFileSync(path, "utf8"))) {
  for (const match of source.matchAll(/["'](\/[^"']+\.(?:js|mjs|css|wasm))(?:\?[^"']*)?["']/g)) {
    assert.ok(match[1].startsWith("/assets/"), `runtime asset URL is not rooted under /assets: ${match[1]}`);
  }
}

const cssFiles = assetFiles.filter((path) => extname(path) === ".css");
const css = cssFiles.map((path) => readFileSync(path, "utf8"));
const combinedCss = css.join("\n");
assert.ok(css.some((source) => source.includes(".cms-rail{")), "local app shell CSS was not emitted");
assert.ok(/--zc-topbar-h:\s*48px/.test(combinedCss), "shell topbar height contract was not emitted");
assert.ok(/--sg-header-h:\s*var\(\s*--zc-topbar-h\s*\)/.test(combinedCss), "editor height alias was not emitted");
// Proof that Tailwind scans THIS app's source, not just the installed
// provider's: one utility that appears in a local file and in no provider
// component. It is a pair — the source half guards the class from drifting out
// of the file, the CSS half proves the scan reached it. If the New-composition
// dialog stops using this class, REPOINT both halves at another local-only
// utility rather than deleting them, or the proof silently becomes vacuous.
// (`pr-[3.5rem]` held this role until epic #156 moved the dialog onto the
// shared `cms-` controls.)
// `min-w-48` cannot hold this role: it generates no CSS at all under this
// project's Tailwind theme, so the emission half could never pass. `min-h-0`
// is verified local-only — no file under node_modules/@zudo-sg/ui/src uses it,
// unlike flex-1 / w-full / min-w-0, whose emission would prove nothing about
// whether local source is scanned.
assert.ok(readFileSync(join(root, "src/features/composer/library/new-composition-dialog.tsx"), "utf8").includes("min-h-0"), "local Tailwind source proof drifted");
assert.ok(css.some((source) => source.includes(".min-h-0{")), "local-source Tailwind utility was not emitted");
assert.ok(readFileSync(join(root, "node_modules/@zudo-sg/ui/src/cards/callout/callout.tsx"), "utf8").includes("border-l-4"), "provider Tailwind source proof drifted");
assert.ok(css.some((source) => source.includes(".border-l-4{")), "installed-provider Tailwind utility was not emitted");
for (const [size, value] of Object.entries({ xs: ".75rem", sm: "1rem", md: "1.25rem", lg: "1.5rem" })) {
  assert.ok(combinedCss.includes(`--spacing-icon-${size}:${value}`), `built CSS is missing local icon token ${size}`);
  assert.ok(combinedCss.includes(`.w-icon-${size}{width:var(--spacing-icon-${size})}`), `built CSS is missing w-icon-${size}`);
  assert.ok(combinedCss.includes(`.h-icon-${size}{height:var(--spacing-icon-${size})}`), `built CSS is missing h-icon-${size}`);
}
// The pack's CSS has exactly ONE importer now — the host's `styles` entry,
// reached through `virtual:zudo-composer-host-styles` — so it is emitted once
// and shared by both entries rather than copied into each. Both still receive
// it — `main.tsx` imports it before `./style.css`, `preview-entry.ts` before its
// own sheet — and Vite hoists the link for that shared chunk into the entry.
const canonicalCss = cssFiles.filter((path) => readFileSync(path, "utf8").includes(".hi-kw{"));
assert.equal(canonicalCss.length, 1, "canonical pack CSS must be emitted exactly once");
assert.equal(count(readFileSync(canonicalCss[0], "utf8"), ".hi-kw{"), 1, "canonical pack CSS must not be duplicated inside its own asset");
const entryJs = jsFiles.filter((path) => basename(path).startsWith("index-"));
assert.equal(entryJs.length, 1, "exactly one application entry chunk must be emitted");
assert.ok(
  readFileSync(entryJs[0], "utf8").includes(basename(canonicalCss[0])),
  "the shared application entry must reference the canonical pack CSS, so host and preview both receive it",
);

console.log(`Dist artifact boundary passed: ${assetFiles.length} assets, ${wasm.length} WASM, ${glue.length} glue.`);
