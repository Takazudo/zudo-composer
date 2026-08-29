import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const assetsDir = join(dist, "assets");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const providerPackage = JSON.parse(readFileSync(join(root, "node_modules/@zudo-sg/ui/package.json"), "utf8"));
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const packSource = readFileSync(join(root, "node_modules/@zudo-sg/ui/src/composer-pack.ts"), "utf8");

const providerSha = "fe3fc62d3f677f321f5eb7814240d4a55dc92cd0";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;
const expectedIds = [
  "ui.callout",
  "ui.card",
  "ui.prose-md",
  "ui.prose-p",
  "ui.placeholder-box",
  "ui.auto-grid",
  "ui.container",
  "ui.cta-button",
  "ui.hero",
  "ui.section-heading",
  "ui.split-layout",
  "ui.stack",
];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

assert.equal(packageJson.dependencies["@zudo-sg/ui"], providerSpec, "provider dependency must use the exact Git SHA");
assert.match(lock, new RegExp(`@zudo-sg/ui@[^\\n]*${providerSha}`), "lockfile must retain the exact provider SHA");
const providerLockLines = lock.split("\n").filter((line) => /@zudo-sg\/ui|codeload\.github\.com\/Takazudo\/zudo-sg/.test(line)).join("\n");
assert.doesNotMatch(
  `${packageJson.dependencies["@zudo-sg/ui"]}\n${providerLockLines}`,
  /(?:file|link|path):|packages\/ui|\/Users\/|[A-Za-z]:\\\\/,
  "provider provenance must not use a local/sibling path",
);
assert.equal(providerPackage.version, "0.1.0", "installed package metadata version drifted");
assert.match(packSource, /packId:\s*["']@zudo-sg\/ui["']/);
assert.match(packSource, /packVersion:\s*["']1\.0\.0["']/);

const sidecars = [...packSource.matchAll(/from\s+["'](\.\/[^"']+\.composer)["']/g)]
  .map((match) => join(root, "node_modules/@zudo-sg/ui/src", `${match[1]}.tsx`));
assert.equal(sidecars.length, 12, "provider pack must contain exactly 12 sidecars");
const identities = sidecars.map((path) => {
  const source = readFileSync(path, "utf8");
  const id = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
  const schemaVersion = Number(source.match(/\bschemaVersion:\s*(\d+)/)?.[1]);
  return { id, schemaVersion };
});
assert.deepEqual(identities.map(({ id }) => id), expectedIds, "provider component IDs/order drifted");
assert.ok(identities.every(({ schemaVersion }) => schemaVersion === 1), "all provider schemas must remain v1");

assert.ok(statSync(dist).isDirectory(), "dist must exist; run the production build first");
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
  "@/",
  "/Users/",
  "sourceMappingURL",
]) {
  assert.ok(!assetText.includes(forbidden), `production artifact leaked forbidden marker: ${forbidden}`);
}
for (const forbidden of [
  "virtual:composer-file-provider",
  "createComposerFileProviderMiddleware",
  "COMPOSER_FILE_PROVIDER_ENDPOINT",
  "node:fs",
  "node:path",
  "zudo-composer-file-provider",
]) {
  assert.ok(!jsText.includes(forbidden), `client artifact leaked file-provider server capability: ${forbidden}`);
}

const previewJs = jsFiles.filter((path) => basename(path).startsWith("preview-entry-"));
assert.equal(previewJs.length, 1, "exactly one preview entry chunk must be emitted");
const previewText = readFileSync(previewJs[0], "utf8");
for (const forbidden of ["Build structures, not documents.", "Composition library", "Add component…", "file-provider"]) {
  assert.ok(!previewText.includes(forbidden), `preview entry leaked host marker: ${forbidden}`);
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

const cssFiles = assetFiles.filter((path) => extname(path) === ".css");
const css = cssFiles.map((path) => readFileSync(path, "utf8"));
assert.ok(css.some((source) => source.includes(".app-header{")), "local app CSS was not emitted");
assert.ok(css.some((source) => source.includes(".min-w-0{")), "local Tailwind utility was not emitted");
assert.ok(css.some((source) => source.includes(".px-hsp-lg{")), "installed provider Tailwind utility was not emitted");
assert.equal(css.reduce((total, source) => total + count(source, ".hi-kw{"), 0), 2, "canonical provider CSS must occur once in each host/preview graph");
assert.equal(css.filter((source) => source.includes(".hi-kw{")).length, 2, "host and preview must each own one canonical CSS asset");

console.log(`Provider boundary passed: ${expectedIds.length} components, ${assetFiles.length} assets, ${wasm.length} WASM, ${glue.length} glue.`);
