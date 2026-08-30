import type { CompositionRecord } from "../../composer/library";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model";
import type { MappingRecord } from "../../mapping/model";
import type { SitemapRecord } from "../../sitemapper/library";
import { canonicalizeSiteProject, compareUnicodeCodePoints } from "./canonical";
import { browserProviderIdFor } from "./provider-registry";
import type { SiteProjectDomain } from "./provider-registry";
import type { SiteProject, SiteProjectRecordRef } from "./types";

export interface InMemorySiteProjectStore<TRecord extends { id: string }> {
  readonly providerId: string;
  list(): readonly TRecord[];
  get(recordId: string): TRecord | undefined;
}

export interface InMemorySiteProjectProvider<TRecord extends { id: string }> {
  readonly descriptor: {
    readonly id: string;
    readonly browserProviderId: string;
  };
  readonly store: InMemorySiteProjectStore<TRecord>;
}

export interface InMemorySiteProjectCatalogEntry<TRecord> {
  readonly ref: SiteProjectRecordRef;
  readonly record: TRecord;
}

export interface InMemorySiteProjectCatalog<TRecord extends { id: string }> {
  list(): readonly InMemorySiteProjectCatalogEntry<TRecord>[];
  resolve(ref: SiteProjectRecordRef): TRecord | undefined;
}

export interface InMemorySiteProjectDomainAdapters<TRecord extends { id: string }> {
  readonly providers: readonly InMemorySiteProjectProvider<TRecord>[];
  readonly stores: ReadonlyMap<string, InMemorySiteProjectStore<TRecord>>;
  readonly catalog: InMemorySiteProjectCatalog<TRecord>;
}

export interface InMemorySiteProjectContentStore {
  readonly providerId: string;
  listModels(): readonly ContentModelRecord[];
  getModel(recordId: string): ContentModelRecord | undefined;
  listEntries(modelId?: string): readonly ContentEntryRecord[];
  getEntry(recordId: string): ContentEntryRecord | undefined;
}

export interface InMemorySiteProjectContentProvider {
  readonly descriptor: { readonly id: string; readonly browserProviderId: string };
  readonly store: InMemorySiteProjectContentStore;
}

export interface InMemorySiteProjectContentCatalog {
  listModels(): readonly InMemorySiteProjectCatalogEntry<ContentModelRecord>[];
  resolveModel(ref: SiteProjectRecordRef): ContentModelRecord | undefined;
  listEntries(modelRef?: SiteProjectRecordRef): readonly InMemorySiteProjectCatalogEntry<ContentEntryRecord>[];
  resolveEntry(ref: SiteProjectRecordRef): ContentEntryRecord | undefined;
}

export interface InMemorySiteProjectContentAdapters {
  readonly providers: readonly InMemorySiteProjectContentProvider[];
  readonly stores: ReadonlyMap<string, InMemorySiteProjectContentStore>;
  readonly catalog: InMemorySiteProjectContentCatalog;
}

export interface InMemorySiteProjectAdapters {
  readonly project: SiteProject;
  readonly compositions: InMemorySiteProjectDomainAdapters<CompositionRecord>;
  readonly content: InMemorySiteProjectContentAdapters;
  readonly mappings: InMemorySiteProjectDomainAdapters<MappingRecord>;
  readonly sitemaps: InMemorySiteProjectDomainAdapters<SitemapRecord>;
  readonly activeSitemap: SitemapRecord;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function createDomainAdapters<TRecord extends { id: string }>(
  domain: Exclude<SiteProjectDomain, "content">,
  collections: readonly { id: string; records: readonly TRecord[] }[],
): InMemorySiteProjectDomainAdapters<TRecord> {
  const providers = collections.map((collection) => {
    const records = collection.records;
    const byId = new Map(records.map((record) => [record.id, record]));
    const store: InMemorySiteProjectStore<TRecord> = Object.freeze({
      providerId: collection.id,
      list: () => records,
      get: (recordId: string) => byId.get(recordId),
    });
    return Object.freeze({
      descriptor: Object.freeze({
        id: collection.id,
        browserProviderId: browserProviderIdFor(domain, collection.id as never),
      }),
      store,
    });
  });
  const stores = new Map(providers.map((provider) => [provider.descriptor.id, provider.store]));
  const entries = providers.flatMap((provider) => provider.store.list().map((record) => Object.freeze({
    ref: Object.freeze({ providerId: provider.descriptor.id, recordId: record.id }),
    record,
  })));
  const catalog: InMemorySiteProjectCatalog<TRecord> = Object.freeze({
    list: () => entries,
    resolve: (ref: SiteProjectRecordRef) => stores.get(ref.providerId)?.get(ref.recordId),
  });
  return Object.freeze({ providers: Object.freeze(providers), stores, catalog });
}

function createContentAdapters(collections: SiteProject["providers"]["content"]): InMemorySiteProjectContentAdapters {
  const providers = collections.map((collection) => {
    const models = collection.models;
    const entries = collection.entries;
    const modelsById = new Map(models.map((record) => [record.id, record]));
    const entriesById = new Map(entries.map((record) => [record.id, record]));
    const store: InMemorySiteProjectContentStore = Object.freeze({
      providerId: collection.id,
      listModels: () => models,
      getModel: (recordId: string) => modelsById.get(recordId),
      listEntries: (modelId?: string) => modelId === undefined ? entries : entries.filter((entry) => entry.modelId === modelId),
      getEntry: (recordId: string) => entriesById.get(recordId),
    });
    return Object.freeze({
      descriptor: Object.freeze({ id: collection.id, browserProviderId: browserProviderIdFor("content", collection.id as never) }),
      store,
    });
  });
  const stores = new Map(providers.map((provider) => [provider.descriptor.id, provider.store]));
  const modelEntries = providers.flatMap((provider) => provider.store.listModels().map((record) => Object.freeze({ ref: Object.freeze({ providerId: provider.descriptor.id, recordId: record.id }), record })));
  const contentEntries = providers.flatMap((provider) => provider.store.listEntries().map((record) => Object.freeze({ ref: Object.freeze({ providerId: provider.descriptor.id, recordId: record.id }), record })));
  const catalog: InMemorySiteProjectContentCatalog = Object.freeze({
    listModels: () => modelEntries,
    resolveModel: (ref: SiteProjectRecordRef) => stores.get(ref.providerId)?.getModel(ref.recordId),
    listEntries: (modelRef?: SiteProjectRecordRef) => modelRef === undefined
      ? contentEntries
      : contentEntries.filter((entry) => entry.ref.providerId === modelRef.providerId && entry.record.modelId === modelRef.recordId),
    resolveEntry: (ref: SiteProjectRecordRef) => stores.get(ref.providerId)?.getEntry(ref.recordId),
  });
  return Object.freeze({ providers: Object.freeze(providers), stores, catalog });
}

/** Builds immutable, read-only provider/store/catalog views over a detached snapshot. */
export function createInMemorySiteProjectAdapters(project: SiteProject): InMemorySiteProjectAdapters {
  const snapshot = deepFreeze(canonicalizeSiteProject(project));
  const compositions = createDomainAdapters("compositions", snapshot.providers.compositions);
  const content = createContentAdapters(snapshot.providers.content);
  const mappings = createDomainAdapters("mappings", snapshot.providers.mappings);
  const sitemaps = createDomainAdapters("sitemaps", snapshot.providers.sitemaps);
  const activeSitemap = sitemaps.catalog.resolve(snapshot.activeSitemap);
  if (!activeSitemap) throw new TypeError("SiteProject active Sitemap is missing; validate the project before creating adapters.");
  return Object.freeze({ project: snapshot, compositions, content, mappings, sitemaps, activeSitemap });
}

/** Stable helper for callers that need to sort provider-qualified references. */
export function compareSiteProjectRefs(left: SiteProjectRecordRef, right: SiteProjectRecordRef): number {
  return compareUnicodeCodePoints(left.providerId, right.providerId)
    || compareUnicodeCodePoints(left.recordId, right.recordId);
}
