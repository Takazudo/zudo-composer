// @ts-check
// The static website artifact a host package builds (`vite.site-static.config.ts`):
// its manifest, its Cloudflare header rules, and the verifier every consumer shares.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { resolveSiteSourceRevision } from "./source-revision.mjs";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, hostedAssetHeaders } from "../../src/assets/model/asset-kinds.mjs";

export const SITE_MANIFEST = "site-manifest.json";

// Cloudflare consumes this deployment configuration instead of serving it.
export const SITE_HEADERS = "_headers";

// Markers that would mean the authoring tool's server, filesystem or release
// plumbing leaked into a visitor bundle.
const FORBIDDEN_ARTIFACT_MARKERS = [
  "sourceMappingURL",
  "/Users/",
  "/home/",
  "node:fs",
  "node:path",
  "node:crypto",
  "node:child_process",
  "virtual:composer-file-provider",
  "/__zudo_composer_file_provider",
  "/__zudo_composer_asset_file_provider",
  "createComposerFileProviderMiddleware",
  ".zudo-site-project",
  "ZUDO_SITE_PROJECT_ROOT",
  "server/site-project-local",
  "createLocalSiteProjectApiService",
  "readActivatedSiteRelease",
  "storage/filesystem",
];

/** @typedef {{ name: string, version: string, gitHead?: string }} ToolIdentity */
/** @typedef {{ schemaVersion: 1, projectId: string, tool: ToolIdentity, sourceRevision?: string, projectSourceRevision: string, routes: string[], files: Record<string, string> }} SiteManifest */

/** @param {unknown} value @returns {asserts value is ToolIdentity} */
export function assertToolIdentity(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Manifest tool identity must be an object");
  const tool = /** @type {ToolIdentity} */ (value);
  assert.deepEqual(Object.keys(tool).sort(), Object.hasOwn(tool, "gitHead") ? ["gitHead", "name", "version"] : ["name", "version"]);
  for (const key of /** @type {const} */ (["name", "version"])) {
    assert.ok(typeof tool[key] === "string" && tool[key].trim().length > 0, `Manifest tool identity must include ${key}`);
  }
  if (Object.hasOwn(tool, "gitHead")) assert.match(/** @type {string} */ (tool.gitHead), /^[a-f0-9]{40}$/);
}

/** Read the installed package's identity, never the host's enclosing Git tree.
 * @returns {Promise<ToolIdentity>}
 */
export async function readToolIdentity() {
  const metadata = JSON.parse(await readFile(resolve(APP_ROOT, "package.json"), "utf8"));
  const tool = { name: metadata.name, version: metadata.version, ...(Object.hasOwn(metadata, "gitHead") ? { gitHead: metadata.gitHead } : {}) };
  assertToolIdentity(tool);
  return tool;
}

/** @param {Uint8Array | string} bytes @returns {string} */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Hashed Vite output is immutable; pinned asset versions get the same per-file
 * rules the hosted demo serves them with.
 * @param {Array<{ path: string, byteLength: number }>} pinned
 * @returns {string}
 */
export function siteHeaders(pinned) {
  const rules = [`/assets/*\n  Cache-Control: ${ASSET_IMMUTABLE_CACHE_CONTROL}\n`];
  if (pinned.length) rules.push(hostedAssetHeaders(pinned));
  return rules.join("\n");
}

/**
 * @param {string} root
 * @returns {Promise<Array<{ path: string, absolutePath: string }>>}
 */
async function filesUnder(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolutePath = join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Site artifacts must not contain symlinks: ${entry.name}`);
    if (entry.isDirectory()) {
      for (const file of await filesUnder(absolutePath)) files.push({ path: `${entry.name}/${file.path}`, absolutePath: file.absolutePath });
    } else {
      assert.ok(entry.isFile(), `Site artifacts must contain regular files only: ${entry.name}`);
      files.push({ path: entry.name, absolutePath });
    }
  }
  return files;
}

/**
 * Hash every file of a finished build (except the manifest itself).
 * @param {{ directory: string, projectId: string, sourceRevision?: string, projectSourceRevision: string, routes: string[] }} options
 * @returns {Promise<SiteManifest>}
 */
export async function createSiteManifest({ directory, projectId, sourceRevision, projectSourceRevision, routes }) {
  const tool = await readToolIdentity();
  resolveSiteSourceRevision(sourceRevision, {});
  /** @type {Record<string, string>} */
  const files = {};
  for (const file of (await filesUnder(resolve(directory))).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    if (file.path !== SITE_MANIFEST) files[file.path] = sha256(await readFile(file.absolutePath));
  }
  return { schemaVersion: 1, projectId, tool, ...(sourceRevision === undefined ? {} : { sourceRevision }), projectSourceRevision, routes: [...routes], files };
}

/** @param {string} path @returns {void} */
function assertSafeRelativePath(path) {
  assert.ok(path && !path.startsWith("/") && !path.includes("\\"), `Invalid site artifact path: ${path}`);
  assert.equal(normalize(path).split(sep).join("/"), path, `Site artifact path is not normalized: ${path}`);
  assert.ok(!path.split("/").includes(".."), `Site artifact path escapes its root: ${path}`);
}

/**
 * Validate a finished `dist-site/` directory against its manifest.
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<SiteManifest>}
 */
export async function verifySiteStaticArtifact({ directory, expectedSourceRevision }) {
  const root = resolve(directory);
  assert.ok((await lstat(root)).isDirectory(), `Site artifact directory is missing: ${root}`);
  const manifest = /** @type {SiteManifest} */ (JSON.parse(await readFile(join(root, SITE_MANIFEST), "utf8")));
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Site manifest must be an object");
  const keys = ["files", "projectId", "projectSourceRevision", "routes", "schemaVersion", "tool"];
  if (Object.hasOwn(manifest, "sourceRevision")) keys.push("sourceRevision");
  assert.deepEqual(Object.keys(manifest).sort(), keys.sort());
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(typeof manifest.projectId === "string" && manifest.projectId.length > 0, "Site manifest must name its project");
  assertToolIdentity(manifest.tool);
  if (Object.hasOwn(manifest, "sourceRevision")) {
    assert.ok(typeof manifest.sourceRevision === "string" && manifest.sourceRevision.trim().length > 0, "Site sourceRevision must be a nonempty string when supplied");
  }
  if (expectedSourceRevision !== undefined) assert.equal(manifest.sourceRevision, expectedSourceRevision, "Site artifact sourceRevision does not match the trusted checkout");
  assert.match(manifest.projectSourceRevision, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(manifest.routes) && manifest.routes.includes("/"), "Site manifest routes must include /");
  assert.equal(new Set(manifest.routes).size, manifest.routes.length, "Site manifest routes must be unique");
  for (const route of manifest.routes) assert.ok(typeof route === "string" && route.startsWith("/") && !route.startsWith("//"), `Invalid site route: ${route}`);
  assert.ok(manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files), "Site manifest files must be an object");

  const found = [];
  for (const file of await filesUnder(root)) {
    assertSafeRelativePath(file.path);
    if (file.path === SITE_MANIFEST) continue;
    found.push(file.path);
    assert.ok(Object.hasOwn(manifest.files, file.path), `Site artifact file is missing from manifest: ${file.path}`);
    const bytes = await readFile(file.absolutePath);
    const digest = sha256(bytes);
    assert.equal(digest, manifest.files[file.path], `Site artifact checksum: ${file.path}`);
    if (ASSET_CHECKSUM_URL_PATTERN.test(`/${file.path}`)) assert.equal(file.path.slice("uploaded-assets/sha256-".length, file.path.lastIndexOf(".")), digest, `Pinned asset name does not match its bytes: ${file.path}`);
    if (/\.(?:js|mjs|html|css)$/.test(file.path)) {
      const text = bytes.toString("utf8");
      for (const forbidden of FORBIDDEN_ARTIFACT_MARKERS) assert.ok(!text.includes(forbidden), `Site artifact leaked forbidden marker ${forbidden}: ${file.path}`);
    }
  }
  assert.deepEqual([...found].sort(), Object.keys(manifest.files).sort(), "Site manifest must describe every file exactly once");
  assert.ok(manifest.files["index.html"], "Site artifact must include index.html");
  assert.ok(manifest.files[SITE_HEADERS], `Site artifact must include ${SITE_HEADERS}`);
  const pinned = found.filter((path) => ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`));
  assert.equal(await readFile(join(root, SITE_HEADERS), "utf8"), siteHeaders(await Promise.all(pinned.map(async (path) => ({ path, byteLength: (await lstat(join(root, path))).size })))), "Site header rules must match the pinned assets");
  return manifest;
}
