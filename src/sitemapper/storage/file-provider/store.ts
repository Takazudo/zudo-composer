// The browser half of the filesystem Sitemapper provider.
//
// It is the same `SitemapCollectionStore` the dev server runs, reached over
// one capability-protected same-origin endpoint. Nothing here touches browser
// storage: durable Sitemap data lives only in the host project's files, and
// the refresh-hint bus carries a channel name, never data.
//
// Every response is re-validated with Sitemapper's own record validator. The
// transport guarantees only the envelope shape, so a payload is treated exactly
// as an unread record on disk would be.

import { domainProviderConfig } from "virtual:composer-domain-providers";
import {
  SITEMAP_PROVIDERS,
  SitemapPersistenceError,
  loadSitemapRecord,
} from "../../library";
import type {
  SitemapInitializationOutcome,
  SitemapPersistenceOperation,
  SitemapRecoveryOutcome,
  SitemapRecord,
  SitemapRecordLoadOutcome,
  SitemapRecordValidationIssue,
  SitemapSummary,
} from "../../library";
import { isPlainObject, isSafeRecordId } from "../../../shared";
import { DomainFileProviderClient, readDomainFileProviderConfig } from "../../../shared/file-provider";
import { sitemapFileProviderErrorAdapter } from "./wire-error";
import { SITEMAP_FILE_PROVIDER_DOMAIN } from "./types";
import type {
  SitemapFileProvider,
  SitemapFileProviderConfig,
  SitemapFileProviderStore,
  SitemapWireOperation,
} from "./types";

/**
 * `transact` is a real `SitemapPersistenceOperation` (the Node store tags its
 * whole-batch commit with it), but it never crosses the wire as its own
 * operation header — the shared `transaction` operation drives it instead —
 * so it is excluded here to keep this type assignable to `SitemapWireOperation`
 * wherever a decode helper reports an operation back through `sitemapFileProviderErrorAdapter`.
 */
type BrowserSitemapOperation = Exclude<SitemapPersistenceOperation, "transact">;

function malformed(operation: BrowserSitemapOperation, detail: string): SitemapPersistenceError {
  return new SitemapPersistenceError(operation, "validation", `The local Sitemapper provider returned ${detail}.`, false);
}

function decodeRecord(raw: unknown, operation: BrowserSitemapOperation): SitemapRecord {
  const loaded = loadSitemapRecord(raw);
  if (loaded.status !== "loaded") throw malformed(operation, "a Sitemap record that does not validate");
  return loaded.record;
}

/**
 * A load outcome is the one payload that legitimately carries data Sitemapper
 * rejects: `invalid` and `future-schema` describe a preserved record. Only the
 * `loaded` branch is re-validated.
 */
function decodeLoadOutcome(value: unknown, operation: BrowserSitemapOperation): SitemapRecordLoadOutcome {
  if (!isPlainObject(value) || typeof value.status !== "string") throw malformed(operation, "a malformed load outcome");
  switch (value.status) {
    case "loaded":
      return { status: "loaded", record: decodeRecord(value.record, operation) };
    case "not-found":
      if (typeof value.id !== "string") break;
      return { status: "not-found", id: value.id };
    case "invalid":
      if (!isPlainObject(value.issue) || typeof value.issue.message !== "string" || typeof value.issue.code !== "string") break;
      return { status: "invalid", issue: value.issue as unknown as SitemapRecordValidationIssue, raw: value.raw };
    case "future-schema":
      if (!Number.isSafeInteger(value.foundSchemaVersion)) break;
      return { status: "future-schema", foundSchemaVersion: value.foundSchemaVersion as number, raw: value.raw };
  }
  throw malformed(operation, "a malformed load outcome");
}

function decodeSummaries(value: unknown, operation: BrowserSitemapOperation): SitemapSummary[] {
  if (!Array.isArray(value)) throw malformed(operation, "a malformed Sitemap list");
  return value.map((summary) => {
    if (!isPlainObject(summary) || !isSafeRecordId(summary.id) || typeof summary.name !== "string"
      || typeof summary.createdAt !== "string" || typeof summary.updatedAt !== "string"
      || !Number.isSafeInteger(summary.pageCount) || !Number.isSafeInteger(summary.unassignedCount)) {
      throw malformed(operation, "a malformed Sitemap summary");
    }
    return summary as unknown as SitemapSummary;
  });
}

function decodeInitialization(value: unknown, operation: BrowserSitemapOperation): SitemapInitializationOutcome {
  if (!isPlainObject(value)) throw malformed(operation, "a malformed initialization outcome");
  if (value.status === "ready") return { status: "ready", summaries: decodeSummaries(value.summaries, operation) };
  if (value.status === "recovery-required" && isPlainObject(value.recovery)) {
    return {
      status: "recovery-required",
      summaries: decodeSummaries(value.summaries, operation),
      recovery: value.recovery as unknown as SitemapRecoveryOutcome,
    };
  }
  if (value.status === "error") {
    return { status: "error", error: sitemapFileProviderErrorAdapter.fromWire(value.error as never, operation) };
  }
  throw malformed(operation, "a malformed initialization outcome");
}

export interface CreateFileProviderSitemapStoreOptions {
  config: SitemapFileProviderConfig;
  fetchImpl?: typeof fetch;
  /** The open workspace this provider's records are scoped to. */
  workspace?: () => string;
}

export class FileProviderSitemapStore implements SitemapFileProviderStore {
  readonly provider = SITEMAP_PROVIDERS.filesystem;
  private readonly client: DomainFileProviderClient<SitemapWireOperation, SitemapPersistenceError>;

  constructor(options: CreateFileProviderSitemapStoreOptions) {
    this.client = new DomainFileProviderClient(
      options.config,
      sitemapFileProviderErrorAdapter,
      options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.workspace,
    );
  }

  async list(): Promise<readonly SitemapSummary[]> {
    return decodeSummaries(await this.client.call("list"), "list");
  }

  async get(id: string): Promise<SitemapRecordLoadOutcome> {
    return decodeLoadOutcome(await this.client.call("get", { id }), "get");
  }

  async put(record: SitemapRecord): Promise<void> {
    await this.client.call("put", { record }, { mutates: true });
  }

  async delete(id: string): Promise<boolean> {
    return this.decodeBoolean(await this.client.call("delete", { id }, { mutates: true }), "delete");
  }

  async seed(records: readonly SitemapRecord[]): Promise<void> {
    await this.client.call("seed", { records }, { mutates: true });
  }

  async clear(): Promise<void> {
    await this.client.call("clear", undefined, { mutates: true });
  }

  async readAll(): Promise<readonly SitemapRecord[]> {
    const records = await this.client.call<unknown>("read-all");
    if (!Array.isArray(records)) throw malformed("list", "a malformed Sitemap snapshot");
    return records.map((record) => decodeRecord(record, "list"));
  }

  /** The durable content fingerprint the record store commits with. */
  async snapshot(): Promise<{ mutationToken: string; records: readonly SitemapRecord[] }> {
    const value = await this.client.call<unknown>("snapshot");
    if (!isPlainObject(value) || typeof value.mutationToken !== "string" || !Array.isArray(value.records)) {
      throw malformed("list", "a malformed Sitemap snapshot");
    }
    return { mutationToken: value.mutationToken, records: value.records.map((record) => decodeRecord(record, "list")) };
  }

  async mutationToken(): Promise<string> {
    return (await this.snapshot()).mutationToken;
  }

  async initialize(): Promise<SitemapInitializationOutcome> {
    return decodeInitialization(await this.client.call("initialize"), "initialize");
  }

  async startFresh(): Promise<SitemapInitializationOutcome> {
    return decodeInitialization(await this.client.call("start-fresh", undefined, { mutates: true }), "clear");
  }

  private decodeBoolean(value: unknown, operation: BrowserSitemapOperation): boolean {
    if (typeof value !== "boolean") throw malformed(operation, "a non-boolean deletion result");
    return value;
  }
}

export function createFileProviderSitemapProvider(
  options: CreateFileProviderSitemapStoreOptions,
): SitemapFileProvider {
  const store = new FileProviderSitemapStore(options);
  return {
    descriptor: SITEMAP_PROVIDERS.filesystem,
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
 * build. A caller that gets undefined has no filesystem Sitemapper provider and
 * must say so rather than falling back to some other store.
 */
export function readSitemapFileProviderConfig(): SitemapFileProviderConfig | undefined {
  return readDomainFileProviderConfig(domainProviderConfig, SITEMAP_FILE_PROVIDER_DOMAIN);
}
