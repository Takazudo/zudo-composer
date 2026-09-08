// @ts-check

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { HOSTED_DEMO_MANIFEST, sha256, verifyHostedDemoArtifact } from "./artifact.mjs";
import { SPA_ROUTES } from "../routes.mjs";

export const LIVE_ORIGIN = "https://zudo-composer.zudolab.dev";
export const HTTP_TIMEOUT_MS = 10_000;
export const LIVE_CHECK_TIMEOUT_MS = 120_000;
// A deploy can take a short time to reach every edge. Keep retries bounded so
// a broken production rollout cannot hold the workflow indefinitely.
export const LIVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
export const HOSTED_DEMO_LIVE_ROUTES = [
  ...SPA_ROUTES,
  "/review",
  "/website-preview",
];

/** @param {Response} response @returns {string} */
export function responseMime(response) {
  return response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

/**
 * @param {(input: URL | string, init?: RequestInit) => Promise<Response>} fetchImpl
 * @param {URL} url
 * @param {number} timeoutMs
 * @param {Record<string, string>} [headers]
 * @param {number} [deadlineAt]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(fetchImpl, url, timeoutMs, headers = {}, deadlineAt = Number.POSITIVE_INFINITY) {
  const remainingMs = Math.min(timeoutMs, deadlineAt - Date.now());
  if (remainingMs <= 0) throw new Error("Hosted demo live check exceeded its overall deadline");
  return fetchImpl(url, {
    redirect: "error",
    cache: "no-store",
    headers,
    signal: globalThis.AbortSignal.timeout(remainingMs),
  });
}

/** @param {URL} url @param {string} sourceRevision @returns {URL} */
function cacheBusted(url, sourceRevision) {
  const result = new URL(url);
  result.searchParams.set("hosted-demo-revision", sourceRevision);
  return result;
}

/**
 * @param {{ baseUrl: string, artifactDirectory: string, expectedSourceRevision?: string, fetchImpl?: (input: URL | string, init?: RequestInit) => Promise<Response>, requestTimeoutMs?: number, overallTimeoutMs?: number }} options
 */
export async function verifyLiveDeployment({
  baseUrl,
  artifactDirectory,
  expectedSourceRevision,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = HTTP_TIMEOUT_MS,
  overallTimeoutMs = LIVE_CHECK_TIMEOUT_MS,
}) {
  assert.equal(typeof fetchImpl, "function", "A fetch implementation is required for live verification");
  const artifact = await verifyHostedDemoArtifact({ directory: artifactDirectory, expectedSourceRevision });
  const origin = new URL(baseUrl);
  assert.ok(origin.protocol === "https:" || origin.hostname === "127.0.0.1" || origin.hostname === "localhost", "Live verification requires HTTPS or loopback");
  const sourceRevision = artifact.manifest.sourceRevision;
  const deadlineAt = Date.now() + overallTimeoutMs;

  const manifestUrl = cacheBusted(new URL(`/${HOSTED_DEMO_MANIFEST}`, origin), sourceRevision);
  const manifestResponse = await fetchWithTimeout(fetchImpl, manifestUrl, requestTimeoutMs, { accept: "application/json" }, deadlineAt);
  assert.ok(manifestResponse.ok, `/${HOSTED_DEMO_MANIFEST}: expected HTTP 2xx, received ${manifestResponse.status}`);
  assert.equal(responseMime(manifestResponse), "application/json", `/${HOSTED_DEMO_MANIFEST}: expected application/json, received ${responseMime(manifestResponse) || "no Content-Type"}`);
  const remoteManifest = JSON.parse(await manifestResponse.text());
  assert.deepEqual(remoteManifest, artifact.manifest, "Live hosted-demo manifest does not match the downloaded artifact");

  const index = artifact.files.find((file) => file.path === "index.html");
  assert.ok(index, "Hosted artifact must include index.html");
  const routeResults = await Promise.all(HOSTED_DEMO_LIVE_ROUTES.map(async (route) => {
    const response = await fetchWithTimeout(fetchImpl, cacheBusted(new URL(route, origin), sourceRevision), requestTimeoutMs, {
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    }, deadlineAt);
    assert.ok(response.ok, `${route}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), index.sha256, `${route}: response does not match index.html SHA-256`);
    assert.equal(responseMime(response), index.mime, `${route}: expected ${index.mime}, received ${responseMime(response) || "no Content-Type"}`);
    return { path: route, sha256: index.sha256, mime: index.mime };
  }));

  const assetResults = await Promise.all(artifact.files.filter((file) => file.path !== "index.html").map(async (file) => {
    const response = await fetchWithTimeout(fetchImpl, cacheBusted(new URL(`/${file.path}`, origin), sourceRevision), requestTimeoutMs, {}, deadlineAt);
    assert.ok(response.ok, `/${file.path}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), file.sha256, `/${file.path}: response SHA-256 does not match the built artifact`);
    assert.equal(responseMime(response), file.mime, `/${file.path}: expected ${file.mime}, received ${responseMime(response) || "no Content-Type"}`);
    return { path: file.path, sha256: file.sha256, mime: file.mime };
  }));

  return { manifest: artifact.manifest, routes: routeResults, assets: assetResults };
}

/**
 * @param {{ retryDelaysMs?: number[], delayImpl?: (milliseconds: number) => Promise<void>, onRetry?: (value: { attempt: number, delayMs: number, error: Error }) => void } & Parameters<typeof verifyLiveDeployment>[0]} options
 */
export async function verifyLiveWithRetries({
  retryDelaysMs = LIVE_RETRY_DELAYS_MS,
  delayImpl = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  onRetry = () => {},
  ...options
}) {
  const overallDeadlineAt = Date.now() + (options.overallTimeoutMs ?? LIVE_CHECK_TIMEOUT_MS);
  /** @type {Error | undefined} */
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const remainingMs = overallDeadlineAt - Date.now();
    if (remainingMs <= 0) break;
    try {
      return await verifyLiveDeployment({ ...options, overallTimeoutMs: remainingMs });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === retryDelaysMs.length) break;
      const delayMs = retryDelaysMs[attempt];
      if (overallDeadlineAt - Date.now() <= 0) break;
      onRetry({ attempt: attempt + 1, delayMs, error: lastError });
      await delayImpl(Math.min(delayMs, Math.max(0, overallDeadlineAt - Date.now())));
    }
  }
  throw lastError ?? new Error("Live hosted-demo verification failed without a diagnostic");
}

/** @param {string[]} argv @returns {Record<string, string | undefined>} */
function parseArguments(argv) {
  /** @type {Record<string, string | undefined>} */
  const options = {};
  const args = [...argv];
  if (args[0] === "--") args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replaceAll("-", "_");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArguments(process.argv.slice(2));
  const baseUrl = options.base_url ?? process.env.HOSTED_DEMO_BASE_URL ?? LIVE_ORIGIN;
  const artifactDirectory = options.artifact ?? process.env.HOSTED_DEMO_ARTIFACT ?? "dist-hosted-demo";
  const expectedSourceRevision = options.expected_sha ?? process.env.HOSTED_DEMO_EXPECTED_SHA;
  const proof = await verifyLiveWithRetries({
    baseUrl,
    artifactDirectory,
    expectedSourceRevision,
    onRetry: ({ attempt, delayMs, error }) => console.warn(`Hosted demo live check attempt ${attempt} failed (${error.message}); retrying in ${delayMs}ms.`),
  });
  console.log(`Hosted demo live check passed at ${baseUrl}: ${proof.routes.length} routes and ${proof.assets.length} assets matched source ${proof.manifest.sourceRevision}.`);
}
