// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition, assetMimeTypeForExtension } from "../../src/assets/model/asset-kinds.mjs";

export const HOSTED_DEMO_MANIFEST = "hosted-demo-manifest.json";

// Cloudflare consumes this deployment configuration instead of serving it.
export const HOSTED_DEMO_HEADERS = "_headers";

/** @param {Array<{ path: string, byteLength: number }>} files @returns {string} */
export function hostedAssetHeaders(files) {
  return [...files].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, byteLength }) => {
    assert.ok(Number.isSafeInteger(byteLength) && byteLength > 0, `Invalid asset byte length: ${path}`);
    assert.ok(ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`), `Invalid hosted asset path: ${path}`);
    const mime = assetMimeTypeForExtension(path.slice(path.lastIndexOf(".") + 1));
    assert.ok(mime, `Missing asset MIME: ${path}`);
    const checksum = path.slice("uploaded-assets/sha256-".length, path.lastIndexOf("."));
    const disposition = assetContentDisposition(mime, checksum);
    return [
      `/${path}`,
      `  Content-Type: ${mime}`,
      `  Content-Length: ${byteLength}`,
      `  Cache-Control: ${ASSET_IMMUTABLE_CACHE_CONTROL}`,
      `  X-Content-Type-Options: ${ASSET_NOSNIFF}`,
      ...(disposition ? [`  Content-Disposition: ${disposition}`] : []),
    ].join("\n");
  }).join("\n\n") + "\n";
}

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

/** @typedef {{ schemaVersion: number, sourceRevision: string, projectSourceRevision: string, mode: string, assets: Record<string, string> }} HostedDemoManifest */
/** @typedef {{ path: string, sha256: string, mime: string }} HostedDemoFile */
/** @typedef {{ root: string, manifest: HostedDemoManifest, files: HostedDemoFile[] }} HostedDemoArtifact */

/** @param {Uint8Array | string} bytes @returns {string} */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** @param {string} path @returns {string} */
export function expectedMime(path) {
  if (path === HOSTED_DEMO_HEADERS) return "text/plain";
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

/**
 * Validate the final hosted-demo directory and return its manifest and files.
 * This is shared by the local verifier, the CI handoff, and the live smoke
 * checker so those gates cannot silently disagree about the artifact boundary.
 *
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<HostedDemoArtifact>}
 */
export async function verifyHostedDemoArtifact({ directory, expectedSourceRevision }) {
  const root = resolve(directory);
  const manifestPath = join(root, HOSTED_DEMO_MANIFEST);
  const manifest = /** @type {HostedDemoManifest} */ (JSON.parse(await readFile(manifestPath, "utf8")));
  assertRecord(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), ["assets", "mode", "projectSourceRevision", "schemaVersion", "sourceRevision"]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(typeof manifest.sourceRevision, "string");
  assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
  if (expectedSourceRevision !== undefined) assert.equal(manifest.sourceRevision, expectedSourceRevision, "Hosted artifact sourceRevision does not match the trusted checkout");
  assert.equal(typeof manifest.projectSourceRevision, "string");
  assert.match(manifest.projectSourceRevision, /^[a-f0-9]{64}$/);
  assert.equal(manifest.mode, "disposable-hosted-demo");
  assertRecord(manifest.assets);
  for (const checksum of Object.values(manifest.assets)) assert.match(checksum, /^[a-f0-9]{64}$/);

  const found = [];
  const files = await filesUnder(root);
  for (const file of files) {
    assertSafeRelativePath(file.path);
    if (file.path === HOSTED_DEMO_MANIFEST) continue;
    found.push(file.path);
    assert.ok(Object.prototype.hasOwnProperty.call(manifest.assets, file.path), `Artifact file is missing from manifest: ${file.path}`);
    const bytes = await readFile(file.absolutePath);
    assert.equal(sha256(bytes), manifest.assets[file.path], `Final artifact checksum: ${file.path}`);
    expectedMime(file.path);
    if (/\.(?:js|mjs|html|css)$/.test(file.path)) {
      const text = bytes.toString("utf8");
      for (const forbidden of FORBIDDEN_ARTIFACT_MARKERS) assert.ok(!text.includes(forbidden), `Hosted artifact leaked forbidden marker: ${forbidden}`);
      assert.doesNotMatch(text, /["'`]@\/[A-Za-z0-9_.-]/, "Hosted artifact leaked forbidden module alias: @/");
    }
  }

  assert.deepEqual([...found].sort(), Object.keys(manifest.assets).sort(), "Manifest must describe every final file exactly once");
  assert.ok(manifest.assets["index.html"], "Hosted artifact must include index.html");
  assert.ok(manifest.assets["hosted-demo-assets-worker.js"], "Hosted artifact must include hosted-demo-assets-worker.js");
  const assets = found.filter((path) => path.startsWith("uploaded-assets/"));
  assert.equal(assets.length, 6, "Hosted artifact must include exactly six seeded assets");
  for (const path of assets) assert.ok(ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`), `Invalid hosted asset path: ${path}`);

  assert.equal(await readFile(join(root, HOSTED_DEMO_HEADERS), "utf8"), hostedAssetHeaders(await Promise.all(assets.map(async (path) => ({ path, byteLength: (await readFile(join(root, path))).byteLength })))), "Hosted asset header rules must match the bundled asset contract");

  // Preserve the ordinary dist check's preview boundary. The full application
  // bundle may contain host-only labels, so inspect only the preview entry's
  // static graph for those markers.
  const javascript = found.filter((path) => path.startsWith("assets/") && [".js", ".mjs"].includes(extname(path)));
  const previewEntries = javascript.filter((path) => basename(path).startsWith("preview-entry-"));
  assert.equal(previewEntries.length, 1, "Hosted artifact must include exactly one preview entry chunk");
  const previewGraph = new Set();
  /** @param {string} path @returns {Promise<void>} */
  async function collectPreviewGraph(path) {
    if (previewGraph.has(path)) return;
    previewGraph.add(path);
    const source = (await readFile(join(root, path))).toString("utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']\.\/([^"']+)["']/g)) {
      const dependency = `assets/${match[1]}`;
      if (javascript.includes(dependency)) await collectPreviewGraph(dependency);
    }
  }
  await collectPreviewGraph(previewEntries[0]);
  const previewText = await Promise.all([...previewGraph].map((path) => readFile(join(root, path), "utf8"))).then((sources) => sources.join("\n"));
  for (const forbidden of [
    "How the pieces connect",
    "Composition library",
    "Stored Content needs recovery",
    "Mapping library",
    "Add component…",
    "Back to Compositions",
    "file-provider",
  ]) assert.ok(!previewText.includes(forbidden), `Hosted preview graph leaked host marker: ${forbidden}`);

  const index = await readFile(join(root, "index.html"), "utf8");
  for (const match of index.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = match[1];
    if (url.startsWith("http") || url.startsWith("data:")) continue;
    assert.ok(url.startsWith("/assets/"), `Hosted index asset is not rooted under /assets: ${url}`);
    assert.ok(Object.prototype.hasOwnProperty.call(manifest.assets, url.slice(1)), `Hosted index asset is missing: ${url}`);
  }

  return {
    root,
    manifest,
    files: found.filter((path) => path !== HOSTED_DEMO_HEADERS).sort().map((path) => ({ path, sha256: manifest.assets[path], mime: expectedMime(path) })),
  };
}
