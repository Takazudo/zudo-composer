import { fileProviderConfig } from "virtual:composer-file-provider-config";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  loadCompositionRecord,
  validateCompositionRecord,
  type CompositionLoadOutcome,
  type CompositionPutResult,
  type CompositionPersistenceErrorCode,
  type CompositionPersistenceOperation,
  type CompositionRecord,
  type CompositionSaveOutcome,
  type CompositionStore,
  type CompositionSummary,
} from "../../library";
import type { ComponentCatalog } from "../../model/types";
import { planLinkedJsxModules } from "../../source/plan-linked-jsx";
import type {
  ComposerFileProviderDerivedOutputPlan,
  ComposerFileProviderDerivedOutputRequest,
  ComposerFileProviderConfig,
  ComposerFileProviderErrorPayload,
} from "./types";

const MAX_OUTPUT_PLAN_ROUNDS = 8;

type Operation = CompositionPersistenceOperation;

type SuccessResponse<T> = { ok: true; result: T };
type ErrorResponse = {
  ok: false;
  error: ComposerFileProviderErrorPayload;
  request?: unknown;
};

function isProtocolResponse<T>(value: unknown): value is SuccessResponse<T> | ErrorResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === true) return "result" in value;
  if (value.ok !== false || !("error" in value)) return false;
  const error = value.error;
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && "message" in error
    && typeof error.message === "string"
    && (!("operation" in error) || typeof error.operation === "string");
}

function persistenceError(
  operation: Operation,
  code: CompositionPersistenceErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): CompositionPersistenceError {
  return new CompositionPersistenceError(
    operation,
    code,
    message,
    retryable,
    cause === undefined ? undefined : { cause },
  );
}

function normalizeErrorCode(value: string): CompositionPersistenceErrorCode {
  switch (value) {
    case "unavailable":
    case "blocked":
    case "unsupported-version":
    case "validation":
    case "read-failed":
    case "write-failed":
    case "transaction-failed":
    case "conflict":
      return value;
    default:
      return "unknown";
  }
}

function isRetryable(code: CompositionPersistenceErrorCode): boolean {
  return code === "unavailable"
    || code === "read-failed"
    || code === "write-failed"
    || code === "transaction-failed"
    || code === "unknown";
}

function diagnosticsMessage(record: CompositionRecord, count: number): string {
  return `Could not generate production JSX for composition "${record.id}" (${count} diagnostic${count === 1 ? "" : "s"}). Resolve unsupported or invalid nodes before saving.`;
}

function isOutputRequest(value: unknown): value is ComposerFileProviderDerivedOutputRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (!Array.isArray(request.records) || !Array.isArray(request.sourceOutcomes) || !Array.isArray(request.targetIds)) {
    return false;
  }
  if (!request.records.every((record) => validateCompositionRecord(record).ok)) return false;
  return request.sourceOutcomes.every((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || Array.isArray(entry)
      || typeof (entry as { id?: unknown }).id !== "string"
      || !("outcome" in entry)
    ) {
      return false;
    }
    const outcome = (entry as { outcome: unknown }).outcome;
    if (typeof outcome !== "object" || outcome === null || !("status" in outcome)) return false;
    if ((outcome as { status: unknown }).status === "loaded") {
      return "record" in outcome && validateCompositionRecord((outcome as { record: unknown }).record).ok;
    }
    return ["not-found", "invalid", "future-schema"].includes((outcome as { status: string }).status);
  }) && request.targetIds.every((id) => typeof id === "string");
}

/**
 * Browser half of the dev-only file provider. Construct this through
 * `createFileProviderCompositionStore()` so production builds, whose virtual
 * config is `undefined`, cannot surface a usable file provider.
 */
class BrowserFileProviderCompositionStore implements CompositionStore {
  readonly provider = COMPOSITION_PROVIDERS.files;

  constructor(
    private readonly config: ComposerFileProviderConfig,
    private readonly manifest: ComponentCatalog,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async list(): Promise<readonly CompositionSummary[]> {
    return this.requestWithOutputPlan<readonly CompositionSummary[]>("list");
  }

  async get(id: string): Promise<CompositionLoadOutcome> {
    return this.requestWithOutputPlan<CompositionLoadOutcome>("get", { id }, (result) =>
      this.decodeGetResult(result, id),
    );
  }

  async put(record: CompositionRecord): Promise<CompositionPutResult> {
    const validation = validateCompositionRecord(record);
    if (!validation.ok) {
      throw persistenceError("put", "validation", validation.issue.message, false);
    }
    return this.requestWithOutputPlan<CompositionSaveOutcome>("put", { record: validation.record });
  }

  async delete(id: string): Promise<boolean> {
    return this.request<boolean>("delete", { id });
  }

  async clear(): Promise<void> {
    await this.request<null>("clear");
  }

  private async requestWithOutputPlan<T>(
    operation: "list" | "get" | "put",
    fields: Record<string, unknown> = {},
    decodeResult: (result: T) => T = (result) => result,
  ): Promise<T> {
    const outputsById: Record<string, ComposerFileProviderDerivedOutputPlan> = Object.create(null);
    for (let round = 0; round < MAX_OUTPUT_PLAN_ROUNDS; round += 1) {
      const response = await this.fetchJson<T>(operation, { ...fields, outputsById });
      if (response.ok) return decodeResult(response.result);
      if (response.error.code !== "output-required") {
        throw this.fromServerError(operation, response.error);
      }
      if (!isOutputRequest(response.request)) {
        throw persistenceError(
          operation,
          "validation",
          "The file provider returned an invalid dependency closure for output planning.",
          false,
        );
      }
      const sourceOutcomes = new Map(response.request.sourceOutcomes.map((entry) => [entry.id, entry.outcome]));
      const batch = planLinkedJsxModules({
        manifest: this.manifest,
        records: response.request.records,
        sourceOutcomes,
        moduleSpecifier: (recordId) => `./composition-${recordId}`,
      });
      for (const id of response.request.targetIds) {
        const plan = batch.byRecordId.get(id);
        const record = response.request.records.find((candidate) => candidate.id === id);
        if (plan === undefined || record === undefined) {
          throw persistenceError(
            operation,
            "conflict",
            `The file provider requested output for unavailable composition "${id}".`,
            true,
          );
        }
        outputsById[id] = plan.status === "generated"
          ? { status: "generated", code: plan.code }
          : {
            status: "blocked",
            reason: plan.diagnostic.kind === "dependency"
              ? plan.diagnostic.message
              : diagnosticsMessage(record, plan.diagnostic.generation.diagnostics.opaqueIds.length),
          };
      }
    }
    throw persistenceError(
      operation,
      "conflict",
      "File-provider output planning did not converge. Retry the save or reload the Composition.",
      true,
    );
  }

  /**
   * The development endpoint is a persistence boundary too. Decode a loaded
   * record again rather than trusting the transport's claimed schema.
   */
  private decodeGetResult(result: CompositionLoadOutcome, requestedId: string): CompositionLoadOutcome {
    if (result.status !== "loaded") return result;
    const decoded = loadCompositionRecord(result.record);
    if (decoded.status !== "loaded") return decoded;
    if (decoded.record.id !== requestedId) {
      throw persistenceError(
        "get",
        "conflict",
        "The file provider returned a composition whose id does not match the requested id.",
        true,
      );
    }
    return {
      ...decoded,
      ...(result.derivedOutput === undefined ? {} : { derivedOutput: result.derivedOutput }),
    };
  }

  private async request<T>(operation: Operation, fields: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchJson<T>(operation, fields);
    if (response.ok) return response.result;
    throw this.fromServerError(operation, response.error);
  }

  private async fetchJson<T>(
    operation: Operation,
    fields: Record<string, unknown>,
  ): Promise<SuccessResponse<T> | ErrorResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [this.config.capabilityHeader]: this.config.capability,
        },
        body: JSON.stringify({ operation, ...fields }),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (cause) {
      throw persistenceError(
        operation,
        "unavailable",
        "The development file provider is unavailable. Confirm `pnpm dev` is running and retry.",
        true,
        cause,
      );
    }

    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw persistenceError(
        operation,
        "unknown",
        "The development file provider returned a non-JSON response.",
        true,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw persistenceError(
        operation,
        "unknown",
        "The development file provider returned malformed JSON.",
        true,
        cause,
      );
    }
    if (!isProtocolResponse<T>(payload)) {
      throw persistenceError(
        operation,
        "unknown",
        "The development file provider returned an invalid response.",
        true,
      );
    }
    return payload;
  }

  private fromServerError(
    operation: Operation,
    error: ComposerFileProviderErrorPayload,
  ): CompositionPersistenceError {
    const code = normalizeErrorCode(error.code);
    return persistenceError(operation, code, error.message, isRetryable(code));
  }
}

export interface CreateFileProviderCompositionStoreOptions {
  /** Provider-owned component definitions used by the pure output planner. */
  catalog: ComponentCatalog;
  /** Test seam; production callers use globalThis.fetch. */
  fetch?: typeof fetch;
}

/**
 * Returns the file store only when the dev virtual capability exists.
 * Production builds resolve the virtual module to `undefined`, leaving
 * IndexedDB as the only available provider.
 */
export function createFileProviderCompositionStore(
  options: CreateFileProviderCompositionStoreOptions,
): CompositionStore | undefined {
  if (fileProviderConfig === undefined) return undefined;
  return new BrowserFileProviderCompositionStore(
    fileProviderConfig,
    options.catalog,
    options.fetch ?? globalThis.fetch.bind(globalThis),
  );
}
