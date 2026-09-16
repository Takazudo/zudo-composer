// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import ts from "typescript";
import { ASSET_CHECKSUM_URL_PATTERN, assetMimeTypeForExtension, hostedAssetHeaders } from "../../src/assets/model/asset-kinds.mjs";
import { assertToolIdentity, readToolIdentity } from "../../server/site-build/artifact.mjs";
import { createModuleEvaluator } from "../../server/module-evaluator.mjs";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { assertDemoEditorRoutes } from "../routes.mjs";
import { boundarySource } from "../boundary-source.mjs";

export const DEMO_EDITOR_MANIFEST = "demo-editor-manifest.json";
export const DEMO_EDITOR_SEED = "demo-editor-seed.json";

// Cloudflare consumes this deployment configuration instead of serving it.
export const HOSTED_DEMO_HEADERS = "_headers";

const MIME_BY_EXTENSION = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
]);

// These markers are the filesystem, server, source-map, fixture and test
// boundaries from the ordinary dist checker. The hosted adapter has an
// explicit runtime boundary, so it must carry the same exclusions.
const FORBIDDEN_ARTIFACT_MARKERS = [
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
  "virtual:composer-file-provider",
  "createComposerFileProviderMiddleware",
  "COMPOSER_FILE_PROVIDER_ENDPOINT",
  "ASSET_FILE_PROVIDER_ENDPOINT",
  "/__zudo_composer_asset_file_provider",
  "/__zudo_composer_file_provider",
  "cms/assets",
  "src/assets/storage/file-provider/dev-server-entry.ts",
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
  "readActivatedSiteAssets",
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
];

/** @typedef {{ schemaVersion: 1, tool: import("../../server/site-build/artifact.mjs").ToolIdentity, hostId: string, projectId: string, sourceRevision: string, projectSourceRevision: string, mode: "disposable-demo-editor", assets: Record<string, import("./asset-snapshot").DemoAssetFile>, routes: string[], files: Record<string, string> }} DemoEditorManifest */
/** @typedef {{ path: string, sha256: string, mime: string }} HostedDemoFile */
/** @typedef {{ root: string, manifest: DemoEditorManifest, files: HostedDemoFile[] }} DemoEditorArtifact */

// These words also occur in host-authored prose and public pack source metadata.
// Keep them forbidden in executable code and actual module dependencies.
const PROSE_MARKERS = new Set(["styleguide", ".stories", "/src/", "projects/", "builds/"]);

/** @param {string} source @param {string} fileName */
export function assertDemoEditorText(source, fileName) {
  let code;
  /** @type {string[] | undefined} */
  let dependencies;
  for (const forbidden of FORBIDDEN_ARTIFACT_MARKERS) {
    if (!source.includes(forbidden)) continue;
    if (PROSE_MARKERS.has(forbidden) && /\.(?:js|mjs)$/.test(fileName)) {
      code ??= boundarySource(source, { fileName, strings: false });
      if (dependencies === undefined) {
        /** @type {string[]} */
        const specifiers = [];
        const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        /** @param {import("typescript").Node} node */
        function collectSpecifier(node) {
          if (ts.isStringLiteralLike(node)) specifiers.push(node.text);
          if (ts.isTemplateExpression(node)) specifiers.push(node.head.text, ...node.templateSpans.map(({ literal }) => literal.text));
          ts.forEachChild(node, collectSpecifier);
        }
        /** @param {import("typescript").Node} node */
        function visit(node) {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
          if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || ts.isIdentifier(node.expression) && node.expression.text === "require"
            || ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require" && node.expression.name.text === "resolve")) {
            const argument = node.arguments[0];
            if (argument) collectSpecifier(argument);
          }
          ts.forEachChild(node, visit);
        }
        visit(tree);
        dependencies = specifiers;
      }
      assert.ok(!code.includes(forbidden) && !dependencies.some((path) => path.includes(forbidden)), `Hosted artifact leaked forbidden marker ${forbidden}: ${fileName}`);
    } else assert.ok(false, `Hosted artifact leaked forbidden marker ${forbidden}: ${fileName}`);
  }
  assert.doesNotMatch(source, /["'`]@\/[A-Za-z0-9_.-]/, "Hosted artifact leaked forbidden module alias: @/");
}

/** @param {Uint8Array | string} bytes @returns {string} */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} path @returns {string} */
export function expectedMime(path) {
  if (path === HOSTED_DEMO_HEADERS) return "text/plain";
  if (path === DEMO_EDITOR_SEED) return "application/json";
  if (path.startsWith("uploaded-assets/")) {
    const mime = ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`) ? assetMimeTypeForExtension(path.slice(path.lastIndexOf(".") + 1)) : undefined;
    assert.ok(mime, `No hosted demo asset MIME contract for ${path}`);
    return mime;
  }
  const mime = MIME_BY_EXTENSION.get(extname(path).toLowerCase());
  assert.ok(mime, `No hosted demo MIME contract for ${path}`);
  return mime;
}

/**
 * @param {string} root
 * @returns {Promise<Array<{ path: string, absolutePath: string }>>}
 */
async function filesUnder(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Deploy artifacts must not contain symlinks: ${entry.name}`);
    if (entry.isDirectory()) {
      const nested = await filesUnder(absolutePath);
      for (const file of nested) files.push({ path: `${entry.name}/${file.path}`, absolutePath: file.absolutePath });
    } else {
      assert.ok(entry.isFile(), `Deploy artifacts must contain regular files only: ${entry.name}`);
      files.push({ path: entry.name, absolutePath });
    }
  }
  return files;
}

/** @param {string} path @returns {void} */
function assertSafeRelativePath(path) {
  assert.ok(path && !path.startsWith("/") && !path.includes("\\"), `Invalid hosted artifact path: ${path}`);
  assert.equal(normalize(path).split(sep).join("/"), path, `Hosted artifact path is not normalized: ${path}`);
  assert.ok(!path.split("/").includes(".."), `Hosted artifact path escapes its root: ${path}`);
}

/** @param {unknown} value @returns {asserts value is Record<string, unknown>} */
function assertRecord(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Hosted demo manifest must be an object");
}

/** @type {Promise<typeof import("./seed")> | undefined} */
let seedModule;

/** @param {Map<string, Buffer>} files */
async function inspectSeed(files) {
  assert.ok(files.has(DEMO_EDITOR_SEED), `Demo editor artifact must include ${DEMO_EDITOR_SEED}`);
  seedModule ??= createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "scripts/hosted-demo/seed.ts")).then((module) => /** @type {typeof import("./seed")} */ (module));
  const { inspectDemoEditorSeed } = await seedModule;
  return inspectDemoEditorSeed(JSON.parse(/** @type {Buffer} */ (files.get(DEMO_EDITOR_SEED)).toString("utf8")), [...files].filter(([path]) => path.startsWith("uploaded-assets/")).map(([path, source]) => ({ path, source })));
}

/** Hash the final output and derive the contract from its bundled JSON seed.
 * @param {{directory: string, sourceRevision: string}} options
 * @returns {Promise<DemoEditorManifest>} */
export async function createDemoEditorManifest({ directory, sourceRevision }) {
  assert.match(sourceRevision, /^[a-f0-9]{40}$/);
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const file of (await filesUnder(resolve(directory))).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    if (file.path !== DEMO_EDITOR_MANIFEST) contents.set(file.path, await readFile(file.absolutePath));
  }
  return {
    schemaVersion: 1, tool: await readToolIdentity(), sourceRevision, mode: "disposable-demo-editor",
    ...await inspectSeed(contents),
    files: Object.fromEntries([...contents].map(([path, source]) => [path, sha256(source)])),
  };
}

/**
 * Validate the final hosted-demo directory and return its manifest and files.
 * This is shared by the local verifier, the CI handoff, and the live smoke
 * checker so those gates cannot silently disagree about the artifact boundary.
 *
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<DemoEditorArtifact>}
 */
export async function verifyDemoEditorArtifact({ directory, expectedSourceRevision }) {
  const root = resolve(directory);
  assert.ok((await lstat(root)).isDirectory(), `Demo editor artifact must be a real directory: ${root}`);
  const manifestPath = join(root, DEMO_EDITOR_MANIFEST);
  assert.ok((await lstat(manifestPath)).isFile(), "Demo editor manifest must be a regular file, not a symlink");
  const manifest = /** @type {DemoEditorManifest} */ (JSON.parse(await readFile(manifestPath, "utf8")));
  assertRecord(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), ["assets", "files", "hostId", "mode", "projectId", "projectSourceRevision", "routes", "schemaVersion", "sourceRevision", "tool"]);
  assert.equal(manifest.schemaVersion, 1);
  assertToolIdentity(manifest.tool);
  assert.equal(typeof manifest.sourceRevision, "string");
  assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
  if (expectedSourceRevision !== undefined) assert.equal(manifest.sourceRevision, expectedSourceRevision, "Hosted artifact sourceRevision does not match the trusted checkout");
  assert.equal(typeof manifest.projectSourceRevision, "string");
  assert.match(manifest.projectSourceRevision, /^[a-f0-9]{64}$/);
  assert.equal(manifest.mode, "disposable-demo-editor");
  for (const id of [manifest.hostId, manifest.projectId]) assert.ok(typeof id === "string" && id.length > 0, "Demo editor manifest must name its host and project");
  assertDemoEditorRoutes(manifest.routes);
  assertRecord(manifest.files);
  for (const [path, checksum] of Object.entries(manifest.files)) {
    assertSafeRelativePath(path);
    assert.match(checksum, /^[a-f0-9]{64}$/);
  }
  assertRecord(manifest.assets);
  for (const [path, asset] of Object.entries(manifest.assets)) {
    assert.ok(ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`), `Invalid hosted asset path: ${path}`);
    assertRecord(asset);
    assert.deepEqual(Object.keys(asset).sort(), ["byteLength", "mimeType", "sha256"]);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(asset.sha256, path.slice("uploaded-assets/sha256-".length, path.lastIndexOf(".")), `Demo asset name does not match its checksum: ${path}`);
    assert.ok(Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0, `Invalid demo asset byte length: ${path}`);
    assert.equal(asset.mimeType, expectedMime(path), `Demo asset MIME does not match its URL: ${path}`);
  }

  const found = [];
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  const files = await filesUnder(root);
  for (const file of files) {
    assertSafeRelativePath(file.path);
    if (file.path === DEMO_EDITOR_MANIFEST) continue;
    found.push(file.path);
    assert.ok(Object.hasOwn(manifest.files, file.path), `Artifact file is missing from manifest: ${file.path}`);
    const bytes = await readFile(file.absolutePath);
    contents.set(file.path, bytes);
    assert.equal(sha256(bytes), manifest.files[file.path], `Final artifact checksum: ${file.path}`);
    expectedMime(file.path);
    if (file.path.startsWith("uploaded-assets/")) {
      assert.ok(Object.hasOwn(manifest.assets, file.path), `Uploaded asset is missing from manifest assets: ${file.path}`);
      assert.equal(bytes.byteLength, manifest.assets[file.path].byteLength, `Demo asset byte length: ${file.path}`);
      assert.equal(sha256(bytes), manifest.assets[file.path].sha256, `Demo asset checksum: ${file.path}`);
    }
    if (/\.(?:js|mjs|html|css)$/.test(file.path)) {
      assertDemoEditorText(bytes.toString("utf8"), file.path);
    }
  }

  assert.deepEqual([...found].sort(), Object.keys(manifest.files).sort(), "Manifest must describe every final file exactly once");
  assert.ok(manifest.files["index.html"], "Hosted artifact must include index.html");
  assert.ok(manifest.files["hosted-demo-assets-worker.js"], "Hosted artifact must include hosted-demo-assets-worker.js");
  const assets = found.filter((path) => path.startsWith("uploaded-assets/"));
  assert.deepEqual([...assets].sort(), Object.keys(manifest.assets).sort(), "Uploaded assets must equal the manifest assets");
  const seed = await inspectSeed(contents);
  for (const key of /** @type {const} */ (["hostId", "projectId", "projectSourceRevision", "routes", "assets"])) {
    assert.deepEqual(manifest[key], seed[key], `Demo editor ${key} differs from its bundled seed`);
  }

  assert.equal(contents.get(HOSTED_DEMO_HEADERS)?.toString("utf8"), hostedAssetHeaders(assets.map((path) => ({ path, byteLength: manifest.assets[path].byteLength }))), "Hosted asset header rules must match the bundled asset contract");

  // Preserve the ordinary dist check's preview boundary. The full application
  // bundle may contain host-only labels, so inspect only each preview entry's
  // static graph for those markers.
  const javascript = found.filter((path) => path.startsWith("assets/") && [".js", ".mjs"].includes(extname(path)));
  // Two entries carry this name: the Composer canvas preview and the delivery
  // visitor document. Both are preview documents, so every one of their graphs
  // is walked rather than picking a single chunk.
  const previewEntries = javascript.filter((path) => basename(path).startsWith("preview-entry-"));
  assert.ok(previewEntries.length > 0, "Hosted artifact must include a preview entry chunk");
  const previewGraph = new Set();
  /** @param {string} path */
  function collectPreviewGraph(path) {
    if (previewGraph.has(path)) return;
    previewGraph.add(path);
    const source = /** @type {Buffer} */ (contents.get(path)).toString("utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']\.\/([^"']+)["']/g)) {
      const dependency = `assets/${match[1]}`;
      if (javascript.includes(dependency)) collectPreviewGraph(dependency);
    }
  }
  for (const entry of previewEntries) collectPreviewGraph(entry);
  const previewText = [...previewGraph].map((path) => contents.get(path)?.toString("utf8")).join("\n");
  for (const forbidden of [
    "How the pieces connect",
    "Composition library",
    "Stored Content needs recovery",
    "Mapping library",
    "Add component…",
    "Back to Compositions",
    "file-provider",
  ]) assert.ok(!previewText.includes(forbidden), `Hosted preview graph leaked host marker: ${forbidden}`);

  const index = /** @type {Buffer} */ (contents.get("index.html")).toString("utf8");
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("http") || url.startsWith("data:")) continue;
    assert.ok(url.startsWith("/assets/"), `Hosted index asset is not rooted under /assets: ${url}`);
    assert.ok(Object.hasOwn(manifest.files, url.slice(1)), `Hosted index asset is missing: ${url}`);
  }

  return {
    root,
    manifest,
    files: found.filter((path) => path !== HOSTED_DEMO_HEADERS).sort().map((path) => ({ path, sha256: manifest.files[path], mime: expectedMime(path) })),
  };
}
