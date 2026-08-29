// @ts-check
// Dev-only transport for the Composer filesystem store.
//
// The filesystem core deliberately knows nothing about HTTP or JSX generation.
// This plugin keeps that split intact: canonical records cross a capability-
// protected same-origin endpoint and the browser supplies a pure batch plan
// over an already-read dependency closure. The core never holds its filesystem
// queue while awaiting that browser planning round.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";

/** @typedef {import("../src/composer/library/types.ts").CompositionRecord} CompositionRecord */
/** @typedef {{url?: string, method?: string, protocol?: "http" | "https", headers: Record<string, string | undefined>, body?: string}} DevRequest */
/** @typedef {{status: number, headers: Record<string, string>, body: string, bodyEncoding: "utf8"}} DevResponse */

export const COMPOSER_FILE_PROVIDER_ENDPOINT = "/__zudo_composer_file_provider";
export const COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER = "x-zudo-composer-capability";
/** UTF-8 bytes. Large enough for a substantial document plus generated JSX. */
export const COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const COMPOSER_FILE_PROVIDER_ROOT = "compositions";

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

function validateRequestHead(req, endpoint, capability) {
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
  if (mediaType !== "application/json") {
    return errorResponse(415, "unsupported-media-type", "Content-Type must be application/json.");
  }
  return undefined;
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
 *     list(): Promise<unknown>, get(id: string): Promise<unknown>,
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

/** Vite plugin. Each dev server closure receives an independent capability. */
export default function composerFileProviderPlugin() {
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
        capability,
        capabilityHeader: COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER,
        maxBodyBytes: COMPOSER_FILE_PROVIDER_MAX_BODY_BYTES,
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
    },
  };
}
