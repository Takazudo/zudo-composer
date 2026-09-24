// @ts-check

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { sha256 } from "./artifact.mjs";
import { resolveTarget } from "./targets.mjs";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition } from "../../src/assets/model/asset-kinds.mjs";

/** @typedef {import("./targets.mjs").DeployTarget} DeployTarget */

/** @param {DeployTarget | undefined} target @returns {DeployTarget} */
function requireTarget(target) {
  assert.ok(target, "Hosted-demo live-check target is required; pass a target explicitly or set HOSTED_DEMO_TARGET.");
  return target;
}

export const HTTP_TIMEOUT_MS = 10_000;
export const LIVE_CHECK_TIMEOUT_MS = 180_000;
// `waitForVersion` proves only that Cloudflare's control plane activated the
// new version; a PoP can still answer the next request from its cache of the
// previous build. Measured on `main`: 6 of 10 production deploys failed this
// way, on a route that moved between runs, with `cf-cache-status HIT` and a
// body that was byte-for-byte an earlier build. The former ~7s budget did not
// span that window. Keep retries bounded so a genuinely broken rollout cannot
// hold the workflow indefinitely; the comparison itself never loosens.
export const LIVE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000, 30_000, 30_000, 30_000];

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
 * @param {"GET" | "HEAD"} [method]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(fetchImpl, url, timeoutMs, headers = {}, deadlineAt = Number.POSITIVE_INFINITY, method = "GET") {
  const remainingMs = Math.min(timeoutMs, deadlineAt - Date.now());
  if (remainingMs <= 0) throw new Error("Hosted demo live check exceeded its overall deadline");
  return fetchImpl(url, {
    method,
    redirect: "error",
    cache: "no-store",
    headers,
    signal: globalThis.AbortSignal.timeout(remainingMs),
  });
}

/**
 * Every attempt must ask for a URL this run has never requested before.
 * Retrying the identical URL after an edge cache answered HIT can only return
 * the same stale bytes, which is why the earlier retries never rescued a
 * propagation-lag failure. The revision alone does not achieve that: it is
 * constant for the whole run, so the attempt ordinal is what makes each retry
 * a fresh cache key.
 * @param {URL} url
 * @param {string | undefined} sourceRevision
 * @param {number | undefined} attempt
 * @returns {URL}
 */
function cacheBusted(url, sourceRevision, attempt) {
  const result = new URL(url);
  if (sourceRevision !== undefined) result.searchParams.set("hosted-demo-revision", sourceRevision);
  if (attempt !== undefined && attempt > 1) result.searchParams.set("hosted-demo-attempt", String(attempt));
  return result;
}

/**
 * The failing target moves between runs, so a bare byte-equality failure
 * gives no lead on which transformation happened. This locates the first
 * differing byte and slices bounded context around it from both sides.
 * @param {Buffer} actual
 * @param {Buffer} expected
 * @param {number} [radius]
 * @returns {{ offset: number, actualContext: string, expectedContext: string } | undefined}
 */
function firstByteDifference(actual, expected, radius = 120) {
  const compareLength = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < compareLength && actual[offset] === expected[offset]) offset += 1;
  if (offset === compareLength && actual.length === expected.length) return undefined;
  const start = Math.max(0, offset - radius);
  return {
    offset,
    actualContext: actual.subarray(start, Math.min(actual.length, offset + radius)).toString("utf8"),
    expectedContext: expected.subarray(start, Math.min(expected.length, offset + radius)).toString("utf8"),
  };
}

/**
 * Bounded, failure-only diagnostics naming which transformation broke the
 * comparison, so a failing live check points at a cause instead of a bare
 * mismatch. Never included on success, and never dumps whole documents.
 * @param {Buffer} actualBytes
 * @param {{ expectedBytes?: Buffer, headers?: Headers, attempt?: number }} [diagnostics]
 */
function describeMismatch(actualBytes, diagnostics) {
  if (!diagnostics) return "";
  const { expectedBytes, headers, attempt } = diagnostics;
  /** @type {string[]} */
  const parts = [];
  if (attempt !== undefined) parts.push(`attempt ${attempt}`);
  if (expectedBytes) {
    parts.push(`response length ${actualBytes.length} bytes, expected length ${expectedBytes.length} bytes`);
    const difference = firstByteDifference(actualBytes, expectedBytes);
    if (difference) {
      parts.push(`first differing byte offset ${difference.offset}`);
      parts.push(`response context ${JSON.stringify(difference.actualContext)}`);
      parts.push(`expected context ${JSON.stringify(difference.expectedContext)}`);
    }
  }
  if (headers) {
    parts.push(`content-length ${headers.get("content-length") ?? "(none)"}, content-encoding ${headers.get("content-encoding") ?? "(none)"}`);
    for (const name of ["cf-cache-status", "age", "etag", "cf-ray"]) parts.push(`${name} ${headers.get(name) ?? "(none)"}`);
  }
  return parts.length === 0 ? "" : ` [${parts.join("; ")}]`;
}

/**
 * Cloudflare injects its documented RUM beacon into navigation HTML. Permit
 * only that exact empty external script immediately before the closing body;
 * every other byte must still match the tested HTML file. Targets may also
 * verify the untransformed HTML separately with the other artifact files.
 * @param {Buffer} bytes
 * @param {string} expectedSha256
 * @param {string} [expectedFile]
 * @param {{ expectedBytes?: Buffer, headers?: Headers, attempt?: number }} [diagnostics]
 */
export function verifyNavigationHtml(bytes, expectedSha256, expectedFile = "index.html", diagnostics) {
  const responseSha256 = sha256(bytes);
  if (responseSha256 === expectedSha256) return { responseSha256, cloudflareAnalyticsInjected: false };
  const beacon = /<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/v[0-9a-f]+" integrity="sha512-[A-Za-z0-9+/=]+" data-cf-beacon='([^'<>\r\n]+)' crossorigin="anonymous"><\/script>\n(?=<\/body>)/gu;
  const html = bytes.toString("utf8");
  const matches = [...html.matchAll(beacon)];
  assert.equal(matches.length, 1, `Navigation HTML differs from ${expectedFile} without exactly one recognized Cloudflare analytics injection${describeMismatch(bytes, diagnostics)}`);
  const config = JSON.parse(matches[0][1]);
  assert.ok(config && typeof config === "object" && typeof config.version === "string" && /^[a-f0-9]{32}$/.test(config.token), "Cloudflare analytics injection has an unexpected configuration");
  const stripped = Buffer.from(html.replace(beacon, ""));
  assert.equal(sha256(stripped), expectedSha256, `Navigation HTML contains changes beyond Cloudflare analytics injection${describeMismatch(stripped, diagnostics)}`);
  return { responseSha256, cloudflareAnalyticsInjected: true };
}

/**
 * @param {{ target?: DeployTarget, baseUrl: string, artifactDirectory: string, expectedSourceRevision?: string, fetchImpl?: (input: URL | string, init?: RequestInit) => Promise<Response>, requestTimeoutMs?: number, overallTimeoutMs?: number, manifestFileName?: string, artifactVerifier?: import("./targets.mjs").ArtifactVerifier, liveRoutes?: (manifest: Record<string, unknown>) => string[], routeFile?: DeployTarget["routeFile"], assetUrl?: DeployTarget["assetUrl"], attempt?: number }} options
 */
export async function verifyLiveDeployment(options) {
  const target = requireTarget(options.target);
  const {
    baseUrl,
    artifactDirectory,
    expectedSourceRevision,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = HTTP_TIMEOUT_MS,
    overallTimeoutMs = LIVE_CHECK_TIMEOUT_MS,
    attempt,
  } = options;
  const manifestFileName = options.manifestFileName ?? target.manifestFileName;
  const artifactVerifier = options.artifactVerifier ?? target.verifyArtifact;
  const liveRoutes = options.liveRoutes ?? target.liveRoutes;
  const routeFile = options.routeFile ?? target.routeFile ?? (() => "index.html");
  const assetUrl = options.assetUrl ?? target.assetUrl ?? ((path) => path === "index.html" ? "/" : `/${path}`);
  assert.equal(typeof fetchImpl, "function", "A fetch implementation is required for live verification");
  const artifact = await artifactVerifier({ directory: artifactDirectory, expectedSourceRevision });
  const origin = new URL(baseUrl);
  assert.ok(origin.protocol === "https:" || origin.hostname === "127.0.0.1" || origin.hostname === "localhost", "Live verification requires HTTPS or loopback");
  const sourceRevision = artifact.manifest.sourceRevision;
  const deadlineAt = Date.now() + overallTimeoutMs;

  const manifestUrl = cacheBusted(new URL(`/${manifestFileName}`, origin), sourceRevision, attempt);
  const manifestResponse = await fetchWithTimeout(fetchImpl, manifestUrl, requestTimeoutMs, { accept: "application/json" }, deadlineAt);
  assert.ok(manifestResponse.ok, `/${manifestFileName}: expected HTTP 2xx, received ${manifestResponse.status}`);
  assert.equal(responseMime(manifestResponse), "application/json", `/${manifestFileName}: expected application/json, received ${responseMime(manifestResponse) || "no Content-Type"}`);
  const remoteManifest = JSON.parse(await manifestResponse.text());
  assert.deepEqual(remoteManifest, artifact.manifest, "Live deployment manifest does not match the downloaded artifact");

  const filesByPath = new Map(artifact.files.map((file) => [file.path, file]));
  assert.ok(filesByPath.has("index.html"), "Deploy artifact must include index.html");
  /** @param {import("./targets.mjs").TargetFile} file @param {string} context @param {Response} response */
  function assertMime(file, context, response) {
    const acceptedMimes = [...new Set([file.mime, ...(file.acceptedMimes ?? [])])];
    const actualMime = responseMime(response);
    assert.ok(acceptedMimes.includes(actualMime), `${context}: expected ${acceptedMimes.join(" or ")}, received ${actualMime || "no Content-Type"}`);
  }
  /** @type {Set<string>} */
  const verifiedRouteFiles = new Set();
  const routeResults = await Promise.all(liveRoutes(artifact.manifest).map(async (route) => {
    const expectedPath = routeFile(route, artifact.manifest);
    const file = filesByPath.get(expectedPath);
    assert.ok(file, `${route}: deploy artifact must include route file ${expectedPath}`);
    assert.equal(file.mime, "text/html", `${route}: route file ${file.path} must be HTML, received ${file.mime}`);
    const response = await fetchWithTimeout(fetchImpl, cacheBusted(new URL(route, origin), sourceRevision, attempt), requestTimeoutMs, {
      accept: "text/html",
      "sec-fetch-mode": "navigate",
    }, deadlineAt);
    assert.ok(response.ok, `${route}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    let navigationProof;
    try {
      navigationProof = verifyNavigationHtml(bytes, file.sha256, file.path);
    } catch (error) {
      // Only reached on an actual mismatch (the common Cloudflare-analytics-
      // injected pass never gets here), so the extra disk read for evidence
      // happens only on the failure path it explains.
      const expectedBytes = await readFile(resolve(artifactDirectory, file.path)).catch(() => undefined);
      let diagnosedMessage = error instanceof Error ? error.message : String(error);
      try {
        verifyNavigationHtml(bytes, file.sha256, file.path, { expectedBytes, headers: response.headers, attempt });
      } catch (diagnosed) {
        diagnosedMessage = diagnosed instanceof Error ? diagnosed.message : String(diagnosed);
      }
      throw new Error(`${route}: navigation HTML does not match ${file.path}: ${diagnosedMessage}`, { cause: error });
    }
    assertMime(file, route, response);
    verifiedRouteFiles.add(file.path);
    return { path: route, sha256: file.sha256, mime: file.mime, ...navigationProof };
  }));

  const assetResults = (await Promise.all(artifact.files.map(async (file) => {
    // Static Assets canonicalizes /index.html to /. A non-navigation request
    // to that canonical URL returns the original file without RUM injection.
    // Multi-page targets can map other HTML URLs or rely on their route proof.
    const assetPath = assetUrl(file.path);
    if (assetPath === null) {
      assert.ok(verifiedRouteFiles.has(file.path), `/${file.path}: asset fetch cannot be skipped without a verified route for this file`);
      return null;
    }
    const response = await fetchWithTimeout(fetchImpl, cacheBusted(new URL(assetPath, origin), sourceRevision, attempt), requestTimeoutMs, {}, deadlineAt);
    assert.ok(response.ok, `/${file.path}: expected HTTP 2xx, received ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), file.sha256, `/${file.path}: response SHA-256 does not match the built artifact`);
    assertMime(file, `/${file.path}`, response);
    if (ASSET_CHECKSUM_URL_PATTERN.test(`/${file.path}`)) {
      const checksum = file.path.slice("uploaded-assets/sha256-".length, file.path.lastIndexOf("."));
      assert.equal(response.headers.get("cache-control"), ASSET_IMMUTABLE_CACHE_CONTROL, `/${file.path}: immutable cache policy is missing`);
      assert.equal(response.headers.get("x-content-type-options"), ASSET_NOSNIFF, `/${file.path}: nosniff policy is missing`);
      assert.equal(response.headers.get("content-length"), String(bytes.byteLength), `/${file.path}: byte length header is wrong`);
      const disposition = assetContentDisposition(file.mime, checksum);
      assert.equal(response.headers.get("content-disposition"), disposition ?? null, `/${file.path}: download disposition is wrong`);
      const head = await fetchWithTimeout(fetchImpl, cacheBusted(new URL(assetPath, origin), sourceRevision, attempt), requestTimeoutMs, {}, deadlineAt, "HEAD");
      assert.ok(head.ok, `/${file.path}: HEAD expected HTTP 2xx, received ${head.status}`);
      // HTTP permits HEAD to omit Content-Length even when GET includes it.
      // The GET body and its length are checked above; reject a wrong HEAD
      // length whenever the server does provide one.
      const headLength = head.headers.get("content-length");
      if (headLength !== null) {
        assert.equal(headLength, response.headers.get("content-length"), `/${file.path}: GET and HEAD content-length headers differ`);
      }
      for (const header of ["content-type", "cache-control", "x-content-type-options", "content-disposition"]) {
        assert.equal(head.headers.get(header), response.headers.get(header), `/${file.path}: GET and HEAD ${header} headers differ`);
      }
    }
    return { path: file.path, sha256: file.sha256, mime: file.mime };
  }))).filter((result) => result !== null);

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
  const target = requireTarget(options.target);
  options = { ...options, target };
  const overallDeadlineAt = Date.now() + (options.overallTimeoutMs ?? LIVE_CHECK_TIMEOUT_MS);
  /** @type {Error | undefined} */
  let lastError;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const remainingMs = overallDeadlineAt - Date.now();
    if (remainingMs <= 0) break;
    try {
      return await verifyLiveDeployment({ ...options, overallTimeoutMs: remainingMs, attempt: attempt + 1 });
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
  const target = resolveTarget(options.target ?? process.env.HOSTED_DEMO_TARGET);
  const baseUrl = options.base_url ?? process.env.HOSTED_DEMO_BASE_URL ?? `https://${target.domain}`;
  const artifactDirectory = options.artifact ?? process.env.HOSTED_DEMO_ARTIFACT ?? target.artifactDirectory;
  const expectedSourceRevision = options.expected_sha ?? process.env.HOSTED_DEMO_EXPECTED_SHA;
  const proof = await verifyLiveWithRetries({
    target,
    baseUrl,
    artifactDirectory,
    expectedSourceRevision,
    manifestFileName: target.manifestFileName,
    artifactVerifier: target.verifyArtifact,
    liveRoutes: target.liveRoutes,
    routeFile: target.routeFile,
    assetUrl: target.assetUrl,
    onRetry: ({ attempt, delayMs, error }) => console.warn(`${target.workerName} live check attempt ${attempt} failed (${error.message}); retrying in ${delayMs}ms.`),
  });
  console.log(`${target.workerName} live check passed at ${baseUrl}: ${proof.routes.length} routes and ${proof.assets.length} assets matched${proof.manifest.sourceRevision === undefined ? "" : ` source ${proof.manifest.sourceRevision}`}.`);
}
