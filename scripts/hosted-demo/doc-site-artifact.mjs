// @ts-check
// The documentation build's manifest and the artifact contract shared by local
// checks and the trusted-run pipeline.
import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { assertToolIdentity, readToolIdentity, sha256 } from "../../server/site-build/artifact.mjs";

export const DOC_SITE_MANIFEST = "doc-site-manifest.json";

const MIME_BY_EXTENSION = new Map([
  [".html", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".txt", "text/plain"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/vnd.microsoft.icon"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
]);

const ACCEPTED_MIMES_BY_EXTENSION = new Map([
  [".ico", ["image/vnd.microsoft.icon", "image/x-icon"]],
  [".xml", ["application/xml", "text/xml"]],
]);

/** @typedef {{ schemaVersion: 1, kind: "doc-site", tool: import("../../server/site-build/artifact.mjs").ToolIdentity, sourceRevision?: string, routes: string[], files: Record<string, string> }} DocSiteManifest */
/** @typedef {{ path: string, sha256: string, mime: string, acceptedMimes?: string[] }} DocSiteFile */
/** @typedef {{ root: string, manifest: DocSiteManifest, files: DocSiteFile[] }} DocSiteArtifact */

/** @param {unknown} value @returns {asserts value is string} */
function assertSourceRevision(value) {
  assert.ok(typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/iu.test(value), "Doc site sourceRevision must be a full 40-hex Git SHA");
}

/** @param {string} path */
function assertSafeRelativePath(path) {
  assert.ok(path && !path.startsWith("/") && !path.includes("\\")
    && path.split("/").every((part) => part && part !== "." && part !== ".."), `Invalid doc site artifact path: ${path}`);
}

/**
 * Enumerate regular files without following symlinks, retaining the full path
 * in failures so nested bad entries can be located directly.
 * @param {string} root
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function filesUnder(root, prefix = "") {
  if (!prefix) assert.ok((await lstat(root)).isDirectory(), `Doc site artifact root must be a directory: ${root}`);
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    /** @type {string} */
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assertSafeRelativePath(path);
    assert.ok(!entry.isSymbolicLink(), `Doc site artifacts must not contain symlinks: ${path}`);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else {
      assert.ok(entry.isFile(), `Doc site artifacts must contain regular files only: ${path}`);
      files.push(path);
    }
  }
  return files;
}

/** @param {string[]} paths @returns {string[]} */
function routesForFiles(paths) {
  return [...new Set(paths.filter((path) => path.endsWith(".html") && path !== "404.html").map((path) => {
    if (path === "index.html") return "/";
    if (path.endsWith("/index.html")) return `/${path.slice(0, -"index.html".length)}`;
    return `/${path.slice(0, -".html".length)}`;
  }))].sort();
}

/**
 * Hash every regular build output except this manifest; no Git checkout is
 * needed when a local caller leaves sourceRevision undefined.
 * @param {{ directory: string, sourceRevision?: string }} options
 * @returns {Promise<DocSiteManifest>}
 */
export async function createDocSiteManifest({ directory, sourceRevision }) {
  if (sourceRevision !== undefined) assertSourceRevision(sourceRevision);
  const root = resolve(directory);
  const tool = await readToolIdentity();
  const paths = (await filesUnder(root)).filter((path) => path !== DOC_SITE_MANIFEST).sort();
  const files = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, sha256(await readFile(join(root, path)))])));
  return { schemaVersion: 1, kind: "doc-site", tool, ...(sourceRevision === undefined ? {} : { sourceRevision }), routes: routesForFiles(paths), files };
}

/**
 * Require an exact match between the manifest and the finished doc directory.
 * The manifest travels separately from the hashed files in the shared shape.
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<DocSiteArtifact>}
 */
export async function verifyDocSiteArtifact({ directory, expectedSourceRevision }) {
  const root = resolve(directory);
  const paths = (await filesUnder(root)).sort();
  const manifest = /** @type {DocSiteManifest} */ (JSON.parse(await readFile(join(root, DOC_SITE_MANIFEST), "utf8")));
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Doc site manifest must be an object");
  const keys = ["files", "kind", "routes", "schemaVersion", "tool"];
  if (Object.hasOwn(manifest, "sourceRevision")) keys.push("sourceRevision");
  assert.deepEqual(Object.keys(manifest).sort(), keys.sort(), "Doc site manifest has unexpected or missing fields");
  assert.equal(manifest.schemaVersion, 1, "Doc site manifest schemaVersion must be 1");
  assert.equal(manifest.kind, "doc-site", "Doc site manifest kind must be doc-site");
  assertToolIdentity(manifest.tool);
  if (Object.hasOwn(manifest, "sourceRevision")) assertSourceRevision(manifest.sourceRevision);
  if (expectedSourceRevision !== undefined) assert.equal(manifest.sourceRevision, expectedSourceRevision, "Doc site artifact sourceRevision does not match the trusted checkout");
  assert.ok(manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files), "Doc site manifest files must be an object");

  const found = new Set(paths);
  for (const [path, checksum] of Object.entries(manifest.files)) {
    assertSafeRelativePath(path);
    assert.notEqual(path, DOC_SITE_MANIFEST, `Doc site manifest must not list itself: ${path}`);
    assert.ok(typeof checksum === "string" && checksum.length === 64 && /^[a-f0-9]{64}$/u.test(checksum), `Invalid doc site artifact SHA-256: ${path}`);
    assert.ok(found.has(path), `Doc site artifact file is missing: ${path}`);
  }
  assert.deepEqual(manifest.routes, routesForFiles(Object.keys(manifest.files)), "Doc site manifest routes must match its HTML files exactly");

  /** @type {DocSiteFile[]} */
  const files = [];
  for (const path of paths) {
    if (path === DOC_SITE_MANIFEST) continue;
    assert.ok(Object.hasOwn(manifest.files, path), `Doc site artifact file is missing from manifest: ${path}`);
    const digest = sha256(await readFile(join(root, path)));
    assert.equal(digest, manifest.files[path], `Doc site artifact checksum mismatch: ${path}`);
    const extension = extname(path).toLowerCase();
    const mime = MIME_BY_EXTENSION.get(extension);
    assert.ok(mime, `Unknown doc site artifact extension ${extension || "(none)"}: ${path}`);
    const acceptedMimes = ACCEPTED_MIMES_BY_EXTENSION.get(extension);
    files.push({ path, sha256: digest, mime, ...(acceptedMimes ? { acceptedMimes: [...acceptedMimes] } : {}) });
  }
  return { root, manifest, files };
}
