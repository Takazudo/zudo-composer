// @ts-check
// Dev-only HTTP guards shared by every filesystem transport endpoint.
//
// Composer, Assets and each domain endpoint enforce the same admission rules:
// exact URL, POST only, a same-origin development request, a per-dev-server
// capability compared in constant time, and a declared content type. Keeping
// one implementation means a new domain endpoint cannot accidentally ship a
// weaker door than the ones already in place.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** @typedef {{url?: string, method?: string, protocol?: "http" | "https", headers: Record<string, string | undefined>, body?: string}} DevRequest */
/** @typedef {{status: number, headers: Record<string, string>, body: string, bodyEncoding: "utf8"}} DevResponse */

export const FILE_PROVIDER_CAPABILITY_HEADER = "x-zudo-composer-capability";
export const FILE_PROVIDER_OPERATION_HEADER = "x-zudo-composer-operation";
/**
 * Which workspace the request addresses. The browser names it; only the server
 * turns that name into a directory below a domain root. `src/shared/file-provider/protocol.ts`
 * carries the same spelling for the browser half — plugin modules run in the
 * Vite config graph and must never be pulled into the bundle.
 */
export const FILE_PROVIDER_WORKSPACE_HEADER = "x-zudo-composer-workspace";
export const FILE_PROVIDER_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Workspace ids are directory names here, so they are held to the same
 * record-id rule the browser applies. `src/shared/record-identity.ts` owns the
 * pattern; this repeats it for the same reason the header does.
 *
 * @param {unknown} value @returns {value is string}
 */
export function isSafeWorkspaceHeader(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/.test(value);
}

/** One capability per dev server closure. Never persisted, never reused. */
export function createDevCapability() {
  return randomBytes(32).toString("base64url");
}

/** `/__zudo_composer_content_provider`, `/__zudo_composer_mapping_provider`, … */
export function domainFileProviderEndpoint(domain) {
  if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(domain)) {
    throw new RangeError(`A file-provider domain must be a short lowercase name: ${JSON.stringify(domain)}`);
  }
  return `/__zudo_composer_${domain.replace(/-/g, "_")}_provider`;
}

const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

/**
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 * @returns {DevResponse}
 */
export function json(status, payload, headers = {}) {
  return {
    status,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(payload),
    bodyEncoding: "utf8",
  };
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {string | undefined} [operation]
 * @param {Record<string, string>} [headers]
 */
export function errorResponse(status, code, message, operation, headers) {
  return json(status, {
    ok: false,
    error: { code, message, ...(operation === undefined ? {} : { operation }) },
  }, headers);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string[]} required
 * @param {string[]} [optional]
 */
export function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

/** @param {string | undefined} body */
export function bodyBytes(body) {
  return Buffer.byteLength(body ?? "", "utf8");
}

/** @param {DevRequest} req */
export function isSameOriginDevRequest(req) {
  if (req.headers["sec-fetch-site"] !== "same-origin") return false;
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (!host || !origin || /[\s,]/.test(host)) return false;
  try {
    const expected = new URL(`${req.protocol ?? "http"}://${host}`).origin;
    return new URL(origin).origin === expected && origin === expected;
  } catch {
    return false;
  }
}

/** @param {DevRequest} req @param {string} expected */
export function hasCapability(req, expected, header = FILE_PROVIDER_CAPABILITY_HEADER) {
  const supplied = req.headers[header];
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateRequestHead(
  req,
  endpoint,
  capability,
  acceptedAssetTypes = new Set(["application/json"]),
  unsupportedAssetTypeMessage = "Content-Type must be application/json.",
  allowAnyAssetType = false,
) {
  if (req.url !== endpoint) return errorResponse(404, "not-found", "File-provider route not found.");
  if (req.method !== "POST") {
    return errorResponse(405, "method-not-allowed", "Only POST is allowed.", undefined, { allow: "POST" });
  }
  if (!isSameOriginDevRequest(req)) {
    return errorResponse(403, "origin-rejected", "A same-origin development request is required.");
  }
  if (!hasCapability(req, capability)) {
    return errorResponse(401, "invalid-capability", "The development file capability is missing or invalid.");
  }
  const mimeType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType === undefined || (!allowAnyAssetType && !acceptedAssetTypes.has(mimeType))) {
    return errorResponse(415, "unsupported-media-type", unsupportedAssetTypeMessage);
  }
  return undefined;
}

export function isDeadResponse(req, res) {
  return req.aborted === true || req.socket?.destroyed === true || res.destroyed === true || res.writableEnded === true;
}

/** Read a Connect request without ever buffering more than the public limit. */
export function readBody(req, maxBodyBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let ended = false;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectBody(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        rejectOnce(Object.assign(new Error("body-too-large"), { code: "BODY_TOO_LARGE" }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      ended = true;
      settled = true;
      cleanup();
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error) => rejectOnce(error);
    const onAborted = () => rejectOnce(Object.assign(new Error("request-aborted"), { code: "REQUEST_ABORTED" }));
    const onClose = () => {
      if (!ended) rejectOnce(Object.assign(new Error("request-closed"), { code: "REQUEST_ABORTED" }));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
  });
}

export function sendConnectResponse(res, response) {
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.end(response.body);
}

/**
 * Adapt a Connect request to the plain head this module validates.
 * @param {import("node:http").IncomingMessage} req
 */
export function connectRequestHead(req) {
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([name, value]) => [name, Array.isArray(value) ? undefined : value]),
    ),
    protocol: /** @type {any} */ (req).socket?.encrypted === true ? "https" : "http",
  };
}
