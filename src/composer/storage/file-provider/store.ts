import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { notifyPersistenceChange } from "../../../shared/persistence-generation";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  loadCompositionRecord,
  validateCompositionRecord,
  type CompositionLoadOutcome,
  type CompositionDeleteOutcome,
  type CompositionLifecycleStore,
  type CompositionPutResult,
  type CompositionPersistenceErrorCode,
  type CompositionPersistenceOperation,
  type CompositionRecord,
  type CompositionSaveOutcome,
  type CompositionSummary,
  type CompositionUnpublishOutcome,
} from "../../library";
import type { ComponentCatalog } from "../../model/types";
import { planLinkedJsxModules } from "../../source/plan-linked-jsx";
import { COMPOSITION_FILE_PROVIDER_CHANNEL } from "./types";
import type {
  ComposerFileProviderDerivedOutputPlan,
  ComposerFileProviderDerivedOutputRequest,
  ComposerFileProviderConfig,
  ComposerFileProviderErrorPayload,
} from "./types";

const MAX_OUTPUT_PLAN_ROUNDS = 8;

type Operation = CompositionPersistenceOperation;
type WireOperation = Operation
  | "snapshot"
  | "delete-with-dependency-check"
  | "unpublish-with-dependency-check"
  | "save-lifecycle-record";

function persistenceOperation(operation: WireOperation): Operation {
  if (operation === "snapshot") return "list";
  if (operation === "delete-with-dependency-check") return "delete";
  if (operation === "unpublish-with-dependency-check" || operation === "save-lifecycle-record") return "put";
  return operation;
}

type SuccessResponse<T> = { ok: true; result: T };
type ErrorResponse = {
  ok: false;
  error: ComposerFileProviderErrorPayload;
};

type OutputRequiredResponse = {
  ok: "needs-output";
  request: ComposerFileProviderDerivedOutputRequest;
};
type ProtocolResponse<T> = SuccessResponse<T> | ErrorResponse | OutputRequiredResponse;

function isProtocolResponse<T>(value: unknown): value is ProtocolResponse<T> {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === "needs-output") return "request" in value && isOutputRequest(value.request);
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
class BrowserFileProviderCompositionStore implements CompositionLifecycleStore {
  readonly provider = COMPOSITION_PROVIDERS.files;

  constructor(
    private readonly config: ComposerFileProviderConfig,
    private readonly manifest: ComponentCatalog,
    private readonly fetchImpl: typeof fetch,
    private readonly workspace: () => string,
  ) {}

  /**
   * The whole canonical record set. `snapshot` already reads it coherently —
   * twice, until two reads agree — so there is nothing else to do here.
   */
  async readAll(): Promise<readonly CompositionRecord[]> {
    return (await this.snapshot()).records;
  }

  /**
   * Replace the provider's contents with a seed set.
   *
   * Unlike the record-store domains this is not one atomic commit: every
   * composition carries a generated JSX sibling, and generation is a browser
   * round the Node core interrupts a write to ask for. So the seed is a
   * sequence of deletes and puts, and a failure part-way leaves a partly
   * populated directory. That is safe only because seeding runs against a
   * workspace still in `seeding` status: a failure removes the whole workspace
   * directory rather than leaving these files reachable.
   *
   * Order is not incidental. The provider refuses to remove a global template
   * that still has a consumer, so dependents are deleted first; and a
   * composition that fills a template outlet plans a blocked output if its
   * template is not canonical yet, so templates are written first.
   */
  async seed(records: readonly CompositionRecord[]): Promise<void> {
    const isTemplate = (record: CompositionRecord) => record.document.publication?.kind === "global-template";
    const dependentsFirst = [...await this.readAll()].sort((a, b) => Number(isTemplate(a)) - Number(isTemplate(b)));
    for (const record of dependentsFirst) await this.delete(record.id);
    const templatesFirst = [...records].sort((a, b) => Number(isTemplate(b)) - Number(isTemplate(a)));
    for (const record of templatesFirst) await this.put(record);
  }

  async list(): Promise<readonly CompositionSummary[]> {
    return this.requestWithOutputPlan<readonly CompositionSummary[]>("list");
  }

  async snapshot(): Promise<{ mutationToken: string; records: readonly CompositionRecord[] }> {
    const value = await this.request<{ mutationToken: string; records: readonly CompositionRecord[] }>("snapshot");
    if (!value || !/^[a-f0-9]{64}$/.test(value.mutationToken) || !Array.isArray(value.records) || value.records.some((record) => !validateCompositionRecord(record).ok)) throw persistenceError("list", "validation", "Invalid Composition snapshot response.", false);
    return value;
  }
  async mutationToken(): Promise<string> { return (await this.snapshot()).mutationToken; }

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

  async deleteWithDependencyCheck(id: string): Promise<CompositionDeleteOutcome> {
    return this.request<CompositionDeleteOutcome>("delete-with-dependency-check", { id });
  }

  async unpublishWithDependencyCheck(id: string): Promise<CompositionUnpublishOutcome> {
    return this.requestWithOutputPlan<CompositionUnpublishOutcome>("unpublish-with-dependency-check", { id });
  }

  async saveLifecycleRecord(record: CompositionRecord): Promise<void> {
    const validation = validateCompositionRecord(record);
    if (!validation.ok) throw persistenceError("put", "validation", validation.issue.message, false);
    await this.requestWithOutputPlan<null>("save-lifecycle-record", { record: validation.record });
  }

  async clear(): Promise<void> {
    await this.request<null>("clear");
  }

  private async requestWithOutputPlan<T>(
    operation: "list" | "get" | "put" | "save-lifecycle-record" | "unpublish-with-dependency-check",
    fields: Record<string, unknown> = {},
    decodeResult: (result: T) => T = (result) => result,
  ): Promise<T> {
    const outputsById: Record<string, ComposerFileProviderDerivedOutputPlan> = Object.create(null);
    for (let round = 0; round < MAX_OUTPUT_PLAN_ROUNDS; round += 1) {
      const response = await this.fetchJson<T>(operation, { ...fields, outputsById });
      if (response.ok === true) {
        const result = decodeResult(response.result);
        if (operation !== "list" && operation !== "get") notifyPersistenceChange(COMPOSITION_FILE_PROVIDER_CHANNEL);
        return result;
      }
      if (response.ok !== "needs-output") {
        throw this.fromServerError(persistenceOperation(operation), response.error);
      }
      if (!isOutputRequest(response.request)) {
        throw persistenceError(
          persistenceOperation(operation),
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
            persistenceOperation(operation),
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
      persistenceOperation(operation),
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

  private async request<T>(operation: WireOperation, fields: Record<string, unknown> = {}): Promise<T> {
    const response = await this.fetchJson<T>(operation, fields);
    if (response.ok === true) {
      const deleted = operation === "delete" && response.result === true;
      const lifecycleDeleted = operation === "delete-with-dependency-check"
        && typeof response.result === "object" && response.result !== null
        && "status" in response.result && response.result.status === "deleted";
      if (operation === "clear" || deleted || lifecycleDeleted) notifyPersistenceChange(COMPOSITION_FILE_PROVIDER_CHANNEL);
      return response.result;
    }
    if (response.ok === "needs-output") {
      throw persistenceError(
        persistenceOperation(operation),
        "validation",
        `The file provider unexpectedly requested output planning for "${operation}".`,
        false,
      );
    }
    throw this.fromServerError(persistenceOperation(operation), response.error);
  }

  private async fetchJson<T>(
    operation: WireOperation,
    fields: Record<string, unknown>,
  ): Promise<ProtocolResponse<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [this.config.capabilityHeader]: this.config.capability,
          [this.config.workspaceHeader]: this.workspace(),
        },
        body: JSON.stringify({ operation, ...fields }),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (cause) {
      throw persistenceError(
        persistenceOperation(operation),
        "unavailable",
        "The development file provider is unavailable. Confirm `pnpm dev` is running and retry.",
        true,
        cause,
      );
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      throw persistenceError(
        persistenceOperation(operation),
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
        persistenceOperation(operation),
        "unknown",
        "The development file provider returned malformed JSON.",
        true,
        cause,
      );
    }
    if (!isProtocolResponse<T>(payload)) {
      // Preserve the planning-specific diagnostic even though malformed closures
      // are rejected at the transport boundary.
      if (typeof payload === "object" && payload !== null && "ok" in payload && payload.ok === "needs-output") {
        throw persistenceError(
          persistenceOperation(operation),
          "validation",
          "The file provider returned an invalid dependency closure for output planning.",
          false,
        );
      }
      throw persistenceError(
        persistenceOperation(operation),
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
  /** The open workspace whose composition directory this store addresses. */
  workspace: () => string;
  /** Test seam; production callers use the dev server's injected configuration. */
  config?: ComposerFileProviderConfig;
}

/**
 * Returns the file store only when the dev virtual capability exists. A
 * production build resolves the virtual module to `undefined`, and a caller
 * that gets `undefined` has no composition provider at all.
 */
export function createFileProviderCompositionStore(
  options: CreateFileProviderCompositionStoreOptions,
): CompositionLifecycleStore | undefined {
  const config = options.config ?? fileProviderConfig;
  if (config === undefined) return undefined;
  return new BrowserFileProviderCompositionStore(
    config,
    options.catalog,
    options.fetch ?? globalThis.fetch.bind(globalThis),
    options.workspace,
  );
}
