// @ts-check
// The trusted-run deploy pipeline (deploy.mjs, live-check.mjs,
// check-hosted-demo.mjs) is shared by four Cloudflare Workers: the disposable
// hosted composer demo and three static demo websites. This module is the
// single place that names each target's Worker, config file, artifact
// directory, domain and artifact-verification shape so those scripts stay
// generic. workflow-guard.mjs needs none of this: its trusted-run checks are
// identical for every target.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { HOSTED_DEMO_MANIFEST, expectedMime, verifyHostedDemoArtifact } from "./artifact.mjs";
import { SITE_HEADERS, SITE_MANIFEST, verifySiteStaticArtifact } from "../site-static/artifact.mjs";
import { SPA_ROUTES } from "../routes.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** Fixed route list for the hosted composer demo; it carries no route data in its own manifest. */
export const HOSTED_DEMO_LIVE_ROUTES = [...SPA_ROUTES, "/review", "/website-preview"];

/** @typedef {{ path: string, sha256: string, mime: string }} TargetFile */
// Both manifest shapes (hosted-demo and site-static) carry `sourceRevision`;
// every other field is target-kind-specific and stays untyped here.
/** @typedef {{ root: string, manifest: Record<string, unknown> & { sourceRevision: string }, files: TargetFile[] }} TargetArtifact */
/**
 * Every target's artifact verifier is widened to this shared, loosely typed
 * shape: `deploy.mjs` and `live-check.mjs` are generic over any target and
 * cannot know the manifest shape (hosted-demo vs. site-static) in advance.
 * @typedef {(options: { directory: string, expectedSourceRevision?: string }) => Promise<TargetArtifact>} ArtifactVerifier
 */

/**
 * @param {{ directory: string, expectedSourceRevision?: string }} options
 * @returns {Promise<TargetArtifact>}
 */
async function verifyHostedDemoTargetArtifact(options) {
  // Already returns { root, manifest, files: [{ path, sha256, mime }] }.
  return verifyHostedDemoArtifact(options);
}

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
  const files = Object.entries(manifest.files)
    .filter(([path]) => path !== SITE_HEADERS)
    .map(([path, sha256]) => ({ path, sha256, mime: expectedMime(path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { root: resolve(directory), manifest, files };
}

/** @typedef {{
 *   key: string,
 *   kind: "hosted-demo" | "site-static",
 *   workerName: string,
 *   configPath: string,
 *   domain: string,
 *   artifactDirectory: string,
 *   manifestFileName: string,
 *   ciArtifactName: (sha: string) => string,
 *   verifyArtifact: ArtifactVerifier,
 *   liveRoutes: (manifest: Record<string, unknown>) => string[],
 * }} DeployTarget */

/** @type {Record<string, DeployTarget>} */
export const TARGETS = {
  "zudo-composer": {
    key: "zudo-composer",
    kind: "hosted-demo",
    workerName: "zudo-composer",
    configPath: "wrangler.jsonc",
    domain: "zudo-composer.zudolab.dev",
    artifactDirectory: resolve(root, "dist-hosted-demo"),
    manifestFileName: HOSTED_DEMO_MANIFEST,
    ciArtifactName: (sha) => `hosted-demo-${sha}`,
    verifyArtifact: verifyHostedDemoTargetArtifact,
    liveRoutes: () => HOSTED_DEMO_LIVE_ROUTES,
  },
  webshop: {
    key: "webshop",
    kind: "site-static",
    workerName: "zudo-composer-demo-shop",
    configPath: "wrangler.demo-shop.jsonc",
    domain: "zc-demo-shop.zudolab.dev",
    artifactDirectory: resolve(root, "packages/demo-webshop/dist-site"),
    manifestFileName: SITE_MANIFEST,
    ciArtifactName: (sha) => `demo-site-webshop-${sha}`,
    verifyArtifact: verifySiteStaticTargetArtifact,
    liveRoutes: (manifest) => /** @type {string[]} */ (manifest.routes),
  },
  landing: {
    key: "landing",
    kind: "site-static",
    workerName: "zudo-composer-demo-landing",
    configPath: "wrangler.demo-landing.jsonc",
    domain: "zc-demo-landing.zudolab.dev",
    artifactDirectory: resolve(root, "packages/demo-landing/dist-site"),
    manifestFileName: SITE_MANIFEST,
    ciArtifactName: (sha) => `demo-site-landing-${sha}`,
    verifyArtifact: verifySiteStaticTargetArtifact,
    liveRoutes: (manifest) => /** @type {string[]} */ (manifest.routes),
  },
  blog: {
    key: "blog",
    kind: "site-static",
    workerName: "zudo-composer-demo-blog",
    configPath: "wrangler.demo-blog.jsonc",
    domain: "zc-demo-blog.zudolab.dev",
    artifactDirectory: resolve(root, "packages/demo-blog/dist-site"),
    manifestFileName: SITE_MANIFEST,
    ciArtifactName: (sha) => `demo-site-blog-${sha}`,
    verifyArtifact: verifySiteStaticTargetArtifact,
    liveRoutes: (manifest) => /** @type {string[]} */ (manifest.routes),
  },
};

export const TARGET_KEYS = /** @type {const} */ (["zudo-composer", "webshop", "landing", "blog"]);
export const DEFAULT_TARGET_KEY = "zudo-composer";

/** @param {string} key @returns {DeployTarget} */
export function resolveTarget(key) {
  const target = TARGETS[key];
  if (!target) throw new Error(`Unknown hosted-demo deploy target: ${key}. Known targets: ${TARGET_KEYS.join(", ")}`);
  return target;
}
