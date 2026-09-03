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

const providerSha = "6b0826cdaa14d9888e58c795ee015f70e2c5cbdf";
const providerSpec = `git+https://github.com/Takazudo/zudo-sg.git#${providerSha}`;

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function section(source, heading, nextHeading) {
  const start = source.indexOf(`${heading}:\n`);
  assert.notEqual(start, -1, `missing lockfile section: ${heading}`);
  const end = nextHeading ? source.indexOf(`\n${nextHeading}:\n`, start) : source.length;
  return source.slice(start, end < 0 ? source.length : end);
}

function indentedBlock(source, key, indent) {
  const prefix = `${" ".repeat(indent)}${key}:\n`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `missing lockfile block: ${key}`);
  const tail = source.slice(start + prefix.length);
  const next = tail.search(new RegExp(`^ {${indent}}\\S.*:\\n`, "m"));
  return source.slice(start, next < 0 ? source.length : start + prefix.length + next);
}

assert.equal(packageJson.dependencies["@zudo-sg/ui"], providerSpec, "provider dependency must use the exact Git SHA");
const tarball = `https://codeload.github.com/Takazudo/zudo-sg/tar.gz/${providerSha}`;
const rootImporter = indentedBlock(section(lock, "importers", "packages"), ".", 2);
const importer = indentedBlock(rootImporter, "'@zudo-sg/ui'", 6);
const packageBlock = indentedBlock(section(lock, "packages", "snapshots"), `'@zudo-sg/ui@${tarball}'`, 2);
const snapshotSection = section(lock, "snapshots");
const escapedTarball = tarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const snapshotKey = snapshotSection.match(new RegExp(`^  ('@zudo-sg/ui@${escapedTarball}[^']*'):\\n`, "m"))?.[1];
assert.ok(snapshotKey, "missing exact provider snapshot");
const snapshot = indentedBlock(snapshotSection, snapshotKey, 2);
assert.ok(importer.includes(`specifier: ${providerSpec}`), "importer spec must retain exact provider Git SHA");
assert.ok(importer.includes(`version: ${tarball}(@zudo-composer/component-contract@packages+component-contract)(preact@10.29.8)(tailwindcss@4.3.3)`), "importer resolution drifted");
assert.ok(packageBlock.includes(`resolution: {gitHosted: true, tarball: ${tarball}}`), "provider codeload package resolution drifted");
assert.ok(packageBlock.includes("version: 0.1.0"), "provider lock metadata version drifted");
assert.ok(snapshot.includes("'@zudo-composer/component-contract': link:packages/component-contract"), "provider must use the intentional local contract peer");
assert.equal(count(snapshot, "link:packages/component-contract"), 1, "only the intentional component-contract peer may link locally");
for (const block of [importer, packageBlock, snapshot]) {
  assert.doesNotMatch(block, /(?:workspace|file|path|sibling):|\.\.\/|packages\/ui|\/Users\/|[A-Za-z]:\\\\/, "provider provenance must not use a local/sibling resolution");
}
assert.equal(providerPackage.version, "0.1.0", "installed package metadata version drifted");
assert.match(packSource, /packId:\s*["']@zudo-sg\/ui["']/);
const packVersion = packSource.match(/\bpackVersion:\s*["']([^"']+)["']/)?.[1];
assert.ok(packVersion, "provider pack must declare a non-empty pack version");

const sidecarImports = [...packSource.matchAll(
  /import\s+\{\s*\w+\s+as\s+(\w+)\s*\}\s+from\s+["'](\.\/[^"']+\.composer)["']/g,
)].map((match) => ({
  localName: match[1],
  path: join(root, "node_modules/@zudo-sg/ui/src", `${match[2]}.tsx`),
}));
assert.ok(sidecarImports.length > 0, "provider pack must import at least one component sidecar");
const componentList = packSource.match(/\bcomponents:\s*\[([\s\S]*?)\]\s*,\s*\}\);/)?.[1];
assert.ok(componentList, "provider pack must declare its generated component list");
const componentNames = componentList.split(",").map((name) => name.trim()).filter(Boolean);
assert.deepEqual(
  componentNames,
  sidecarImports.map(({ localName }) => localName),
  "every generated sidecar import must have one matching runtime entry in stable order",
);
assert.equal(new Set(componentNames).size, componentNames.length, "provider runtime entries must be unique");

const identities = sidecarImports.map(({ path }) => {
  const source = readFileSync(path, "utf8");
  const id = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
  const schemaVersion = Number(source.match(/\bschemaVersion:\s*(\d+)/)?.[1]);
  const sourceModule = source.match(/\bsource:\s*\{[\s\S]*?\bmodule:\s*["']([^"']+)["']/)?.[1];
  assert.ok(id, `${path} must declare a component id`);
  assert.ok(Number.isInteger(schemaVersion) && schemaVersion > 0, `${id} must declare a positive schema version`);
  assert.ok(sourceModule, `${id} must declare a public source module`);
  assert.equal(sourceModule, "@zudo-sg/ui", `${id} source.module must identify the installed provider package`);
  assert.doesNotMatch(sourceModule, /(?:^|\/)src(?:\/|$)/, `${id} source.module must not expose a private /src/ import`);
  return { id, schemaVersion };
});
const componentIds = identities.map(({ id }) => id);
assert.equal(new Set(componentIds).size, componentIds.length, "provider component ids must be unique");

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
  "media-store",
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
for (const forbidden of ["Build structures, not documents.", "Composition library", "Content authoring", "Mapping library", "Add component…", "file-provider"]) {
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
assert.ok(readFileSync(join(root, "src/features/composer/library/new-composition-dialog.tsx"), "utf8").includes("pr-[3.5rem]"), "local Tailwind source proof drifted");
assert.ok(css.some((source) => source.includes(".pr-\\[3\\.5rem\\]{")), "local-source Tailwind utility was not emitted");
assert.ok(readFileSync(join(root, "node_modules/@zudo-sg/ui/src/cards/callout/callout.tsx"), "utf8").includes("border-l-4"), "provider Tailwind source proof drifted");
assert.ok(css.some((source) => source.includes(".border-l-4{")), "installed-provider Tailwind utility was not emitted");
for (const [size, value] of Object.entries({ xs: ".75rem", sm: "1rem", md: "1.25rem", lg: "1.5rem" })) {
  assert.ok(combinedCss.includes(`--spacing-icon-${size}:${value}`), `built CSS is missing local icon token ${size}`);
  assert.ok(combinedCss.includes(`.w-icon-${size}{width:var(--spacing-icon-${size})}`), `built CSS is missing w-icon-${size}`);
  assert.ok(combinedCss.includes(`.h-icon-${size}{height:var(--spacing-icon-${size})}`), `built CSS is missing h-icon-${size}`);
}
assert.equal(css.reduce((total, source) => total + count(source, ".hi-kw{"), 0), 2, "canonical provider CSS must occur once in each host/preview graph");
assert.equal(css.filter((source) => source.includes(".hi-kw{")).length, 2, "host and preview must each own one canonical CSS asset");

console.log(`Provider boundary passed: ${componentIds.length} components from pack ${packVersion}, ${assetFiles.length} assets, ${wasm.length} WASM, ${glue.length} glue.`);
