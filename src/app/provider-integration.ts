import injectedSiteProject from "virtual:site-project-source";
import { COMPOSITION_SCHEMA_VERSION, CompositionPersistenceError, createFileProviderCompositionStore, createIndexedDbCompositionProvider, diagnoseDocument, isCompositionCollectionStore, type CompositionDocument, type CompositionInitializationOutcome, type CompositionProvider, type CompositionStore } from "../composer/browser";
import { createContentCatalog, type ContentCatalog } from "../content/catalog";
import { ContentPersistenceError, type ContentInitializationOutcome, type ContentProvider } from "../content/library";
import { createIndexedDbContentProvider } from "../content/storage/indexeddb";
import { activeComponentProvider } from "../features/composer/active-pack";
import { createContentPreviewSource, type ContentPreviewSource } from "../features/content/preview-source";
import type { MappingContentEntryCatalog } from "../features/mapping";
import { createCompositionCatalog as createMappingCompositionCatalog, createIndexedDbMappingProvider, createMappingCatalog, MappingPersistenceError, resolveMappingDefinition, type CompositionCatalog as MappingCompositionCatalog, type MappingCatalog, type MappingInitializationOutcome, type MappingProvider, type MappingRecord } from "../mapping";
import { browserProviderIdFor, canonicalizeSiteProject, validateSiteProject, type SiteProject, type SiteProjectDomain } from "../site-project";
import { createCompositionCatalog, createMappingAssignmentCatalog, type CompositionCatalog } from "../sitemapper/catalog";
import { isSitemapCollectionStore, SitemapPersistenceError, type SitemapInitializationOutcome, type SitemapProvider } from "../sitemapper/library";
import type { MappingAssignmentCatalog } from "../sitemapper/routes";
import { createIndexedDbSitemapProvider } from "../sitemapper/storage/indexeddb/provider";
import { activeSiteProjectValidationContext } from "./site-project-manifest";

export class ProviderIntegrationError extends Error {
  readonly name = "ProviderIntegrationError";
  constructor(readonly phase: "source" | "composition" | "content" | "mapping" | "sitemap" | "snapshot", message: string, readonly retryable = true, options?: { cause?: unknown }) { super(message, options); }
}
export type ProviderIntegrationOutcome = { status: "ready" } | { status: "error"; error: ProviderIntegrationError };
export type SiteProjectSnapshotOutcome = { status: "ready"; project: SiteProject } | { status: "error"; error: ProviderIntegrationError };

function providerFromStore(store: CompositionStore): CompositionProvider {
  const initialize = async (): Promise<CompositionInitializationOutcome> => { try { return { status: "ready", summaries: await store.list() }; } catch (cause) { return { status: "error", error: cause instanceof CompositionPersistenceError ? cause : new CompositionPersistenceError("initialize", "unknown", "Composition initialization failed.", true, { cause }) }; } };
  return { descriptor: store.provider, store, initialization: { initialize, retry: initialize, startFresh: initialize } };
}

function activate(value: unknown): { project?: SiteProject; error?: ProviderIntegrationError } {
  if (value === null) return { error: new ProviderIntegrationError("source", "No development SiteProject is activated. Activate one, then retry or start fresh.") };
  const result = validateSiteProject(structuredClone(value), activeSiteProjectValidationContext);
  if (!result.ok) return { error: new ProviderIntegrationError("source", `The active SiteProject is invalid: ${result.diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`, false) };
  for (const provider of result.project.providers.content) for (const model of provider.models) {
    if (model.document.kind === "single" && provider.entries.filter((entry) => entry.modelId === model.id).length > 1) return { error: new ProviderIntegrationError("source", `Single Content model "${model.id}" has more than one seed Entry.`, false) };
  }
  for (const provider of result.project.providers.compositions) for (const record of provider.records) {
    const diagnostics = diagnoseDocument(record.document, activeComponentProvider.catalog, { containingRecordId: record.id });
    if (!diagnostics.canExport) return { error: new ProviderIntegrationError("source", `Composition "${record.id}" is incompatible with the active runtime component pack.`, false) };
  }
  return { project: canonicalizeSiteProject(result.project) };
}

function assertReady(phase: ProviderIntegrationError["phase"], outcome: { status: string; error?: Error; recovery?: { message?: string } }): void {
  if (outcome.status === "ready") return;
  throw new ProviderIntegrationError(phase, outcome.error?.message ?? outcome.recovery?.message ?? `${phase} provider requires recovery.`);
}

function matches(domain: SiteProjectDomain, logicalId: string, browserId: string): boolean {
  try { return browserProviderIdFor(domain, logicalId as never) === browserId; } catch { return false; }
}

interface ContentSnapshotStore { readAll(): Promise<{ models: SiteProject["providers"]["content"][number]["models"]; entries: SiteProject["providers"]["content"][number]["entries"] }> }
interface MappingSnapshotStore { readAll(): Promise<readonly MappingRecord[]> }

export interface ProductionProviderIntegration {
  componentProvider: typeof activeComponentProvider;
  compositionProviders: readonly CompositionProvider[]; compositionCatalog: CompositionCatalog; mappingCompositionCatalog: MappingCompositionCatalog;
  contentProviders: readonly ContentProvider[]; contentProvider: ContentProvider; contentCatalog: ContentCatalog; createContentPreviewSource(): ContentPreviewSource;
  mappingContentEntries: MappingContentEntryCatalog; mappingProviders: readonly MappingProvider[]; mappingProvider: MappingProvider; mappingCatalog: MappingCatalog;
  sitemapProvider: SitemapProvider; sitemapperMappingCatalog: MappingAssignmentCatalog;
  initialization: { initialize(): Promise<ProviderIntegrationOutcome>; retry(): Promise<ProviderIntegrationOutcome>; startFresh(): Promise<ProviderIntegrationOutcome> };
  getCurrentSiteProject(): Promise<SiteProjectSnapshotOutcome>;
}
export interface ProductionProviderIntegrationOptions { project?: SiteProject | null; compositionIdbFactory?: IDBFactory | null; contentIdbFactory?: IDBFactory | null; mappingIdbFactory?: IDBFactory | null; sitemapIdbFactory?: IDBFactory | null }

/** Compatibility fixture retained for focused renderer tests; production seeding uses SiteProject records. */
export function createProductionSampleDocument(): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "zudo-composer-sample", name: "Product overview", root: [{ id: "sample-container", componentId: "ui.container", componentVersion: 1, props: {}, slots: { content: [
    { id: "sample-heading", componentId: "ui.section-heading", componentVersion: 1, props: { eyebrow: "Product", heading: "Build a clear product story", intro: "Compose responsive sections with the real UI provider.", as: "h1" }, slots: {} },
    { id: "sample-prose", componentId: "ui.prose-md", componentVersion: 1, props: { markdown: "## A real provider composition\n\nEdit this **markdown** and keep the component contract explicit.\n\n```ts\nconst ready = true;\n```" }, slots: {} },
    { id: "sample-split", componentId: "ui.split-layout", componentVersion: 1, props: { ratio: "40/60", gap: "md" }, slots: { left: [{ id: "sample-card", componentId: "ui.card", componentVersion: 1, props: { title: "Visual foundation", variant: "accent", padding: "md" }, slots: { body: [{ id: "sample-placeholder", componentId: "ui.placeholder-box", componentVersion: 1, props: { label: "product-preview.png", aspect: "4/3", size: "md" }, slots: {} }] } }], right: [{ id: "sample-cta", componentId: "ui.cta-button", componentVersion: 1, props: { href: "/products", variant: "primary", arrow: true, children: "Browse products" }, slots: {} }, { id: "sample-grid", componentId: "ui.auto-grid", componentVersion: 1, props: { min: "15rem", fill: false, gap: "md" }, slots: { items: [] } }] } },
  ] } }] };
}
export const PRODUCTION_SEED_IDS = { composition: "product-overview", contentModel: "news-collection", titleField: "news-title", bodyField: "news-body", publishedField: "news-published", entries: ["news-entry-welcome", "news-entry-mapping"] as const, mapping: "news-product-overview", headingBinding: "news-heading-binding", proseBinding: "news-prose-binding" } as const;
export const PRODUCTION_SEED_TIMESTAMP = "2026-08-29T00:00:00.000Z";
export function createProductionComposerProviders(idbFactory?: IDBFactory | null): readonly CompositionProvider[] {
  const project = activate(injectedSiteProject).project;
  const providers: CompositionProvider[] = [createIndexedDbCompositionProvider({ seed: project?.providers.compositions.find(({ id }) => id === "indexeddb")?.records ?? [], ...(idbFactory === undefined ? {} : { idbFactory }) })];
  const files = createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog }); if (files) providers.push(providerFromStore(files)); return providers;
}
export function createInitializedCompositionCatalog(providers: readonly CompositionProvider[]): CompositionCatalog {
  const catalog = createCompositionCatalog(providers); const ready = new Map<CompositionProvider, Promise<CompositionInitializationOutcome>>();
  const initialize = () => Promise.allSettled(providers.map((provider) => {
    const prior = ready.get(provider); if (prior) return prior;
    const pending = provider.initialization.initialize().then((outcome) => { if (outcome.status !== "ready") ready.delete(provider); return outcome; }, (error: unknown) => { ready.delete(provider); throw error; });
    ready.set(provider, pending); return pending;
  }));
  return { listCompositions: async () => { await initialize(); return catalog.listCompositions(); }, resolveComposition: async (ref) => { await initialize(); return catalog.resolveComposition(ref); } };
}

export function createProductionProviderIntegration(options: ProductionProviderIntegrationOptions = {}): ProductionProviderIntegration {
  const activated = activate(options.project === undefined ? injectedSiteProject : options.project);
  const project = activated.project;
  const compositionSeed = project?.providers.compositions.find(({ id }) => id === "indexeddb")?.records ?? [];
  const contentSeed = project?.providers.content.find(({ id }) => id === "content-indexeddb");
  const mappingSeed = project?.providers.mappings.find(({ id }) => id === "mapping-indexeddb")?.records ?? [];
  const sitemapSeed = project?.providers.sitemaps.find(({ id }) => id === "sitemap-indexeddb")?.records ?? [];
  const idb = <T>(value: T | undefined, key: string): Record<string, T> => value === undefined ? {} : { [key]: value };

  const baseComposition = createIndexedDbCompositionProvider({ seed: compositionSeed, ...idb(options.compositionIdbFactory, "idbFactory") });
  const baseCompositions: CompositionProvider[] = [baseComposition];
  const fileStore = createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog });
  if (fileStore) baseCompositions.push(providerFromStore(fileStore));
  const baseContent = createIndexedDbContentProvider({ seed: { models: contentSeed?.models ?? [], entries: contentSeed?.entries ?? [] }, ...idb(options.contentIdbFactory, "idbFactory") });
  const baseMapping = createIndexedDbMappingProvider({ seed: { mappings: mappingSeed }, ...idb(options.mappingIdbFactory, "idbFactory") });
  const baseSitemap = createIndexedDbSitemapProvider({ seed: sitemapSeed, ...idb(options.sitemapIdbFactory, "idbFactory") });

  const byDomain = {
    compositions: new Map(baseCompositions.map((provider) => [provider.descriptor.id, provider])),
    content: new Map([[baseContent.descriptor.id, baseContent]]),
    mappings: new Map([[baseMapping.descriptor.id, baseMapping]]),
    sitemaps: new Map([[baseSitemap.descriptor.id, baseSitemap]]),
  };

  const verifyRegistry = (): void => {
    if (!project) throw activated.error!;
    for (const domain of ["compositions", "content", "mappings", "sitemaps"] as const) for (const declared of project.providers[domain]) {
      const browserId = browserProviderIdFor(domain, declared.id as never);
      const provider = byDomain[domain].get(browserId as never) as { descriptor?: { id?: string } } | undefined;
      if (!provider?.descriptor?.id || !matches(domain, declared.id, provider.descriptor.id)) throw new ProviderIntegrationError("source", `SiteProject ${domain} provider "${declared.id}" does not match an available browser provider.`, false);
    }
  };

  const verifyMappingRefs = async (records: readonly MappingRecord[] = mappingSeed): Promise<void> => {
    if (!isCompositionCollectionStore(baseComposition.store)) throw new ProviderIntegrationError("composition", "Composition provider lacks atomic collection support.");
    const compositions = await baseComposition.store.readAll();
    const content = await (baseContent.store as unknown as ContentSnapshotStore).readAll();
    const compositionIds = new Set(compositions.map(({ id }) => id)); const modelIds = new Set(content.models.map(({ id }) => id));
    for (const record of records) {
      if (!matches("compositions", record.document.composition.providerId, baseComposition.descriptor.id) || !compositionIds.has(record.document.composition.recordId)) throw new ProviderIntegrationError("mapping", `Mapping "${record.id}" references an unavailable Composition.`);
      if (!matches("content", record.document.contentModel.providerId, baseContent.descriptor.id) || !modelIds.has(record.document.contentModel.recordId)) throw new ProviderIntegrationError("mapping", `Mapping "${record.id}" references an unavailable Content model.`);
    }
  };

  const verifySitemapRefs = async (): Promise<void> => {
    const mappings = await (baseMapping.store as unknown as MappingSnapshotStore).readAll(); const mappingIds = new Set(mappings.map(({ id }) => id));
    for (const sitemap of sitemapSeed) {
      const visit = (nodes: typeof sitemap.document.root): void => { for (const node of nodes) { if (node.source.kind === "mapping" && (!matches("mappings", node.source.ref.providerId, baseMapping.descriptor.id) || !mappingIds.has(node.source.ref.recordId))) throw new ProviderIntegrationError("sitemap", `Sitemap "${sitemap.id}" references an unavailable Mapping.`); visit(node.children); } };
      visit(sitemap.document.root);
    }
  };

  const snapshotNow = async (): Promise<SiteProject> => {
    if (!project) throw activated.error!;
    const next = structuredClone(project);
    for (const declared of next.providers.compositions) {
      const provider = byDomain.compositions.get(browserProviderIdFor("compositions", declared.id) as "indexeddb" | "files");
      if (!provider) throw new ProviderIntegrationError("snapshot", `Composition provider "${declared.id}" is unavailable.`);
      if (isCompositionCollectionStore(provider.store)) declared.records = [...await provider.store.readAll()];
      else { const summaries = await provider.store.list(); declared.records = await Promise.all(summaries.map(async ({ id }) => { const loaded = await provider.store.get(id); if (loaded.status !== "loaded") throw new ProviderIntegrationError("snapshot", `Composition "${id}" could not be loaded coherently.`); return loaded.record; })); }
    }
    for (const declared of next.providers.content) { const provider = byDomain.content.get(browserProviderIdFor("content", declared.id) as "content-indexeddb"); if (!provider || !("readAll" in provider.store)) throw new ProviderIntegrationError("snapshot", `Content provider "${declared.id}" lacks atomic snapshot support.`); const records = await (provider.store as unknown as ContentSnapshotStore).readAll(); declared.models = [...records.models]; declared.entries = [...records.entries]; }
    for (const declared of next.providers.mappings) { const provider = byDomain.mappings.get(browserProviderIdFor("mappings", declared.id) as "mapping-indexeddb"); if (!provider || !("readAll" in provider.store)) throw new ProviderIntegrationError("snapshot", `Mapping provider "${declared.id}" lacks atomic snapshot support.`); declared.records = [...await (provider.store as unknown as MappingSnapshotStore).readAll()]; }
    for (const declared of next.providers.sitemaps) { const provider = byDomain.sitemaps.get(browserProviderIdFor("sitemaps", declared.id) as "sitemap-indexeddb"); if (!provider || !isSitemapCollectionStore(provider.store)) throw new ProviderIntegrationError("snapshot", `Sitemap provider "${declared.id}" lacks atomic snapshot support.`); declared.records = [...await provider.store.readAll()]; }
    const result = validateSiteProject(next, activeSiteProjectValidationContext);
    if (!result.ok) throw new ProviderIntegrationError("snapshot", `Provider snapshot is not coherent: ${result.diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
    return canonicalizeSiteProject(result.project);
  };

  let freshPending = false; let active: { kind: string; promise: Promise<ProviderIntegrationOutcome> } | undefined; let tail: Promise<unknown> = Promise.resolve();
  const perform = async (kind: "initialize" | "retry" | "startFresh"): Promise<ProviderIntegrationOutcome> => {
    try {
      verifyRegistry(); const action = kind === "startFresh" || freshPending ? "startFresh" : kind; if (action === "startFresh") freshPending = true;
      for (const provider of baseCompositions) assertReady("composition", await provider.initialization[action]());
      assertReady("content", await baseContent.initialization[action]()); await verifyMappingRefs();
      assertReady("mapping", await baseMapping.initialization[action]());
      await verifyMappingRefs(await (baseMapping.store as unknown as MappingSnapshotStore).readAll());
      await verifySitemapRefs();
      assertReady("sitemap", await baseSitemap.initialization[action]()); await snapshotNow(); freshPending = false; return { status: "ready" };
    } catch (cause) { return { status: "error", error: cause instanceof ProviderIntegrationError ? cause : new ProviderIntegrationError("snapshot", cause instanceof Error ? cause.message : "Provider integration failed.", true, { cause }) }; }
  };
  const schedule = (kind: "initialize" | "retry" | "startFresh"): Promise<ProviderIntegrationOutcome> => {
    if (active?.kind === kind) return active.promise;
    const promise = tail.then(() => perform(kind), () => perform(kind)); active = { kind, promise }; tail = promise.finally(() => { if (active?.promise === promise) active = undefined; }); return promise;
  };
  const lifecycle = { initialize: () => schedule("initialize"), retry: () => schedule("retry"), startFresh: () => schedule("startFresh") };

  const wrapComposition = (provider: CompositionProvider): CompositionProvider => ({ ...provider, initialization: {
    initialize: () => compositionOutcome(lifecycle.initialize(), provider), retry: () => compositionOutcome(lifecycle.retry(), provider), startFresh: () => compositionOutcome(lifecycle.startFresh(), provider),
  } });
  const compositionOutcome = async (pending: Promise<ProviderIntegrationOutcome>, provider: CompositionProvider): Promise<CompositionInitializationOutcome> => { const result = await pending; return result.status === "ready" ? { status: "ready", summaries: await provider.store.list() } : { status: "error", error: new CompositionPersistenceError("initialize", "unknown", result.error.message, result.error.retryable, { cause: result.error }) }; };
  const compositionProviders = baseCompositions.map(wrapComposition);
  const contentOutcome = async (pending: Promise<ProviderIntegrationOutcome>): Promise<ContentInitializationOutcome> => { const result = await pending; return result.status === "ready" ? { status: "ready", models: await baseContent.store.listModels() } : { status: "error", error: new ContentPersistenceError("initialize", "unknown", result.error.message, result.error.retryable, { cause: result.error }) }; };
  const contentProvider: ContentProvider = { ...baseContent, initialization: { initialize: () => contentOutcome(lifecycle.initialize()), retry: () => contentOutcome(lifecycle.retry()), startFresh: () => contentOutcome(lifecycle.startFresh()) } };
  const mappingOutcome = async (pending: Promise<ProviderIntegrationOutcome>): Promise<MappingInitializationOutcome> => { const result = await pending; return result.status === "ready" ? { status: "ready", summaries: await baseMapping.store.list() } : { status: "error", error: new MappingPersistenceError("initialize", "unknown", result.error.message, result.error.retryable, { cause: result.error }) }; };
  const mappingProvider: MappingProvider = { ...baseMapping, initialization: { initialize: () => mappingOutcome(lifecycle.initialize()), retry: () => mappingOutcome(lifecycle.retry()), startFresh: () => mappingOutcome(lifecycle.startFresh()) } };
  const sitemapOutcome = async (pending: Promise<ProviderIntegrationOutcome>): Promise<SitemapInitializationOutcome> => { const result = await pending; return result.status === "ready" ? { status: "ready", summaries: await baseSitemap.store.list() } : { status: "error", error: new SitemapPersistenceError("initialize", "unknown", result.error.message, result.error.retryable, { cause: result.error }) }; };
  const sitemapProvider: SitemapProvider = { ...baseSitemap, initialization: { initialize: () => sitemapOutcome(lifecycle.initialize()), retry: () => sitemapOutcome(lifecycle.retry()), startFresh: () => sitemapOutcome(lifecycle.startFresh()) } };

  const contentProviders = [contentProvider] as const; const mappingProviders = [mappingProvider] as const;
  const rawContentCatalog = createContentCatalog(contentProviders); const contentCatalog: ContentCatalog = { listModels: async () => { await lifecycle.initialize(); return rawContentCatalog.listModels(); }, resolveModel: async (ref) => { await lifecycle.initialize(); return rawContentCatalog.resolveModel(ref); } };
  const rawCompositionCatalog = createMappingCompositionCatalog(compositionProviders); const mappingCompositionCatalog: MappingCompositionCatalog = { list: async () => { await lifecycle.initialize(); return rawCompositionCatalog.list(); }, resolve: async (ref) => { await lifecycle.initialize(); return rawCompositionCatalog.resolve(ref); } };
  const mappingContentEntries: MappingContentEntryCatalog = {
    async scan(ref) { if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` }; const initialized = await lifecycle.initialize(); if (initialized.status !== "ready") return { status: "provider-error", reason: initialized.error.message }; try { return { status: "resolved", snapshot: await contentProvider.store.scanEntries(ref.recordId) }; } catch (error) { return { status: "provider-error", reason: error instanceof Error ? error.message : "Content snapshot failed." }; } },
    async get(ref, id) { if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` }; const initialized = await lifecycle.initialize(); if (initialized.status !== "ready") return { status: "provider-error", reason: initialized.error.message }; const result = await contentProvider.store.getEntry(id); if (result.status === "loaded") return result.record.modelId === ref.recordId ? { status: "resolved", entry: result.record } : { status: "not-found" }; if (result.status === "not-found") return { status: "not-found" }; return { status: "invalid", reason: result.status === "invalid" ? result.issue.message : `Entry uses unsupported schema version ${result.foundSchemaVersion}.` }; },
  };
  const mappingCatalog = createMappingCatalog(mappingProviders);
  const sitemapperMappingCatalog = createMappingAssignmentCatalog(mappingProviders, contentProviders, async (mapping) => { const definition = await resolveMappingDefinition(mapping, { content: contentCatalog, compositions: mappingCompositionCatalog }, activeComponentProvider.catalog); return definition.status === "ready" ? { status: "ready" } : { status: "blocked", diagnostics: definition.diagnostics.map(({ code, message }) => ({ code, message })) }; });
  const preview = () => createContentPreviewSource({ mappings: mappingCatalog, catalogs: { content: contentCatalog, compositions: mappingCompositionCatalog }, manifest: activeComponentProvider.catalog, initializeContent: async () => { const result = await lifecycle.initialize(); return result.status === "ready" ? { status: "ready" } : { status: "error", reason: result.error.message }; }, initializeMappings: async () => { const result = await lifecycle.initialize(); return result.status === "ready" ? { status: "ready" } : { status: "error", reason: result.error.message }; } });

  return Object.freeze({ componentProvider: activeComponentProvider, compositionProviders, compositionCatalog: createInitializedCompositionCatalog(compositionProviders), mappingCompositionCatalog, contentProviders, contentProvider, contentCatalog, createContentPreviewSource: preview, mappingContentEntries, mappingProviders, mappingProvider, mappingCatalog, sitemapProvider, sitemapperMappingCatalog, initialization: lifecycle,
    // IndexedDB cannot transact across four databases. Each provider read is atomic; the serialized lifecycle gate and final aggregate validation reject cross-database partial mixes.
    getCurrentSiteProject: async (): Promise<SiteProjectSnapshotOutcome> => { const ready = await lifecycle.initialize(); if (ready.status !== "ready") return ready; const result = tail.then(async () => ({ status: "ready" as const, project: await snapshotNow() })).catch((cause: unknown) => ({ status: "error" as const, error: cause instanceof ProviderIntegrationError ? cause : new ProviderIntegrationError("snapshot", cause instanceof Error ? cause.message : "Snapshot failed.", true, { cause }) })); tail = result; return result; },
  });
}
