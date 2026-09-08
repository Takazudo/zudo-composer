import { notifyPersistenceChange } from "../persistence-generation";
import {
  FILE_PROVIDER_TRANSACTION_OPERATION,
  isFileProviderResponse,
  type FileProviderConfig,
  type FileProviderErrorAdapter,
  type FileProviderTransactionStep,
  type FileProviderTransportOperation,
} from "./protocol";

const encoder = new TextEncoder();

export interface FileProviderCallOptions {
  /** Emit a `zudo-workspace-persistence-v1` refresh hint after a success. */
  mutates?: boolean;
  signal?: AbortSignal;
}

/**
 * The browser half of the domain transport.
 *
 * Every domain provider is built on one of these: it owns capability headers,
 * the request envelope, error round-tripping and the refresh-hint bus, and it
 * knows nothing about any particular domain's records. A domain adds its own
 * typed methods on top and validates results with its own model validators —
 * this client never trusts a payload beyond the envelope shape.
 *
 * Nothing here reads or writes browser storage: durable state lives only on the
 * host filesystem, and the hint bus carries no data.
 */
export class DomainFileProviderClient<Operation extends string, DomainError extends Error> {
  /**
   * `workspace` is consulted per request rather than captured, because a single
   * provider instance outlives the workspace it was opened against: the app
   * switches workspaces without rebuilding its providers.
   */
  constructor(
    private readonly config: FileProviderConfig,
    private readonly adapter: FileProviderErrorAdapter<Operation, DomainError>,
    private readonly fetchImpl: typeof fetch,
    private readonly workspace?: () => string,
  ) {}

  call<T>(operation: Operation, payload?: unknown, options: FileProviderCallOptions = {}): Promise<T> {
    return this.send<T>(operation, payload === undefined ? "" : JSON.stringify(payload), options);
  }

  /**
   * Send several operations as one transaction.
   *
   * The server commits the whole batch or none of it, so this resolves with a
   * single result and rejects with a single error. A rejection means nothing in
   * the batch was applied — except `commit-uncertain`, which means the outcome
   * must be read back from disk before anything is retried.
   */
  transaction<T>(
    steps: readonly FileProviderTransactionStep[],
    options: FileProviderCallOptions & { expectedMutationToken?: string } = {},
  ): Promise<T> {
    return this.send<T>(
      FILE_PROVIDER_TRANSACTION_OPERATION,
      JSON.stringify({ expectedMutationToken: options.expectedMutationToken, steps }),
      { ...options, mutates: options.mutates ?? true },
    );
  }

  private async send<T>(operation: FileProviderTransportOperation<Operation>, body: string, options: FileProviderCallOptions): Promise<T> {
    if (encoder.encode(body).byteLength > this.config.maxBodyBytes) {
      throw this.adapter.transportError(
        operation,
        `Request body exceeds the ${this.config.maxBodyBytes}-byte limit.`,
      );
    }
    let workspaceHeaders: Record<string, string> = {};
    if (this.config.workspaceHeader !== undefined) {
      if (this.workspace === undefined) {
        throw this.adapter.transportError(
          operation,
          `The development ${this.adapter.domain} provider is workspace-scoped but no workspace was supplied.`,
        );
      }
      workspaceHeaders = { [this.config.workspaceHeader]: this.workspace() };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [this.config.capabilityHeader]: this.config.capability,
          [this.config.operationHeader]: operation,
          ...workspaceHeaders,
        },
        body,
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
      });
    } catch (cause) {
      throw this.adapter.transportError(
        operation,
        `The development ${this.adapter.domain} provider is unavailable. Confirm \`pnpm dev\` is running and retry.`,
        cause,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw this.adapter.transportError(
        operation,
        `The development ${this.adapter.domain} provider returned malformed JSON.`,
        cause,
      );
    }
    if (!isFileProviderResponse<T>(payload)) {
      throw this.adapter.transportError(
        operation,
        `The development ${this.adapter.domain} provider returned an invalid response.`,
      );
    }
    if (!payload.ok) throw this.adapter.fromWire(payload.error, operation);
    if (!response.ok) {
      throw this.adapter.transportError(
        operation,
        `The development ${this.adapter.domain} provider returned an unsuccessful HTTP status with a success envelope.`,
      );
    }
    if (options.mutates) notifyPersistenceChange(this.adapter.persistenceChannel);
    return payload.result;
  }
}

/**
 * Read one domain's transport configuration out of the virtual config module.
 *
 * A production build emits no configuration at all, so this returns undefined
 * and the caller falls back to whatever provider it supports there. The dev
 * capability is minted per dev server and never persisted.
 */
export function readDomainFileProviderConfig(
  config: unknown,
  domain: string,
): FileProviderConfig | undefined {
  if (typeof config !== "object" || config === null) return undefined;
  const domains = (config as { domains?: unknown }).domains;
  if (typeof domains !== "object" || domains === null) return undefined;
  const entry = (domains as Record<string, unknown>)[domain];
  if (typeof entry !== "object" || entry === null) return undefined;
  const candidate = entry as Partial<FileProviderConfig>;
  return typeof candidate.endpoint === "string"
    && typeof candidate.capability === "string"
    && typeof candidate.capabilityHeader === "string"
    && typeof candidate.operationHeader === "string"
    && (candidate.workspaceHeader === undefined || typeof candidate.workspaceHeader === "string")
    && typeof candidate.maxBodyBytes === "number"
    ? (candidate as FileProviderConfig)
    : undefined;
}
