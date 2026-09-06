// The browser half of the filesystem Content provider.
//
// It is the same `ContentStore` the dev server runs, reached over one
// capability-protected same-origin endpoint. Nothing here touches browser
// storage: durable Content lives only in the host project's files, and the
// refresh-hint bus carries a channel name, never data.
//
// Every response is re-validated with Content's own model validators. The
// transport guarantees only the envelope shape, so a payload is treated exactly
// as an unread record on disk would be.

import { domainProviderConfig } from "virtual:composer-domain-providers";
import {
  CONTENT_PROVIDERS,
  ContentPersistenceError,
} from "../../library";
import type {
  ContentEntryPage,
  ContentEntrySnapshot,
  ContentInitializationOutcome,
  ContentModelSummary,
  ContentMutation,
  ContentPageOptions,
  ContentPersistenceOperation,
  ContentPublicationReconciliation,
  ContentRecoveryOutcome,
  ContentSeed,
  ContentSnapshot,
} from "../../library";
import { loadContentEntryRecord, loadContentModelRecord } from "../../model";
import type { ContentEntryRecord, ContentLoadOutcome, ContentModelRecord, ContentValidationIssue } from "../../model";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import { DomainFileProviderClient, readDomainFileProviderConfig } from "../../../shared/file-provider";
import { contentFileProviderErrorAdapter } from "./error-adapter";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "./types";
import type {
  ContentFileProvider,
  ContentFileProviderConfig,
  ContentFileProviderStore,
  ContentWireOperation,
} from "./types";

function malformed(operation: ContentPersistenceOperation, detail: string): ContentPersistenceError {
  return new ContentPersistenceError(
    operation,
    "validation",
    `The local Content provider returned ${detail}.`,
    false,
  );
}

function decodeModel(raw: unknown, operation: ContentPersistenceOperation): ContentModelRecord {
  const loaded = loadContentModelRecord(raw);
  if (loaded.status !== "loaded") throw malformed(operation, "a Content model that does not validate");
  return loaded.record;
}

function decodeEntry(raw: unknown, operation: ContentPersistenceOperation): ContentEntryRecord {
  const loaded = loadContentEntryRecord(raw);
  if (loaded.status !== "loaded") throw malformed(operation, "an Entry that does not validate");
  return loaded.record;
}

function decodeSnapshot(value: unknown, operation: ContentPersistenceOperation): ContentSnapshot {
  if (!isPlainObject(value)
    || typeof value.providerId !== "string"
    || !Number.isSafeInteger(value.mutationToken) || (value.mutationToken as number) < 0
    || !Array.isArray(value.models) || !Array.isArray(value.entries)) {
    throw malformed(operation, "a malformed Content snapshot");
  }
  return {
    providerId: value.providerId,
    mutationToken: value.mutationToken as number,
    models: value.models.map((model) => decodeModel(model, operation)),
    entries: value.entries.map((entry) => decodeEntry(entry, operation)),
  };
}

/**
 * A load outcome is the one payload that legitimately carries data Content
 * rejects: `invalid` and `future-schema` describe a preserved record. Only the
 * `loaded` branch is re-validated.
 */
function decodeLoadOutcome<T>(
  value: unknown,
  operation: ContentPersistenceOperation,
  decode: (raw: unknown, operation: ContentPersistenceOperation) => T,
): ContentLoadOutcome<T> {
  if (!isPlainObject(value) || typeof value.status !== "string") throw malformed(operation, "a malformed load outcome");
  switch (value.status) {
    case "loaded":
      return { status: "loaded", record: decode(value.record, operation) };
    case "not-found":
      if (typeof value.id !== "string") break;
      return { status: "not-found", id: value.id };
    case "invalid":
      if (!isPlainObject(value.issue) || typeof value.issue.message !== "string" || typeof value.issue.code !== "string") break;
      return { status: "invalid", issue: value.issue as unknown as ContentValidationIssue, raw: value.raw };
    case "future-schema":
      if (!Number.isSafeInteger(value.foundSchemaVersion)) break;
      return { status: "future-schema", foundSchemaVersion: value.foundSchemaVersion as number, raw: value.raw };
  }
  throw malformed(operation, "a malformed load outcome");
}

function decodeSummaries(value: unknown, operation: ContentPersistenceOperation): ContentModelSummary[] {
  if (!Array.isArray(value)) throw malformed(operation, "a malformed model list");
  return value.map((summary) => {
    if (!isPlainObject(summary) || !isSafeRecordId(summary.id) || typeof summary.name !== "string"
      || (summary.kind !== "collection" && summary.kind !== "single")
      || !Number.isSafeInteger(summary.fieldCount)
      || typeof summary.createdAt !== "string" || typeof summary.updatedAt !== "string") {
      throw malformed(operation, "a malformed model summary");
    }
    return summary as unknown as ContentModelSummary;
  });
}

function decodeInitialization(value: unknown, operation: ContentPersistenceOperation): ContentInitializationOutcome {
  if (!isPlainObject(value)) throw malformed(operation, "a malformed initialization outcome");
  if (value.status === "ready") return { status: "ready", models: decodeSummaries(value.models, operation) };
  if (value.status === "recovery-required" && isPlainObject(value.recovery)) {
    return {
      status: "recovery-required",
      models: decodeSummaries(value.models, operation),
      recovery: value.recovery as unknown as ContentRecoveryOutcome,
    };
  }
  if (value.status === "error") {
    return { status: "error", error: contentFileProviderErrorAdapter.fromWire(value.error as never, operation) };
  }
  throw malformed(operation, "a malformed initialization outcome");
}

export interface CreateFileProviderContentStoreOptions {
  config: ContentFileProviderConfig;
  fetchImpl?: typeof fetch;
}

export class FileProviderContentStore implements ContentFileProviderStore {
  readonly provider = CONTENT_PROVIDERS.filesystem;
  readonly transactionScope = "provider" as const;
  private readonly client: DomainFileProviderClient<ContentWireOperation, ContentPersistenceError>;

  constructor(options: CreateFileProviderContentStoreOptions) {
    this.client = new DomainFileProviderClient(
      options.config,
      contentFileProviderErrorAdapter,
      options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    );
  }

  async readAll(): Promise<ContentSnapshot> {
    return decodeSnapshot(await this.client.call("read-all"), "read-all");
  }

  async transact(mutation: ContentMutation): Promise<ContentSnapshot> {
    return decodeSnapshot(await this.client.call("transact", mutation, { mutates: true }), "transact");
  }

  /**
   * `signal` abandons the request, not the transaction. The dev server commits
   * or fails on its own; the activation fence is what makes an abandoned
   * reconciliation safe to observe later, not the abort.
   */
  async reconcilePublication(
    reconciliations: readonly ContentPublicationReconciliation[],
    activationGeneration: number,
    signal?: AbortSignal,
  ): Promise<ContentSnapshot & { activationGeneration: number }> {
    const result = await this.client.call<unknown>(
      "reconcile-publication",
      { reconciliations, activationGeneration },
      { mutates: true, ...(signal === undefined ? {} : { signal }) },
    );
    const snapshot = decodeSnapshot(result, "reconcile-publication");
    const fence = (result as { activationGeneration?: unknown }).activationGeneration;
    if (!Number.isSafeInteger(fence) || (fence as number) < 1) {
      throw malformed("reconcile-publication", "a reconciliation without a usable activation fence");
    }
    return { ...snapshot, activationGeneration: fence as number };
  }

  async listModels(): Promise<readonly ContentModelSummary[]> {
    return decodeSummaries(await this.client.call("list-models"), "list-models");
  }

  async getModel(id: string): Promise<ContentLoadOutcome<ContentModelRecord>> {
    return decodeLoadOutcome(await this.client.call("get-model", { id }), "get-model", decodeModel);
  }

  async putModel(record: ContentModelRecord): Promise<void> {
    await this.client.call("put-model", { record }, { mutates: true });
  }

  async deleteModel(id: string): Promise<boolean> {
    return this.decodeBoolean(await this.client.call("delete-model", { id }, { mutates: true }), "delete-model");
  }

  async countEntries(modelId: string): Promise<number> {
    const count = await this.client.call<unknown>("count-entries", { modelId });
    if (!Number.isSafeInteger(count) || (count as number) < 0) throw malformed("count-entries", "a malformed entry count");
    return count as number;
  }

  async getEntry(id: string): Promise<ContentLoadOutcome<ContentEntryRecord>> {
    return decodeLoadOutcome(await this.client.call("get-entry", { id }), "get-entry", decodeEntry);
  }

  async pageEntries(modelId: string, options: ContentPageOptions = {}): Promise<ContentEntryPage> {
    const page = await this.client.call<unknown>("page-entries", { modelId, options });
    if (!isPlainObject(page) || !Array.isArray(page.entries)
      || (page.nextCursor !== undefined && typeof page.nextCursor !== "string")) {
      throw malformed("page-entries", "a malformed entry page");
    }
    return {
      entries: page.entries.map((entry) => decodeEntry(entry, "page-entries")),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  async scanEntries(modelId: string): Promise<ContentEntrySnapshot> {
    const scan = await this.client.call<unknown>("scan-entries", { modelId });
    if (!isPlainObject(scan) || !Array.isArray(scan.entries) || !Array.isArray(scan.diagnostics)
      || !Number.isSafeInteger(scan.count)) {
      throw malformed("scan-entries", "a malformed entry scan");
    }
    return {
      model: decodeModel(scan.model, "scan-entries"),
      count: scan.count as number,
      entries: scan.entries.map((entry) => decodeEntry(entry, "scan-entries")),
      diagnostics: scan.diagnostics as ContentEntrySnapshot["diagnostics"],
    };
  }

  async putEntry(record: ContentEntryRecord): Promise<void> {
    await this.client.call("put-entry", { record }, { mutates: true });
  }

  async deleteEntry(id: string): Promise<boolean> {
    return this.decodeBoolean(await this.client.call("delete-entry", { id }, { mutates: true }), "delete-entry");
  }

  async removeField(modelId: string, fieldId: string): Promise<void> {
    await this.client.call("remove-field", { modelId, fieldId }, { mutates: true });
  }

  async seed(seed: ContentSeed): Promise<void> {
    await this.client.call("seed", { seed }, { mutates: true });
  }

  async clear(): Promise<void> {
    await this.client.call("clear", undefined, { mutates: true });
  }

  async initialize(): Promise<ContentInitializationOutcome> {
    return decodeInitialization(await this.client.call("initialize"), "initialize");
  }

  async startFresh(): Promise<ContentInitializationOutcome> {
    return decodeInitialization(await this.client.call("start-fresh", undefined, { mutates: true }), "clear");
  }

  private decodeBoolean(value: unknown, operation: ContentPersistenceOperation): boolean {
    if (typeof value !== "boolean") throw malformed(operation, "a non-boolean deletion result");
    return value;
  }
}

export function createFileProviderContentProvider(
  options: CreateFileProviderContentStoreOptions,
): ContentFileProvider {
  const store = new FileProviderContentStore(options);
  return {
    descriptor: CONTENT_PROVIDERS.filesystem,
    store,
    initialization: {
      initialize: () => store.initialize(),
      // The dev endpoint holds no connection state, so a retry is a fresh call.
      retry: () => store.initialize(),
      startFresh: () => store.startFresh(),
    },
  };
}

/**
 * The configuration a development server injected, or undefined in a production
 * build. A caller that gets undefined has no filesystem Content provider and
 * must say so rather than falling back to some other store.
 */
export function readContentFileProviderConfig(): ContentFileProviderConfig | undefined {
  return readDomainFileProviderConfig(domainProviderConfig, CONTENT_FILE_PROVIDER_DOMAIN);
}
