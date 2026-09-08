/**
 * Wire contract shared by every domain that persists through the dev-only
 * filesystem transport.
 *
 * Composer and Media keep their own endpoints and their own request shapes —
 * they are covered by a separate contract spec and are deliberately not
 * multiplexed into this one. This module defines the shape the remaining
 * domains reuse so each port is mechanical.
 */

/** Same header for every domain: one capability per dev server, not per route. */
export const FILE_PROVIDER_CAPABILITY_HEADER = "x-zudo-composer-capability";
/** The operation travels in a header so the body is purely the payload. */
export const FILE_PROVIDER_OPERATION_HEADER = "x-zudo-composer-operation";
/**
 * Which workspace the request addresses.
 *
 * A workspace scopes the four authoring domains to one directory below each
 * domain root, and the roots are the dev server's to resolve — the browser
 * never sees a path. So the browser names the workspace and the server does the
 * joining.
 */
export const FILE_PROVIDER_WORKSPACE_HEADER = "x-zudo-composer-workspace";
/** UTF-8 bytes. Large enough for a substantial document graph. */
export const FILE_PROVIDER_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * `/__zudo_composer_content_provider`, `/__zudo_composer_mapping_provider`, …
 *
 * `plugins/file-provider-http.mjs` carries the same rule. The two cannot share
 * one definition: plugin modules run in the Vite config graph and must never be
 * pulled into the browser bundle. The endpoint-name test in
 * `plugins/__tests__/domain-file-provider.test.ts` pins the shared spelling.
 */
export function domainFileProviderEndpoint(domain: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(domain)) {
    throw new RangeError(`A file-provider domain must be a short lowercase name: ${JSON.stringify(domain)}`);
  }
  return `/__zudo_composer_${domain.replace(/-/g, "_")}_provider`;
}

/**
 * A domain error crossing the wire.
 *
 * `operation` and `code` are the domain's own union members, carried through
 * unchanged so the browser can rebuild the exact `XPersistenceError` instead of
 * receiving a flattened string. `details` is optional structured context (a
 * conflicting revision, an offending record id) that a domain may attach.
 */
export interface FileProviderWireError {
  domain: string;
  operation: string;
  code: string;
  message: string;
  details?: unknown;
}

export type FileProviderResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: FileProviderWireError };

/**
 * A multi-operation transaction expressed in one request.
 *
 * The server applies every step inside a single
 * {@link import("../node-fs/record-transaction").TransactionalRecordStore}
 * commit, so the whole batch reaches disk or none of it does. There is no
 * partially-applied transaction and no per-step acknowledgement: the response
 * is the single result of the whole batch.
 */
export interface FileProviderTransactionRequest {
  readonly expectedMutationToken?: string;
  readonly steps: readonly FileProviderTransactionStep[];
}

export interface FileProviderTransactionStep {
  readonly operation: string;
  readonly payload?: unknown;
}

/** `transaction` is reserved on every domain endpoint. */
export const FILE_PROVIDER_TRANSACTION_OPERATION = "transaction";

/**
 * Default HTTP status for a domain error code. The workspace registry overrides
 * validation to 400 for its request payloads; other domains use these defaults.
 * A valid error envelope carries the authoritative domain error identity.
 */
export const FILE_PROVIDER_STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
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

export function fileProviderStatus(code: string): number {
  return FILE_PROVIDER_STATUS_BY_CODE[code] ?? 500;
}

export function isFileProviderResponse<T>(value: unknown): value is FileProviderResponse<T> {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === true) return "result" in value;
  if (value.ok !== false || !("error" in value)) return false;
  const error: unknown = value.error;
  return typeof error === "object" && error !== null
    && "code" in error && typeof error.code === "string"
    && "message" in error && typeof error.message === "string";
}

export interface FileProviderConfig {
  endpoint: string;
  capability: string;
  capabilityHeader: string;
  operationHeader: string;
  /** Absent on an endpoint no workspace scopes, such as the registry itself. */
  workspaceHeader?: string;
  maxBodyBytes: number;
}

/**
 * The per-domain half of the transport. A domain supplies its operation names
 * and the two translations between its own error type and the wire error; the
 * shared client and middleware own everything else.
 */
export interface FileProviderErrorAdapter<Operation extends string, DomainError extends Error> {
  readonly domain: string;
  /** Refresh-hint channel name, e.g. "content". */
  readonly persistenceChannel: string;
  isDomainError(value: unknown): value is DomainError;
  toWire(error: DomainError): FileProviderWireError;
  fromWire(error: FileProviderWireError, fallbackOperation: Operation): DomainError;
  /** Rebuilt for a transport failure that never reached the domain at all. */
  transportError(operation: Operation, message: string, cause?: unknown): DomainError;
}
