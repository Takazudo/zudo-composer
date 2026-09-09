// @ts-check
// Dev-only transport for domain filesystem stores.
//
// Composer and Assets keep their own endpoints; this factory serves the domains
// that have no filesystem transport yet, one endpoint per domain, so a port is
// a handler table plus an error adapter rather than a new server.
//
// The Node core never learns about HTTP: the handler resolves an operation to a
// store method, and every failure crosses the wire as a structured domain error
// (`domain`, `operation`, `code`, `message`, optional `details`) so the browser
// rebuilds its own error class instead of parsing a string.

import {
  FILE_PROVIDER_MAX_BODY_BYTES,
  FILE_PROVIDER_OPERATION_HEADER,
  FILE_PROVIDER_WORKSPACE_HEADER,
  bodyBytes,
  domainFileProviderEndpoint,
  errorResponse,
  isSafeWorkspaceHeader,
  json,
  validateRequestHead,
} from "./file-provider-http.mjs";

export { domainFileProviderEndpoint };

/** Reserved on every domain endpoint: a whole multi-operation transaction. */
export const TRANSACTION_OPERATION = "transaction";

const STATUS_BY_CODE = Object.freeze({
  validation: 422,
  "unsupported-version": 422,
  blocked: 409,
  conflict: 409,
  "recovery-required": 409,
  "commit-uncertain": 409,
  "not-found": 404,
  "body-too-large": 413,
  unavailable: 503,
  "read-failed": 503,
  "write-failed": 500,
  "transaction-failed": 500,
  unknown: 500,
});

/**
 * Serialize a thrown value as a wire error.
 *
 * Only the domain's own operation, code and optional structured details are
 * forwarded. Anything else becomes `unknown`, so a stray Node error can never
 * masquerade as a domain outcome the browser would act on.
 *
 * @param {string} domain
 * @param {unknown} cause
 * @param {string} fallbackOperation
 * @param {(value: unknown) => boolean} isDomainError
 */
export function serializeDomainError(domain, cause, fallbackOperation, isDomainError) {
  const recognized = isDomainError(cause);
  const operation = recognized && typeof (/** @type {any} */ (cause).operation) === "string"
    ? /** @type {any} */ (cause).operation
    : fallbackOperation;
  const code = recognized && typeof (/** @type {any} */ (cause).code) === "string"
    ? /** @type {any} */ (cause).code
    : "unknown";
  const message = recognized
    ? String(/** @type {any} */ (cause).message)
    : `The local ${domain} provider failed unexpectedly. Retry or restart the development server.`;
  const details = recognized ? /** @type {any} */ (cause).details : undefined;
  return {
    // Registry payload validation uses 400, like invalid workspace headers.
    status: domain === "workspace" && code === "validation" ? 400 : (STATUS_BY_CODE[code] ?? 500),
    error: { domain, operation, code, message, ...(details === undefined ? {} : { details }) },
  };
}

/**
 * Build the request handler for one domain endpoint.
 *
 * `operations` maps a wire operation name to `(store, payload) => result`. A
 * transaction request names steps from that same table; the store decides how
 * to run them as one commit through `applyTransaction`, so this layer never
 * invents partial-application semantics of its own.
 *
 * @param {{
 *   domain: string,
 *   capability: string,
 *   endpoint?: string,
 *   maxBodyBytes?: number,
 *   isDomainError: (value: unknown) => boolean,
 *   operations: Record<string, (store: any, payload: unknown) => Promise<unknown> | unknown>,
 *   applyTransaction?: (store: any, request: {expectedMutationToken?: string, steps: readonly {operation: string, payload?: unknown}[]}) => Promise<unknown>,
 *   workspaceScoped?: boolean,
 *   createStore: (workspaceId: string | undefined) => Promise<any>,
 * }} options
 */
export function createDomainFileProviderMiddleware(options) {
  const endpoint = options.endpoint ?? domainFileProviderEndpoint(options.domain);
  const maxBodyBytes = options.maxBodyBytes ?? FILE_PROVIDER_MAX_BODY_BYTES;

  return async function domainFileProviderMiddleware(req) {
    const headError = validateRequestHead(req, endpoint, options.capability);
    if (headError !== undefined) return headError;
    if (bodyBytes(req.body) > maxBodyBytes) {
      return errorResponse(413, "body-too-large", `Request body exceeds the ${maxBodyBytes}-byte limit.`);
    }

    // A scoped domain refuses to answer without a workspace rather than
    // falling back to the unscoped domain root: an unscoped write would land
    // in the shared tree every workspace's directory sits beside.
    const workspaceId = req.headers[FILE_PROVIDER_WORKSPACE_HEADER];
    if (options.workspaceScoped !== false && !isSafeWorkspaceHeader(workspaceId)) {
      return errorResponse(400, "invalid-request", `A valid ${options.domain} workspace header is required.`);
    }

    const operation = req.headers[FILE_PROVIDER_OPERATION_HEADER];
    if (typeof operation !== "string"
      || (operation !== TRANSACTION_OPERATION && !Object.hasOwn(options.operations, operation))) {
      return errorResponse(400, "invalid-request", `A valid ${options.domain} operation header is required.`);
    }

    let payload;
    try {
      payload = req.body === undefined || req.body === "" ? undefined : JSON.parse(req.body);
    } catch {
      return errorResponse(400, "malformed-json", "Request body is not valid JSON.");
    }

    if (operation === TRANSACTION_OPERATION) {
      const invalid = validateTransactionRequest(payload, options.operations);
      if (invalid !== undefined) return errorResponse(400, "invalid-request", invalid);
      if (options.applyTransaction === undefined) {
        return errorResponse(400, "invalid-request", `The ${options.domain} provider does not accept transactions.`);
      }
    }

    try {
      const store = await options.createStore(workspaceId);
      const result = operation === TRANSACTION_OPERATION
        ? await options.applyTransaction(store, payload)
        : await options.operations[operation](store, payload);
      return json(200, { ok: true, result: result === undefined ? null : result });
    } catch (cause) {
      const { status, error } = serializeDomainError(options.domain, cause, operation, options.isDomainError);
      return json(status, { ok: false, error });
    }
  };
}

function validateTransactionRequest(payload, operations) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "A transaction request must be a JSON object.";
  }
  const extra = Object.keys(payload).filter((key) => !["expectedMutationToken", "steps"].includes(key));
  if (extra.length > 0) return "A transaction request accepts only expectedMutationToken and steps.";
  if (payload.expectedMutationToken !== undefined && typeof payload.expectedMutationToken !== "string") {
    return "expectedMutationToken must be a string when present.";
  }
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    return "A transaction request requires at least one step.";
  }
  for (const step of payload.steps) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) return "Each transaction step must be an object.";
    if (Object.keys(step).some((key) => !["operation", "payload"].includes(key))) {
      return "A transaction step accepts only operation and payload.";
    }
    if (typeof step.operation !== "string" || step.operation === TRANSACTION_OPERATION
      || !Object.hasOwn(operations, step.operation)) {
      return "Each transaction step must name a supported non-transaction operation.";
    }
  }
  return undefined;
}
