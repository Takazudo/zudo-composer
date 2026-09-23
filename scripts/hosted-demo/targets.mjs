// @ts-check
// The trusted-run deploy pipeline (deploy.mjs, live-check.mjs,
// check-hosted-demo.mjs) is shared by thirteen Cloudflare Workers: four static
// demo websites, four per-host editors, the documentation site and four
// standalone styleguide sites.
// This module is the single place that names each target's Worker, config file,
// host/artifact directories, domain and artifact-verification shape so those
// scripts stay generic. workflow-guard.mjs needs none of this: its trusted-run
// checks are identical for every target.

import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DEMO_EDITOR_MANIFEST, expectedMime, verifyDemoEditorArtifact } from "./artifact.mjs";
import { SITE_HEADERS, SITE_MANIFEST, verifySiteStaticArtifact } from "../../server/site-build/artifact.mjs";
import { DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./doc-site-artifact.mjs";
import { verifiedDemoEditorRoutes } from "../routes.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** @typedef {{ path: string, sha256: string, mime: string, acceptedMimes?: string[] }} TargetFile */
// Local doc artifacts may omit sourceRevision. Production preflight requires
// a full SHA before calling Wrangler; other fields depend on the target kind.
/** @typedef {{ root: string, manifest: Record<string, unknown> & { sourceRevision?: string }, files: TargetFile[] }} TargetArtifact */
/**
 * Every target's artifact verifier is widened to this shared, loosely typed
 * shape: `deploy.mjs` and `live-check.mjs` are generic over any target and
 * cannot know the target-specific manifest shape in advance.
 * @typedef {(options: { directory: string, expectedSourceRevision?: string }) => Promise<TargetArtifact>} ArtifactVerifier
 */

/**
 * Adapt the static-site verifier's manifest (a `files` record keyed by path,
 * including `_headers`) to the same normalized shape the live checker and
 * deploy pipeline share with the hosted composer demo.
 *
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<TargetArtifact>}
 */
async function verifySiteStaticTargetArtifact({ directory, expectedSourceRevision }) {
  const manifest = await verifySiteStaticArtifact({ directory, expectedSourceRevision });
  const sourceRevision = manifest.sourceRevision;
  assert.ok(typeof sourceRevision === "string", "Deployed site artifact requires a sourceRevision");
  assert.match(sourceRevision, /^[a-f0-9]{40}$/, "Deployed site artifact requires a full source Git SHA");
  const files = Object.entries(manifest.files)
    .filter(([path]) => path !== SITE_HEADERS)
    .map(([path, sha256]) => ({ path, sha256, mime: expectedMime(path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { root: resolve(directory), manifest: { ...manifest, sourceRevision }, files };
}

/**
 * `routeFile` selects the artifact HTML path a navigation must match; it defaults
 * to index.html for SPA targets. `assetUrl` selects an artifact file's public
 * URL (default: index.html at /, other files at /<path>); null skips its asset
 * request only when a verified route covers the same file.
 * @typedef {{
 *   key: string,
 *   kind: "demo-editor" | "site-static" | "doc-site",
 *   workerName: string,
 *   configPath: string,
 *   domain: string,
 *   hostDirectory: string,
 *   artifactDirectory: string,
 *   manifestFileName: string,
 *   ciArtifactName: (sha: string) => string,
 *   verifyArtifact: ArtifactVerifier,
 *   liveRoutes: (manifest: Record<string, unknown>) => string[],
 *   routeFile?: (route: string, manifest: Record<string, unknown>) => string,
 *   assetUrl?: (path: string) => string | null,
 * }} DeployTarget */

/** @param {string} key @param {string} hostDirectory @returns {string} */
function hostArtifactDirectory(hostDirectory, key) {
  return resolve(root, hostDirectory, key.endsWith("-editor") ? "dist-editor" : "dist-site");
}

/** @param {string} key @param {string} hostDirectory @returns {DeployTarget} */
function createDemoEditorTarget(key, hostDirectory) {
  const name = key.slice(0, -"-editor".length);
  const domain = `zc-demo-${name}-editor.zudolab.dev`;
  return {
    key,
    kind: "demo-editor",
    workerName: `zc-demo-${name}-editor`,
    configPath: `wrangler.demo-${name}-editor.jsonc`,
    domain,
    hostDirectory: resolve(root, hostDirectory),
    artifactDirectory: hostArtifactDirectory(hostDirectory, key),
    manifestFileName: DEMO_EDITOR_MANIFEST,
    ciArtifactName: (sha) => `demo-editor-${name}-${sha}`,
    verifyArtifact: verifyDemoEditorArtifact,
    liveRoutes: verifiedDemoEditorRoutes,
  };
}

/** @param {string} key @param {string} hostDirectory @param {string} workerName @param {string} configPath @param {string} domain @returns {DeployTarget} */
function createStaticTarget(key, hostDirectory, workerName, configPath, domain) {
  return {
    key,
    kind: "site-static",
    workerName,
    configPath,
    domain,
    hostDirectory: resolve(root, hostDirectory),
    artifactDirectory: hostArtifactDirectory(hostDirectory, key),
    manifestFileName: SITE_MANIFEST,
    ciArtifactName: (sha) => `demo-site-${key}-${sha}`,
    verifyArtifact: verifySiteStaticTargetArtifact,
    liveRoutes: (manifest) => /** @type {string[]} */ (manifest.routes),
  };
}

/** @param {string} key @param {string} workerName @param {string} configPath @param {string} domain @param {string} artifactDirectory @param {string} artifactPrefix @param {string} hostDirectory @returns {DeployTarget} */
function createDocSiteTarget(key, workerName, configPath, domain, artifactDirectory, artifactPrefix, hostDirectory) {
  return {
    key,
    kind: "doc-site",
    workerName,
    configPath,
    domain,
    hostDirectory: resolve(root, hostDirectory),
    artifactDirectory: resolve(root, artifactDirectory),
    manifestFileName: DOC_SITE_MANIFEST,
    ciArtifactName: (sha) => `${artifactPrefix}-${sha}`,
    // The doc verifier keeps local builds usable without Git metadata. The
    // production preflight requires an expected full SHA before any mutation.
    verifyArtifact: verifyDocSiteArtifact,
    liveRoutes: (manifest) => /** @type {string[]} */ (manifest.routes),
    routeFile: (route) => {
      if (route === "/") return "index.html";
      const path = route.replace(/^\//, "").replace(/\/$/, "");
      return route.endsWith("/") ? `${path}/index.html` : `${path}.html`;
    },
    // auto-trailing-slash redirects /x.html to /x. Fetch the canonical URL
    // without navigation headers to verify its untransformed asset bytes.
    assetUrl: (path) => path === "index.html" || path.endsWith("/index.html") ? null : path.endsWith(".html") ? `/${path.slice(0, -".html".length)}` : `/${path}`,
  };
}

/** @type {Record<string, DeployTarget>} */
export const TARGETS = {
  doc: createDocSiteTarget("doc", "zudo-composer", "wrangler.doc.jsonc", "zudo-composer.zudolab.dev", "doc/dist", "doc-site", "doc"),
  sample: createStaticTarget("sample", "packages/demo-sample", "zc-demo-sample", "wrangler.demo-sample.jsonc", "zc-demo-sample.zudolab.dev"),
  shop: createStaticTarget("shop", "packages/demo-webshop", "zc-demo-shop", "wrangler.demo-shop.jsonc", "zc-demo-shop.zudolab.dev"),
  landing: createStaticTarget("landing", "packages/demo-landing", "zc-demo-landing", "wrangler.demo-landing.jsonc", "zc-demo-landing.zudolab.dev"),
  blog: createStaticTarget("blog", "packages/demo-blog", "zc-demo-blog", "wrangler.demo-blog.jsonc", "zc-demo-blog.zudolab.dev"),
  "sample-editor": createDemoEditorTarget("sample-editor", "packages/demo-sample"),
  "shop-editor": createDemoEditorTarget("shop-editor", "packages/demo-webshop"),
  "landing-editor": createDemoEditorTarget("landing-editor", "packages/demo-landing"),
  "blog-editor": createDemoEditorTarget("blog-editor", "packages/demo-blog"),
  "sample-sg": createDocSiteTarget("sample-sg", "zc-sg-sample", "wrangler.sample-sg.jsonc", "zc-sg-sample.zudolab.dev", "styleguide/sample/dist", "sample-sg-site", "styleguide/sample"),
  "shop-sg": createDocSiteTarget("shop-sg", "zc-sg-shop", "wrangler.shop-sg.jsonc", "zc-sg-shop.zudolab.dev", "styleguide/shop/dist", "shop-sg-site", "styleguide/shop"),
  "landing-sg": createDocSiteTarget("landing-sg", "zc-sg-landing", "wrangler.landing-sg.jsonc", "zc-sg-landing.zudolab.dev", "styleguide/landing/dist", "landing-sg-site", "styleguide/landing"),
  "blog-sg": createDocSiteTarget("blog-sg", "zc-sg-blog", "wrangler.blog-sg.jsonc", "zc-sg-blog.zudolab.dev", "styleguide/blog/dist", "blog-sg-site", "styleguide/blog"),
};

export const STYLEGUIDE_TARGET_KEYS = /** @type {const} */ (["sample-sg", "shop-sg", "landing-sg", "blog-sg"]);
export const TARGET_KEYS = /** @type {const} */ (["doc", "sample", "shop", "landing", "blog", "sample-editor", "shop-editor", "landing-editor", "blog-editor", ...STYLEGUIDE_TARGET_KEYS]);

/** @param {string | undefined} key @returns {DeployTarget} */
export function resolveTarget(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error(`Hosted-demo deployment target is required. Set HOSTED_DEMO_TARGET or pass --target. Known targets: ${TARGET_KEYS.join(", ")}`);
  const target = TARGETS[key];
  if (!target) throw new Error(`Unknown hosted-demo deploy target: ${key}. Known targets: ${TARGET_KEYS.join(", ")}`);
  return target;
}
