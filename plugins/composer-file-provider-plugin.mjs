// @ts-check
// Dev-only transport for the Composer filesystem store.
//
// The filesystem core deliberately knows nothing about HTTP or JSX generation.
// This plugin keeps that split intact: canonical records cross a capability-
// protected same-origin endpoint and the browser supplies a pure batch plan
// over an already-read dependency closure. The core never holds its filesystem
// queue while awaiting that browser planning round.

import { constants } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve, posix, isAbsolute, dirname, basename } from "node:path";

/** @param {string | undefined} root */
export function validateMediaStoreRoot(root) {
  if (root !== undefined && (!isAbsolute(root) || resolve(root) !== root)) throw new Error("Media store root must be an absolute resolved path.");
  return root;
}

/** @typedef {import("../src/composer/library/types.ts").CompositionRecord} CompositionRecord */
/** @typedef {{url?: string, method?: string, protocol?: "http" | "https", headers: Record<string, string | undefined>, body?: string}} DevRequest */
/** @typedef {{status: number, headers: Record<string, string>, body: string, bodyEncoding: "utf8"}} DevResponse */

export const COMPOSER_FILE_PROVIDER_ENDPOINT = "/__zudo_composer_file_provider";
export const COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER = "x-zudo-composer-capability";
/** UTF-8 bytes. Large enough for a substantial document plus generated JSX. */
export const COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const COMPOSER_FILE_PROVIDER_ROOT = "compositions";
export const MEDIA_FILE_PROVIDER_ENDPOINT = "/__zudo_composer_media_file_provider";
export const MEDIA_FILE_PROVIDER_OPERATION_HEADER = "x-zudo-composer-media-operation";
export const MEDIA_FILE_PROVIDER_FILE_NAME_HEADER = "x-zudo-composer-media-file-name";
export const MEDIA_FILE_PROVIDER_RECORD_ID_HEADER = "x-zudo-composer-media-record-id";
export const MEDIA_FILE_PROVIDER_METADATA_HEADER = "x-zudo-composer-media-metadata";
export const MEDIA_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const MEDIA_FILE_PROVIDER_ROOT = "media-store";
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/octet-stream"]);
const MEDIA_FILE_PROVIDER_BYTES_DIRECTORY = "versions";
const MEDIA_FILE_PROVIDER_BYTE_PATTERN = /^\/uploaded-media\/(sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf))$/;
const MEDIA_CONTENT_TYPE_BY_EXTENSION = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
});
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
// A valid 255-code-point display name can expand to 3,060 characters when
// encodeURIComponent represents astral Unicode as four percent-encoded bytes.
const MEDIA_ENCODED_FILE_NAME_MAX_LENGTH = 4096;

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
function json(status, payload, headers = {}) {
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
function errorResponse(status, code, message, operation, headers) {
  return json(status, {
    ok: false,
    error: { code, message, ...(operation === undefined ? {} : { operation }) },
  }, headers);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string[]} required
 * @param {string[]} [optional]
 */
function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key));
}

/** @param {unknown} value @returns {value is string} */
function isSafeId(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/.test(value);
}

/** @param {unknown} value @returns {Record<string, {status: "generated", code: string} | {status: "blocked", reason: string}> | undefined} */
function parseOutputsById(value) {
  if (!isPlainObject(value)) return undefined;
  /** @type {Record<string, {status: "generated", code: string} | {status: "blocked", reason: string}>} */
  const result = Object.create(null);
  for (const [id, output] of Object.entries(value)) {
    if (!isSafeId(id) || !isPlainObject(output)) return undefined;
    if (hasExactKeys(output, ["status", "code"]) && output.status === "generated" && typeof output.code === "string") {
      result[id] = { status: "generated", code: output.code };
      continue;
    }
    if (hasExactKeys(output, ["status", "reason"]) && output.status === "blocked" && typeof output.reason === "string" && output.reason.trim() !== "") {
      result[id] = { status: "blocked", reason: output.reason };
      continue;
    }
    return undefined;
  }
  return result;
}

/** @param {string | undefined} body */
function bodyBytes(body) {
  return Buffer.byteLength(body ?? "", "utf8");
}

/** @param {DevRequest} req */
function isSameOriginDevRequest(req) {
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

function validateRequestHead(
  req,
  endpoint,
  capability,
  acceptedMediaTypes = new Set(["application/json"]),
  unsupportedMediaTypeMessage = "Content-Type must be application/json.",
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
  const mediaType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === undefined || !acceptedMediaTypes.has(mediaType)) {
    return errorResponse(415, "unsupported-media-type", unsupportedMediaTypeMessage);
  }
  return undefined;
}

function isDeadResponse(req, res) {
  return req.aborted === true || req.socket?.destroyed === true || res.destroyed === true || res.writableEnded === true;
}

function mediaOperationError(value, operation) {
  if (value?.code === "BYTE_CAP_EXCEEDED") {
    return errorResponse(413, "body-too-large", `Upload exceeds the ${MEDIA_UPLOAD_MAX_BYTES}-byte limit. Choose a file no larger than 25 MiB.`, operation);
  }
  const code = typeof value?.code === "string" ? value.code : "unknown";
  if (code === "validation") return errorResponse(422, code, "Invalid Media request. Check metadata, revision preconditions, folder parents/names/trash state, and the allowed file signature and size.", operation);
  if (code === "blocked") return errorResponse(409, code, "A filesystem safety check blocked the media operation.", operation);
  if (code === "conflict") return errorResponse(409, code, "Media changed or another writer holds the mutation lock. Reload and retry. After a server crash, verify no writer is running before manual .mutation.lock recovery.", operation);
  if (code === "not-found") return errorResponse(404, code, "The Media asset, folder or exact version does not exist.", operation);
  if (code === "bytes-missing") return errorResponse(409, code, "Retained Media bytes are missing or corrupted.", operation);
  if (code === "recovery-required") return errorResponse(409, code, "Media catalog requires manual recovery. Source and all versions are preserved; inspect catalog.json.", operation);
  if (code === "commit-uncertain") return errorResponse(409, code, "Media catalog rename completed but durability is uncertain. Inspect its exact token/state and retained writer lock before recovery; do not retry blindly.", operation);
  if (code === "read-failed") return errorResponse(503, code, "Local media files could not be read. Check directory permissions and retry.", operation);
  if (code === "write-failed" || code === "transaction-failed") return errorResponse(500, code, "Local media files could not be updated. Check permissions and free space, then retry.", operation);
  return errorResponse(500, "unknown", "The local media provider failed unexpectedly. Retry or restart the development server.", operation);
}

function decodeMediaFileName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MEDIA_ENCODED_FILE_NAME_MAX_LENGTH) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

function mediaErrorCode(value) {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function sameMediaFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function isMissingMediaFileError(value) {
  const code = mediaErrorCode(value);
  return code === "ENOENT" || code === "ENOTDIR";
}

async function closeMediaFile(handle) {
  await Promise.resolve(handle?.close?.()).catch(() => undefined);
}

function sendMediaFileError(res) {
  if (res.headersSent === true || res.destroyed === true || res.writableEnded === true) return;
  res.statusCode = 500;
  res.setHeader("content-type", "text/plain");
  res.end("Unable to read uploaded media file.");
}

/**
 * Serve an uploaded media byte file directly from the development store.
 *
 * @param {{projectRoot: string, mediaStoreRoot?: string, createStore?: () => Promise<any>, operations?: {lstat?: typeof fsPromises.lstat, open?: typeof fsPromises.open, realpath?: typeof fsPromises.realpath}}} options
 */
export function createMediaFileMiddleware(options) {
  const configuredRoot = validateMediaStoreRoot(options.mediaStoreRoot) ?? resolve(options.projectRoot, MEDIA_FILE_PROVIDER_ROOT);
  const lstatFile = options.operations?.lstat ?? fsPromises.lstat;
  const openFile = options.operations?.open ?? fsPromises.open;
  const realpathFile = options.operations?.realpath ?? fsPromises.realpath;
  return async function mediaFileMiddleware(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const pathname = typeof req.url === "string" ? req.url.split("?", 1)[0] : undefined;
    // Vite can otherwise expose files below its project root via /@fs or
    // ordinary source-file URLs, even when they are outside publicDir.
    try {
      const decoded = typeof pathname === "string" ? posix.normalize(decodeURIComponent(pathname)) : "";
      const sourcePath = decoded.startsWith("/@fs/") ? decoded.slice(4) : resolve(options.projectRoot, `.${decoded}`);
      if (/(?:^|\/)media-store(?:\/|$)/.test(decoded) || sourcePath === configuredRoot || sourcePath.startsWith(`${configuredRoot}/`)) {
        res.statusCode = 404; res.setHeader("cache-control", "no-store"); res.end(); return;
      }
    } catch { res.statusCode = 400; res.end(); return; }
    const authoring = typeof pathname === "string" ? /^\/uploaded-media\/asset-([a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?)$/.exec(pathname) : undefined;
    if (authoring && options.createStore) {
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      try {
        const result = await (await options.createStore()).get(authoring[1]);
        if (result.status !== "loaded" || result.record.document.state !== "active") { res.statusCode = 404; res.end(); return; }
        const version = result.record.document.versions.find((version) => version.id === result.record.document.currentVersionId);
        res.statusCode = 307;
        res.setHeader("location", version.url);
        res.end();
      } catch { sendMediaFileError(res); }
      return;
    }
    const match = pathname === undefined ? undefined : MEDIA_FILE_PROVIDER_BYTE_PATTERN.exec(pathname);
    const fileName = match?.[1];
    if (fileName === undefined) return next();

    const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
    const contentType = MEDIA_CONTENT_TYPE_BY_EXTENSION[extension];
    if (contentType === undefined) return next();
    // Private version bytes are reachable only through retained catalog refs.
    // Never fall through to Vite for a managed but uncommitted checksum URL.
    try {
      const store = options.createStore ? await options.createStore() : undefined;
      const snapshot = store ? await store.snapshot() : undefined;
      const record = snapshot?.records.find((record) => record.document.versions.some((version) => version.url === pathname));
      const version = record?.document.versions.find((version) => version.url === pathname);
      if (!record || !version) { res.statusCode = 404; res.setHeader("cache-control", "no-store"); res.end(); return; }
      await store.resolveVersion({ providerId: store.provider.id, assetId: record.id, versionId: version.id });
    } catch { sendMediaFileError(res); return; }
    // Resolve the trusted parent (e.g. macOS /var -> /private/var),
    // then reject links at the owned Media root and within its subtree.
    let mediaRoot;
    try { mediaRoot = resolve(await realpathFile(dirname(configuredRoot)), basename(configuredRoot)); }
    catch (cause) {
      if (isMissingMediaFileError(cause)) return next();
      sendMediaFileError(res); return;
    }
    const filePath = resolve(mediaRoot, MEDIA_FILE_PROVIDER_BYTES_DIRECTORY, fileName);

    // O_NOFOLLOW only protects the final component; reject symlinked parents too.
    const parents = [];
    try {
      for (const path of [mediaRoot, resolve(mediaRoot, MEDIA_FILE_PROVIDER_BYTES_DIRECTORY)]) {
        const directory = await lstatFile(path);
        if (directory.isSymbolicLink() || !directory.isDirectory() || await realpathFile(path) !== path) return next();
        parents.push({ path, stats: directory });
      }
    } catch (cause) {
      if (isMissingMediaFileError(cause)) return next();
      sendMediaFileError(res); return;
    }

    let before;
    try {
      before = await lstatFile(filePath);
    } catch (cause) {
      if (isMissingMediaFileError(cause) || mediaErrorCode(cause) === "ELOOP") return next();
      sendMediaFileError(res);
      return;
    }
    if (before.isSymbolicLink() || !before.isFile()) return next();

    let handle;
    let opened;
    try {
      handle = await openFile(filePath, constants.O_RDONLY | NO_FOLLOW);
      opened = await handle.stat();
      for (const parent of parents) {
        const current = await lstatFile(parent.path);
        if (current.isSymbolicLink() || !current.isDirectory() || !sameMediaFile(current, parent.stats) || await realpathFile(parent.path) !== parent.path) {
          await closeMediaFile(handle); return next();
        }
      }
    } catch (cause) {
      await closeMediaFile(handle);
      if (isMissingMediaFileError(cause) || mediaErrorCode(cause) === "ELOOP") return next();
      sendMediaFileError(res);
      return;
    }
    if (opened.isSymbolicLink() || !opened.isFile() || !sameMediaFile(before, opened)) {
      await closeMediaFile(handle);
      return next();
    }

    if (req.method === "HEAD") {
      await closeMediaFile(handle);
      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.setHeader("content-length", String(opened.size));
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      res.setHeader("x-content-type-options", "nosniff");
      res.end();
      return;
    }

    let stream;
    try {
      stream = handle.createReadStream({ autoClose: true });
    } catch {
      await closeMediaFile(handle);
      sendMediaFileError(res);
      return;
    }

    let streamErrorHandled = false;
    const onStreamError = (cause) => {
      if (streamErrorHandled) return;
      streamErrorHandled = true;
      if (res.headersSent === true) {
        res.destroy(cause);
        return;
      }
      if (typeof stream.destroy === "function") stream.destroy();
      sendMediaFileError(res);
    };
    stream.once("error", onStreamError);
    if (typeof res.once === "function") {
      const onResponseClose = () => {
        if (typeof stream.destroy === "function" && !stream.destroyed) stream.destroy();
      };
      res.once("close", onResponseClose);
      stream.once("close", () => res.off?.("close", onResponseClose));
    }

    try {
      res.statusCode = 200;
      res.setHeader("content-type", contentType);
      res.setHeader("content-length", String(opened.size));
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      res.setHeader("x-content-type-options", "nosniff");
      stream.pipe(res);
    } catch (cause) {
      onStreamError(cause);
    }
  };
}

/**
 * Raw-body media transport. The request async iterator is passed directly to
 * the filesystem sink, preserving backpressure and avoiding a second buffer.
 *
 * @param {{capability: string, maxBodyBytes?: number, createStore: () => Promise<any>}} options
 */
export function createMediaUploadMiddleware(options) {
  const maxBodyBytes = options.maxBodyBytes ?? MEDIA_UPLOAD_MAX_BYTES;
  return async function mediaUploadMiddleware(req, res) {
    const acceptedMediaTypes = ["upload", "replace"].includes(req.headers[MEDIA_FILE_PROVIDER_OPERATION_HEADER])
      ? MEDIA_TYPES
      : new Set(["application/json"]);
    const headError = validateRequestHead(
      req,
      MEDIA_FILE_PROVIDER_ENDPOINT,
      options.capability,
      acceptedMediaTypes,
      "Content-Type must be an allowed image or PDF type for uploads and application/json otherwise.",
    );
    if (headError !== undefined) {
      if (!isDeadResponse(req, res)) sendConnectResponse(res, headError);
      return;
    }
    const operation = req.headers[MEDIA_FILE_PROVIDER_OPERATION_HEADER];
    if (!["initialize", "list", "get", "upload", "replace", "delete", "clear", "snapshot", "metadata", "trash", "restore", "create-folder", "update-folder", "trash-folder", "restore-folder", "resolve-version", "pin-manifest"].includes(operation)) {
      sendConnectResponse(res, errorResponse(400, "invalid-request", "A valid media operation header is required."));
      return;
    }
    const contentLengthText = req.headers["content-length"];
    const contentLength = contentLengthText === undefined ? undefined : Number(contentLengthText);
    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      sendConnectResponse(res, errorResponse(413, "body-too-large", `Upload exceeds the ${maxBodyBytes}-byte limit. Choose a smaller file.`, operation));
      return;
    }
    const controller = new globalThis.AbortController();
    const onAborted = () => controller.abort(new Error("request-aborted"));
    req.once("aborted", onAborted);
    try {
      const binary = operation === "upload" || operation === "replace";
      let data = {};
      if (binary) {
        const header = req.headers[MEDIA_FILE_PROVIDER_METADATA_HEADER];
        if (header !== undefined) {
          if (typeof header !== "string" || header.length > 8192) throw Object.assign(new Error("Invalid Media metadata header"), { code: "validation" });
          try { data = JSON.parse(decodeURIComponent(header)); } catch { throw Object.assign(new Error("Invalid Media metadata header"), { code: "validation" }); }
        }
      } else {
        const body = await readBody(req, COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES);
        try { data = body === "" ? {} : JSON.parse(body); } catch { throw Object.assign(new Error("Invalid Media JSON"), { code: "validation" }); }
      }
      if (!isPlainObject(data)) throw Object.assign(new Error("Invalid Media request"), { code: "validation" });
      const fields = {
        initialize: [], get: [], clear: [], snapshot: [],
        list: ["state", "folderId"], upload: ["folderId", "note", "expectedMutationToken"],
        replace: ["precondition"], delete: ["precondition"], trash: ["precondition"], restore: ["precondition"],
        metadata: ["patch", "precondition"], "create-folder": ["input", "expectedMutationToken"],
        "update-folder": ["patch", "precondition"], "trash-folder": ["precondition"], "restore-folder": ["precondition"],
        "resolve-version": ["ref"], "pin-manifest": ["refs"],
      };
      if (Object.keys(data).some((key) => !fields[operation].includes(key))) throw Object.assign(new Error("Unsupported Media request field"), { code: "validation" });
      const store = await options.createStore();
      const id = req.headers[MEDIA_FILE_PROVIDER_RECORD_ID_HEADER] ?? "";
      let result;
      switch (operation) {
        case "initialize": result = await store.initialize(); break;
        case "list": result = await store.list(data); break;
        case "snapshot": result = await store.snapshot(); break;
        case "get": result = await store.get(req.headers[MEDIA_FILE_PROVIDER_RECORD_ID_HEADER] ?? ""); break;
        case "delete": result = await store.delete(id, data.precondition); break;
        case "metadata": result = await store.updateMetadata(id, data.patch, data.precondition); break;
        case "trash": result = await store.trash(id, data.precondition); break;
        case "restore": result = await store.restore(id, data.precondition); break;
        case "create-folder": result = await store.createFolder(data.input, data.expectedMutationToken); break;
        case "update-folder": result = await store.updateFolder(id, data.patch, data.precondition); break;
        case "trash-folder": result = await store.trashFolder(id, data.precondition); break;
        case "restore-folder": result = await store.restoreFolder(id, data.precondition); break;
        case "resolve-version": result = await store.resolveVersion(data.ref); break;
        case "pin-manifest": result = await store.pinManifest(data.refs); break;
        case "replace": result = await store.replace(id, { bytes: req.iterator({ destroyOnReturn: false }), signal: controller.signal }, data.precondition); break;
        case "clear": await store.clear(); result = null; break;
        case "upload": {
          const fileName = decodeMediaFileName(req.headers[MEDIA_FILE_PROVIDER_FILE_NAME_HEADER]);
          if (fileName === undefined) {
            if (!isDeadResponse(req, res)) sendConnectResponse(res, errorResponse(400, "invalid-request", "A valid encoded media filename header is required.", operation));
            return;
          }
          result = await store.upload({
            fileName,
            declaredMediaType: req.headers["content-type"] ?? "",
            bytes: req.iterator({ destroyOnReturn: false }),
            signal: controller.signal,
            folderId: data.folderId,
            note: data.note,
            expectedMutationToken: data.expectedMutationToken,
          });
          break;
        }
      }
      if (!isDeadResponse(req, res)) sendConnectResponse(res, json(200, { ok: true, result }));
    } catch (cause) {
      if (!isDeadResponse(req, res) && !controller.signal.aborted) {
        const response = cause?.code === "BYTE_CAP_EXCEEDED" || cause?.code === "BODY_TOO_LARGE"
          ? errorResponse(413, "body-too-large", `Upload exceeds the ${maxBodyBytes}-byte limit. Choose a smaller file.`, operation)
          : mediaOperationError(cause, operation);
        sendConnectResponse(res, response);
      }
    } finally {
      req.off("aborted", onAborted);
    }
  };
}

/** @param {DevRequest} req @param {string} expected */
function hasCapability(req, expected) {
  const supplied = req.headers[COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER];
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

class OutputRequiredError extends Error {
  /** @param {unknown} request */
  constructor(request) {
    super("A browser-generated derived-output batch is required before this operation can complete.");
    this.name = "OutputRequiredError";
    this.request = request;
  }
}

/** @param {unknown} value @returns {OutputRequiredError | undefined} */
function findOutputRequiredError(value) {
  let current = value;
  const seen = new Set();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (current instanceof OutputRequiredError) return current;
    seen.add(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown> & {name: "CompositionPersistenceError", operation: string, code: string}}
 */
function isPersistenceError(value) {
  return isPlainObject(value)
    && value.name === "CompositionPersistenceError"
    && typeof value.operation === "string"
    && typeof value.code === "string";
}

/** @param {unknown} value @param {string} fallbackOperation */
function sanitizedPersistenceError(value, fallbackOperation) {
  const operation = isPersistenceError(value) ? value.operation : fallbackOperation;
  const code = isPersistenceError(value) ? value.code : "unknown";
  switch (code) {
    case "validation":
    case "unsupported-version":
      return errorResponse(
        422,
        code,
        "Stored composition data is invalid or unsupported. Inspect its canonical JSON and retry.",
        operation,
      );
    case "blocked":
    case "conflict":
      return errorResponse(
        409,
        code,
        "A filesystem safety check blocked the operation. Inspect the compositions directory and retry.",
        operation,
      );
    case "unavailable":
    case "read-failed":
      return errorResponse(
        503,
        code,
        "Local composition files could not be read. Check directory permissions and retry.",
        operation,
      );
    case "write-failed":
    case "transaction-failed":
      return errorResponse(
        500,
        code,
        "Local composition files could not be updated. Check permissions and free space, then retry.",
        operation,
      );
    default:
      return errorResponse(
        500,
        "unknown",
        "The local file provider failed unexpectedly. Retry or restart the development server.",
        operation,
      );
  }
}

/** @param {unknown} payload @returns {any} */
function validateEnvelope(payload) {
  if (!isPlainObject(payload) || typeof payload.operation !== "string") {
    return { error: "Request body must be a JSON object with an operation." };
  }
  switch (payload.operation) {
    case "snapshot":
      if (hasExactKeys(payload, ["operation"])) return { operation: "snapshot" };
      break;
    case "list": {
      if (!hasExactKeys(payload, ["operation", "outputsById"])) break;
      const outputsById = parseOutputsById(payload.outputsById);
      if (outputsById !== undefined) return { operation: "list", outputsById };
      break;
    }
    case "get": {
      if (!hasExactKeys(payload, ["operation", "id", "outputsById"])) break;
      const outputsById = parseOutputsById(payload.outputsById);
      if (isSafeId(payload.id) && outputsById !== undefined) {
        return { operation: "get", id: payload.id, outputsById };
      }
      break;
    }
    case "put":
    case "save-lifecycle-record":
      if (
        hasExactKeys(payload, ["operation", "record", "outputsById"])
        && isPlainObject(payload.record)
        && hasExactKeys(payload.record, ["id", "createdAt", "updatedAt", "document"])
      ) {
        const outputsById = parseOutputsById(payload.outputsById);
        if (outputsById !== undefined) return { operation: payload.operation, record: payload.record, outputsById };
      }
      break;
    case "delete":
    case "delete-with-dependency-check":
      if (hasExactKeys(payload, ["operation", "id"]) && isSafeId(payload.id)) {
        return { operation: payload.operation, id: payload.id };
      }
      break;
    case "unpublish-with-dependency-check": {
      if (!hasExactKeys(payload, ["operation", "id", "outputsById"]) || !isSafeId(payload.id)) break;
      const outputsById = parseOutputsById(payload.outputsById);
      if (outputsById !== undefined) return { operation: payload.operation, id: payload.id, outputsById };
      break;
    }
    case "clear":
      if (hasExactKeys(payload, ["operation"])) return { operation: "clear" };
      break;
    default:
      return { error: "Unknown file-provider operation." };
  }
  return {
    error: "Request fields are invalid. Filenames, paths, and unknown fields are not accepted.",
  };
}

/**
 * Testable middleware factory. The supplied store factory receives the only
 * derived-output provider the Node core ever sees; it either returns a
 * browser-produced batch item from this request or interrupts with the
 * already-loaded closure the browser must plan.
 *
 * @param {{
 *   endpoint?: string,
 *   capability: string,
 *   maxBodyBytes?: number,
 *   validateRecord: (value: unknown) => {ok: true, record: CompositionRecord} | {ok: false, issue: {message: string}},
 *   createStore: (options: {provideJsx: (record: CompositionRecord, request: unknown) => string | {status: "generated", code: string} | {status: "blocked", reason: string}}) => Promise<{
 *     list(): Promise<unknown>, get(id: string): Promise<unknown>, snapshot(): Promise<unknown>,
 *     put(record: CompositionRecord, jsx?: string): Promise<unknown>,
 *     delete(id: string): Promise<boolean>, clear(): Promise<void>,
 *     deleteWithDependencyCheck(id: string): Promise<unknown>,
 *     unpublishWithDependencyCheck(id: string): Promise<unknown>,
 *     saveLifecycleRecord(record: CompositionRecord): Promise<void>
 *   }>
 * }} options
 * @returns {(req: DevRequest) => Promise<DevResponse>}
 */
export function createComposerFileProviderMiddleware(options) {
  const endpoint = options.endpoint ?? COMPOSER_FILE_PROVIDER_ENDPOINT;
  const maxBodyBytes = options.maxBodyBytes ?? COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES;

  /** @param {DevRequest} req */
  return async function composerFileProviderMiddleware(req) {
    // Enforce the complete URL (including the absence of query/hash suffixes)
    // even when the handler is embedded outside the Vite/Connect adapter.
    const headError = validateRequestHead(req, endpoint, options.capability);
    if (headError !== undefined) return headError;
    if (bodyBytes(req.body) > maxBodyBytes) {
      return errorResponse(413, "body-too-large", `Request body exceeds the ${maxBodyBytes}-byte limit.`);
    }

    let raw;
    try {
      raw = JSON.parse(req.body ?? "");
    } catch {
      return errorResponse(400, "malformed-json", "Request body is not valid JSON.");
    }
    const envelope = validateEnvelope(raw);
    if ("error" in envelope) {
      return errorResponse(400, "invalid-request", envelope.error);
    }

    const outputsById = "outputsById" in envelope ? envelope.outputsById : Object.create(null);
    try {
      const store = await options.createStore({
        provideJsx(record, request) {
          const output = outputsById[record.id];
          if (output === undefined) throw new OutputRequiredError(request);
          return output;
        },
      });

      switch (envelope.operation) {
        case "snapshot":
          return json(200, { ok: true, result: await store.snapshot() });
        case "list":
          return json(200, { ok: true, result: await store.list() });
        case "get":
          return json(200, { ok: true, result: await store.get(envelope.id) });
        case "put": {
          const validation = options.validateRecord(envelope.record);
          if (!validation.ok) {
            return errorResponse(422, "validation", validation.issue.message, "put");
          }
          return json(200, { ok: true, result: await store.put(validation.record) });
        }
        case "save-lifecycle-record": {
          const validation = options.validateRecord(envelope.record);
          if (!validation.ok) return errorResponse(422, "validation", validation.issue.message, "put");
          await store.saveLifecycleRecord(validation.record);
          return json(200, { ok: true, result: null });
        }
        case "delete":
          return json(200, { ok: true, result: await store.delete(envelope.id) });
        case "delete-with-dependency-check":
          return json(200, { ok: true, result: await store.deleteWithDependencyCheck(envelope.id) });
        case "unpublish-with-dependency-check":
          return json(200, { ok: true, result: await store.unpublishWithDependencyCheck(envelope.id) });
        case "clear":
          await store.clear();
          return json(200, { ok: true, result: null });
      }
      return errorResponse(400, "invalid-request", "Unknown file-provider operation.");
    } catch (cause) {
      // The core wraps provider failures in CompositionPersistenceError so its
      // own API remains operation-specific. Walk the standard Error.cause
      // chain to recover only our private handshake sentinel.
      const outputRequired = findOutputRequiredError(cause);
      if (outputRequired !== undefined) {
        return json(409, {
          ok: false,
          error: {
            code: "output-required",
            operation: envelope.operation,
            message: "A derived-output batch is required to verify generated files.",
          },
          request: outputRequired.request,
        });
      }
      return sanitizedPersistenceError(cause, envelope.operation);
    }
  };
}

const VIRTUAL_CONFIG_ID = "virtual:composer-file-provider-config";
const RESOLVED_VIRTUAL_CONFIG_ID = `\0${VIRTUAL_CONFIG_ID}`;

/** Read a Connect request without ever buffering more than the public limit. */
function readBody(req, maxBodyBytes) {
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

function sendConnectResponse(res, response) {
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.end(response.body);
}

/** Vite plugin. Each dev server closure receives an independent capability.
 * @param {{mediaStoreRoot?: string}} options
 */
export default function composerFileProviderPlugin(options = {}) {
  const explicitMediaRoot = validateMediaStoreRoot(options.mediaStoreRoot);
  let command = "build";
  let capability;
  let projectRoot;
  return {
    name: "composer-file-provider",
    configResolved(config) {
      command = config.command;
      projectRoot = config.root;
      capability = command === "serve" ? randomBytes(32).toString("base64url") : undefined;
    },
    resolveId(id) {
      return id === VIRTUAL_CONFIG_ID ? RESOLVED_VIRTUAL_CONFIG_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_CONFIG_ID) return undefined;
      if (command !== "serve" || capability === undefined) {
        return "export const fileProviderConfig = undefined;\n";
      }
      return `export const fileProviderConfig = ${JSON.stringify({
        endpoint: COMPOSER_FILE_PROVIDER_ENDPOINT,
        mediaEndpoint: MEDIA_FILE_PROVIDER_ENDPOINT,
        capability,
        capabilityHeader: COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER,
        maxBodyBytes: COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES,
        mediaMaxBodyBytes: MEDIA_UPLOAD_MAX_BYTES,
        mediaOperationHeader: MEDIA_FILE_PROVIDER_OPERATION_HEADER,
        mediaFileNameHeader: MEDIA_FILE_PROVIDER_FILE_NAME_HEADER,
        mediaRecordIdHeader: MEDIA_FILE_PROVIDER_RECORD_ID_HEADER,
        mediaMetadataHeader: MEDIA_FILE_PROVIDER_METADATA_HEADER,
      })};\n`;
    },
    async configureServer(server) {
      const activeCapability = capability;
      if (activeCapability === undefined || projectRoot === undefined) return;
      const {
        createFilesystemCompositionStore,
        validateCompositionRecord,
      } = await server.ssrLoadModule("/src/composer/storage/file-provider/dev-server-entry.ts");
      const handler = createComposerFileProviderMiddleware({
        capability: activeCapability,
        validateRecord: validateCompositionRecord,
        createStore: ({ provideJsx }) => createFilesystemCompositionStore({
          compositionsRoot: resolve(projectRoot, COMPOSER_FILE_PROVIDER_ROOT),
          provideJsx,
        }),
      });
      const { createFilesystemMediaStore } = await server.ssrLoadModule("/src/media/storage/file-provider/dev-server-entry.ts");
      const mediaStoreRoot = explicitMediaRoot ?? resolve(projectRoot, MEDIA_FILE_PROVIDER_ROOT);
      const mediaHandler = createMediaUploadMiddleware({
        capability: activeCapability,
        createStore: () => createFilesystemMediaStore({ mediaStoreRoot }),
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== MEDIA_FILE_PROVIDER_ENDPOINT) return next();
        await mediaHandler(req, res);
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== COMPOSER_FILE_PROVIDER_ENDPOINT) return next();
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([name, value]) => [name, Array.isArray(value) ? undefined : value]),
        );
        const requestHead = {
          url: req.url,
          method: req.method,
          headers,
          protocol: req.socket?.encrypted === true ? "https" : "http",
        };
        const headError = validateRequestHead(requestHead, COMPOSER_FILE_PROVIDER_ENDPOINT, activeCapability);
        if (headError !== undefined) {
          sendConnectResponse(res, headError);
          return;
        }
        const contentLength = Number(headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES) {
          sendConnectResponse(res, errorResponse(
            413,
            "body-too-large",
            `Request body exceeds the ${COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES}-byte limit.`,
          ));
          return;
        }
        let body;
        try {
          body = await readBody(req, COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES);
        } catch (error) {
          if (error?.code === "BODY_TOO_LARGE") {
            sendConnectResponse(res, errorResponse(
              413,
              "body-too-large",
              `Request body exceeds the ${COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES}-byte limit.`,
            ));
            return;
          }
          if (!res.destroyed) {
            sendConnectResponse(res, errorResponse(400, "read-failed", "Request body could not be read."));
          }
          return;
        }
        sendConnectResponse(res, await handler({ ...requestHead, body }));
      });
      // Vite's public-dir middleware serves only files in its startup-scanned publicFiles Set (updated by chokidar), so a file uploaded during the session otherwise gets the SPA shell until the watcher catches up (#180).
      server.middlewares.use(createMediaFileMiddleware({ projectRoot, mediaStoreRoot, createStore: () => createFilesystemMediaStore({ mediaStoreRoot }) }));
    },
  };
}
