// The browser half of the filesystem Mapping provider.
//
// It is the same `MappingStore` the dev server runs, reached over one
// capability-protected same-origin endpoint. Nothing here touches browser
// storage: durable Mapping data lives only in the host project's files, and
// the refresh-hint bus carries a channel name, never data.
//
// Every response is re-validated with Mapping's own model validators. The
// transport guarantees only the envelope shape, so a payload is treated exactly
// as an unread record on disk would be.

import { domainProviderConfig } from "virtual:composer-domain-providers";
import {
  MAPPING_PROVIDERS,
  MappingPersistenceError,
  decodeMappingRecord,
} from "../../model";
import type {
  MappingInitializationOutcome,
  MappingLoadOutcome,
  MappingPersistenceOperation,
  MappingRecord,
  MappingRecoveryOutcome,
  MappingSeed,
  MappingSummary,
  MappingValidationIssue,
} from "../../model";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import { DomainFileProviderClient, readDomainFileProviderConfig } from "../../../shared/file-provider";
import { mappingFileProviderErrorAdapter } from "./error-adapter";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "./types";
import type {
  MappingFileProvider,
  MappingFileProviderConfig,
  MappingFileProviderStore,
  MappingWireOperation,
} from "./types";

/**
 * `transact` is a real `MappingPersistenceOperation` (the Node store tags its
 * whole-batch commit with it), but it never crosses the wire as its own
 * operation header — the shared `transaction` operation drives it instead —
 * so it is excluded here to keep this type assignable to `MappingWireOperation`
 * wherever a decode helper reports an operation back through the error adapter.
 */
type BrowserMappingOperation = Exclude<MappingPersistenceOperation, "transact">;

function malformed(operation: BrowserMappingOperation, detail: string): MappingPersistenceError {
  return new MappingPersistenceError(operation, "validation", `The local Mapping provider returned ${detail}.`, false);
}

function decodeRecord(raw: unknown, operation: BrowserMappingOperation): MappingRecord {
  const loaded = decodeMappingRecord(raw);
  if (loaded.status !== "loaded") throw malformed(operation, "a Mapping record that does not validate");
  return loaded.record;
}

/**
 * A load outcome is the one payload that legitimately carries data Mapping
 * rejects: `invalid` and `future-schema` describe a preserved record. Only the
 * `loaded` branch is re-validated.
 */
function decodeLoadOutcome(value: unknown, operation: BrowserMappingOperation): MappingLoadOutcome {
  if (!isPlainObject(value) || typeof value.status !== "string") throw malformed(operation, "a malformed load outcome");
  switch (value.status) {
    case "loaded":
      return { status: "loaded", record: decodeRecord(value.record, operation) };
    case "not-found":
      if (typeof value.id !== "string") break;
      return { status: "not-found", id: value.id };
    case "invalid":
      if (!isPlainObject(value.issue) || typeof value.issue.message !== "string" || typeof value.issue.code !== "string") break;
      return { status: "invalid", issue: value.issue as unknown as MappingValidationIssue, raw: value.raw };
    case "future-schema":
      if (!Number.isSafeInteger(value.foundSchemaVersion)) break;
      return { status: "future-schema", foundSchemaVersion: value.foundSchemaVersion as number, raw: value.raw };
  }
  throw malformed(operation, "a malformed load outcome");
}

function decodeSummaries(value: unknown, operation: BrowserMappingOperation): MappingSummary[] {
  if (!Array.isArray(value)) throw malformed(operation, "a malformed Mapping list");
  return value.map((summary) => {
    if (!isPlainObject(summary) || !isSafeRecordId(summary.id) || typeof summary.name !== "string"
      || typeof summary.createdAt !== "string" || typeof summary.updatedAt !== "string"
      || !Number.isSafeInteger(summary.bindingCount)) {
      throw malformed(operation, "a malformed Mapping summary");
    }
    return summary as unknown as MappingSummary;
  });
}

function decodeInitialization(value: unknown, operation: BrowserMappingOperation): MappingInitializationOutcome {
  if (!isPlainObject(value)) throw malformed(operation, "a malformed initialization outcome");
  if (value.status === "ready") return { status: "ready", summaries: decodeSummaries(value.summaries, operation) };
  if (value.status === "recovery-required" && isPlainObject(value.recovery)) {
    return {
      status: "recovery-required",
      summaries: decodeSummaries(value.summaries, operation),
      recovery: value.recovery as unknown as MappingRecoveryOutcome,
    };
  }
  if (value.status === "error") {
    return { status: "error", error: mappingFileProviderErrorAdapter.fromWire(value.error as never, operation) };
  }
  throw malformed(operation, "a malformed initialization outcome");
}

export interface CreateFileProviderMappingStoreOptions {
  config: MappingFileProviderConfig;
  fetchImpl?: typeof fetch;
  /** The open workspace this provider's records are scoped to. */
  workspace?: () => string;
}

export class FileProviderMappingStore implements MappingFileProviderStore {
  readonly provider = MAPPING_PROVIDERS.filesystem;
  private readonly client: DomainFileProviderClient<MappingWireOperation, MappingPersistenceError>;

  constructor(options: CreateFileProviderMappingStoreOptions) {
    this.client = new DomainFileProviderClient(
      options.config,
      mappingFileProviderErrorAdapter,
      options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.workspace,
    );
  }

  /** The durable content fingerprint the record store commits with. */
  async snapshot(): Promise<{ mutationToken: string; records: readonly MappingRecord[] }> {
    const value = await this.client.call<unknown>("snapshot");
    if (!isPlainObject(value) || typeof value.mutationToken !== "string" || !Array.isArray(value.records)) {
      throw malformed("list", "a malformed Mapping snapshot");
    }
    return { mutationToken: value.mutationToken, records: value.records.map((record) => decodeRecord(record, "list")) };
  }

  async mutationToken(): Promise<string> {
    return (await this.snapshot()).mutationToken;
  }

  async readAll(): Promise<readonly MappingRecord[]> {
    const records = await this.client.call<unknown>("read-all");
    if (!Array.isArray(records)) throw malformed("list", "a malformed Mapping record set");
    return records.map((record) => decodeRecord(record, "list"));
  }

  async list(): Promise<readonly MappingSummary[]> {
    return decodeSummaries(await this.client.call("list"), "list");
  }

  async get(id: string): Promise<MappingLoadOutcome> {
    return decodeLoadOutcome(await this.client.call("get", { id }), "get");
  }

  async put(record: MappingRecord): Promise<void> {
    await this.client.call("put", { record }, { mutates: true });
  }

  async delete(id: string): Promise<boolean> {
    return this.decodeBoolean(await this.client.call("delete", { id }, { mutates: true }), "delete");
  }

  async seed(seed: MappingSeed): Promise<void> {
    await this.client.call("seed", { seed }, { mutates: true });
  }

  async clear(): Promise<void> {
    await this.client.call("clear", undefined, { mutates: true });
  }

  async initialize(): Promise<MappingInitializationOutcome> {
    return decodeInitialization(await this.client.call("initialize"), "initialize");
  }

  async startFresh(): Promise<MappingInitializationOutcome> {
    return decodeInitialization(await this.client.call("start-fresh", undefined, { mutates: true }), "clear");
  }

  private decodeBoolean(value: unknown, operation: BrowserMappingOperation): boolean {
    if (typeof value !== "boolean") throw malformed(operation, "a non-boolean deletion result");
    return value;
  }
}

export function createFileProviderMappingProvider(
  options: CreateFileProviderMappingStoreOptions,
): MappingFileProvider {
  const store = new FileProviderMappingStore(options);
  return {
    descriptor: MAPPING_PROVIDERS.filesystem,
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
 * build. A caller that gets undefined has no filesystem Mapping provider and
 * must say so rather than falling back to some other store.
 */
export function readMappingFileProviderConfig(): MappingFileProviderConfig | undefined {
  return readDomainFileProviderConfig(domainProviderConfig, MAPPING_FILE_PROVIDER_DOMAIN);
}
