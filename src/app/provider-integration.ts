import {
  COMPOSITION_PROVIDERS, COMPOSITION_SCHEMA_VERSION, CompositionPersistenceError,
  createFileProviderCompositionStore, createIndexedDbCompositionProvider,
  type CompositionDocument, type CompositionInitializationOutcome, type CompositionProvider, type CompositionStore,
} from "../composer/browser";
import { createContentCatalog, type ContentCatalog } from "../content/catalog";
import { ContentPersistenceError, createContentEntryRecord, createContentModelRecord, type ContentInitializationOutcome, type ContentProvider } from "../content/library";
import { createIndexedDbContentProvider } from "../content/storage/indexeddb";
import { activeComponentProvider } from "../features/composer/active-pack";
import { createContentPreviewSource, type ContentPreviewSource } from "../features/content/preview-source";
import type { MediaProvider } from "../media";
import type { MappingContentEntryCatalog } from "../features/mapping";
import {
  createCompositionCatalog as createMappingCompositionCatalog, createIndexedDbMappingProvider,
  createMappingCatalog, createMappingRecord, MappingPersistenceError, resolveMappingDefinition, type CompositionCatalog as MappingCompositionCatalog,
  type MappingCatalog, type MappingInitializationOutcome, type MappingProvider,
} from "../mapping";
import { createCompositionCatalog, createMappingAssignmentCatalog, type CompositionCatalog } from "../sitemapper/catalog";
import type { MappingAssignmentCatalog } from "../sitemapper/routes";

export const PRODUCTION_SEED_IDS = {
  composition: "product-overview", contentModel: "news-collection",
  titleField: "news-title", bodyField: "news-body", publishedField: "news-published",
  entries: ["news-entry-welcome", "news-entry-mapping"] as const,
  mapping: "news-product-overview", headingBinding: "news-heading-binding", proseBinding: "news-prose-binding",
} as const;
export const PRODUCTION_SEED_TIMESTAMP = "2026-08-29T00:00:00.000Z";

function initializeUntilReady<T extends { status: string }>(initialize: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null;
  return () => {
    current ??= initialize().then((outcome) => {
      if (outcome.status !== "ready") current = null;
      return outcome;
    }, (error: unknown) => {
      current = null;
      throw error;
    });
    return current;
  };
}

export function createProductionSampleDocument(): CompositionDocument {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "zudo-composer-sample", name: "Product overview",
    root: [{ id: "sample-container", componentId: "ui.container", componentVersion: 1, props: {}, slots: { content: [
      { id: "sample-heading", componentId: "ui.section-heading", componentVersion: 1, props: { eyebrow: "Product", heading: "Build a clear product story", intro: "Compose responsive sections with the real UI provider.", as: "h1" }, slots: {} },
      { id: "sample-prose", componentId: "ui.prose-md", componentVersion: 1, props: { markdown: "## A real provider composition\n\nEdit this **markdown** and keep the component contract explicit.\n\n```ts\nconst ready = true;\n```" }, slots: {} },
      { id: "sample-split", componentId: "ui.split-layout", componentVersion: 1, props: { ratio: "40/60", gap: "md" }, slots: {
        left: [{ id: "sample-card", componentId: "ui.card", componentVersion: 1, props: { title: "Visual foundation", variant: "accent", padding: "md" }, slots: { body: [{ id: "sample-placeholder", componentId: "ui.placeholder-box", componentVersion: 1, props: { label: "product-preview.png", aspect: "4/3", size: "md" }, slots: {} }] } }],
        right: [{ id: "sample-cta", componentId: "ui.cta-button", componentVersion: 1, props: { href: "/products", variant: "primary", arrow: true, children: "Browse products" }, slots: {} }, { id: "sample-grid", componentId: "ui.auto-grid", componentVersion: 1, props: { min: "15rem", fill: false, gap: "md" }, slots: { items: [] } }],
      } },
    ] } }],
  };
}

export function createProductionContentSeed() {
  const model = createContentModelRecord({ name: "News Collection", kind: "collection", fields: [
    { id: PRODUCTION_SEED_IDS.titleField, key: "title", label: "Title", required: true, kind: "text" },
    { id: PRODUCTION_SEED_IDS.bodyField, key: "body", label: "Body", required: true, kind: "markdown" },
    { id: PRODUCTION_SEED_IDS.publishedField, key: "published", label: "Published", required: false, kind: "boolean" },
  ] }, { id: PRODUCTION_SEED_IDS.contentModel, timestamp: PRODUCTION_SEED_TIMESTAMP });
  return { models: [model], entries: [
    createContentEntryRecord(model.id, { [PRODUCTION_SEED_IDS.titleField]: "Welcome to the newsroom", [PRODUCTION_SEED_IDS.bodyField]: "## Product news\n\nContent values can drive real provider components.", [PRODUCTION_SEED_IDS.publishedField]: true }, { id: PRODUCTION_SEED_IDS.entries[0], timestamp: PRODUCTION_SEED_TIMESTAMP }),
    createContentEntryRecord(model.id, { [PRODUCTION_SEED_IDS.titleField]: "Mapping is ready", [PRODUCTION_SEED_IDS.bodyField]: "## Connected authoring\n\nMap a News Entry into the Product overview Composition.", [PRODUCTION_SEED_IDS.publishedField]: true }, { id: PRODUCTION_SEED_IDS.entries[1], timestamp: "2026-08-29T00:00:01.000Z" }),
  ] };
}

function initializationError(reason: unknown): CompositionInitializationOutcome {
  return { status: "error", error: reason instanceof CompositionPersistenceError ? reason : new CompositionPersistenceError("initialize", "unknown", reason instanceof Error ? reason.message : "Composition storage initialization failed.", true, { cause: reason }) };
}
function providerFromStore(store: CompositionStore): CompositionProvider {
  const initialize = async (): Promise<CompositionInitializationOutcome> => { try { return { status: "ready", summaries: await store.list() }; } catch (reason) { return initializationError(reason); } };
  return { descriptor: store.provider, store, initialization: { initialize, retry: initialize, startFresh: initialize } };
}
export function createProductionComposerProviders(idbFactory?: IDBFactory | null): readonly CompositionProvider[] {
  const providers: CompositionProvider[] = [createIndexedDbCompositionProvider({ initialDocument: createProductionSampleDocument, idFactory: () => PRODUCTION_SEED_IDS.composition, now: () => PRODUCTION_SEED_TIMESTAMP, ...(idbFactory === undefined ? {} : { idbFactory }) })];
  const fileStore = createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog });
  if (fileStore) providers.push(providerFromStore(fileStore));
  return providers;
}

export function createInitializedCompositionCatalog(providers: readonly CompositionProvider[], initializers = providers.map((provider) => initializeUntilReady(() => provider.initialization.initialize()))): CompositionCatalog {
  const catalog = createCompositionCatalog(providers);
  const initialize = () => Promise.allSettled(initializers.map((initializer) => initializer()));
  return { listCompositions: async () => { await initialize(); return catalog.listCompositions(); }, resolveComposition: async (ref) => { await initialize(); return catalog.resolveComposition(ref); } };
}

export function createStagedMappingProvider(base: MappingProvider, content: ContentProvider, composition: CompositionProvider, initialization: { content?: () => Promise<ContentInitializationOutcome>; composition?: () => Promise<CompositionInitializationOutcome> } = {}): MappingProvider {
  const seed = { mappings: [createMappingRecord({
    id: PRODUCTION_SEED_IDS.mapping, name: "News to Product overview",
    contentModel: { providerId: content.descriptor.id, recordId: PRODUCTION_SEED_IDS.contentModel },
    composition: { providerId: composition.descriptor.id, recordId: PRODUCTION_SEED_IDS.composition },
    bindings: [
      { id: PRODUCTION_SEED_IDS.headingBinding, sourceFieldId: PRODUCTION_SEED_IDS.titleField, target: { nodeId: "sample-heading", prop: "heading" }, transform: { kind: "identity" } },
      { id: PRODUCTION_SEED_IDS.proseBinding, sourceFieldId: PRODUCTION_SEED_IDS.bodyField, target: { nodeId: "sample-prose", prop: "markdown" }, transform: { kind: "identity" } },
    ], createdAt: PRODUCTION_SEED_TIMESTAMP,
  })] };
  const prerequisites = async () => {
    try {
      const [compositionOutcome, contentOutcome] = await Promise.all([
        initialization.composition?.() ?? composition.initialization.initialize(),
        initialization.content?.() ?? content.initialization.initialize(),
      ]);
      if (compositionOutcome.status !== "ready" || contentOutcome.status !== "ready") return false;
      const [resolvedComposition, resolvedContent] = await Promise.all([composition.store.get(PRODUCTION_SEED_IDS.composition), content.store.getModel(PRODUCTION_SEED_IDS.contentModel)]);
      return resolvedComposition.status === "loaded" && resolvedContent.status === "loaded";
    } catch {
      return false;
    }
  };
  const seedWhenReady = async (outcome: MappingInitializationOutcome): Promise<MappingInitializationOutcome> => {
    if (outcome.status !== "ready") return outcome;
    if (!(await prerequisites())) return { status: "error", error: new MappingPersistenceError("initialize", "unknown", "Mapping seed prerequisites are unavailable. Retry after Content and Composer storage recover.", true) };
    try {
      await base.store.seed(seed);
      return { status: "ready", summaries: await base.store.list() };
    } catch (error) {
      return { status: "error", error: error instanceof MappingPersistenceError ? error : new MappingPersistenceError("seed", "unknown", "Mapping seed could not be written. Retry initialization.", true, { cause: error }) };
    }
  };
  return { descriptor: base.descriptor, store: base.store, initialization: {
    initialize: async () => seedWhenReady(await base.initialization.initialize()),
    retry: async () => seedWhenReady(await base.initialization.retry()),
    startFresh: async () => seedWhenReady(await base.initialization.startFresh()),
  } };
}

export interface ProductionProviderIntegration {
  componentProvider: typeof activeComponentProvider;
  compositionProviders: readonly CompositionProvider[]; compositionCatalog: CompositionCatalog; mappingCompositionCatalog: MappingCompositionCatalog;
  contentProviders: readonly ContentProvider[]; contentProvider: ContentProvider; contentCatalog: ContentCatalog;
  mediaProvider: MediaProvider | undefined;
  createContentPreviewSource(): ContentPreviewSource;
  mappingContentEntries: MappingContentEntryCatalog;
  mappingProviders: readonly MappingProvider[]; mappingProvider: MappingProvider; mappingCatalog: MappingCatalog;
  sitemapperMappingCatalog: MappingAssignmentCatalog;
}
export interface ProductionProviderIntegrationOptions { compositionIdbFactory?: IDBFactory | null; contentIdbFactory?: IDBFactory | null; mappingIdbFactory?: IDBFactory | null }
export function createProductionProviderIntegration(options: ProductionProviderIntegrationOptions = {}): ProductionProviderIntegration {
  const compositionProviders = createProductionComposerProviders(options.compositionIdbFactory);
  const browserComposition = compositionProviders.find(({ descriptor }) => descriptor.id === COMPOSITION_PROVIDERS.indexeddb.id)!;
  const compositionInitializers = compositionProviders.map((provider) => initializeUntilReady(() => provider.initialization.initialize()));
  const browserCompositionIndex = compositionProviders.indexOf(browserComposition);
  const contentProvider = createIndexedDbContentProvider({ seed: createProductionContentSeed(), ...(options.contentIdbFactory === undefined ? {} : { idbFactory: options.contentIdbFactory }) });
  const contentProviders = [contentProvider] as const;
  const initializeContent = initializeUntilReady(() => contentProvider.initialization.initialize());
  const mappingProvider = createStagedMappingProvider(createIndexedDbMappingProvider(options.mappingIdbFactory === undefined ? {} : { idbFactory: options.mappingIdbFactory }), contentProvider, browserComposition, { content: initializeContent, composition: compositionInitializers[browserCompositionIndex] });
  const mappingProviders = [mappingProvider] as const;
  const initializeMapping = initializeUntilReady(() => mappingProvider.initialization.initialize());
  const baseContentCatalog = createContentCatalog(contentProviders);
  const contentCatalog: ContentCatalog = {
    listModels: async () => { await initializeContent(); return baseContentCatalog.listModels(); },
    resolveModel: async (ref) => { await initializeContent(); return baseContentCatalog.resolveModel(ref); },
  };
  const mappingContentEntries: MappingContentEntryCatalog = {
    async scan(ref) {
      if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` };
      const initialization = await initializeContent();
      if (initialization.status !== "ready") return { status: "provider-error", reason: initialization.status === "error" ? initialization.error.message : initialization.recovery.message };
      try { return { status: "resolved", snapshot: await contentProvider.store.scanEntries(ref.recordId) }; }
      catch (error) {
        if (error instanceof ContentPersistenceError && error.code === "not-found") return { status: "not-found" };
        if (error instanceof ContentPersistenceError && (error.code === "validation" || error.code === "unsupported-version")) return { status: "invalid", reason: error.message };
        return { status: "provider-error", reason: error instanceof Error ? error.message : "Content snapshot could not be loaded." };
      }
    },
    async get(ref, entryId) {
      if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` };
      const initialization = await initializeContent();
      if (initialization.status !== "ready") return { status: "provider-error", reason: initialization.status === "error" ? initialization.error.message : initialization.recovery.message };
      try {
        const outcome = await contentProvider.store.getEntry(entryId);
        if (outcome.status === "loaded") return outcome.record.modelId === ref.recordId ? { status: "resolved", entry: outcome.record } : { status: "not-found" };
        if (outcome.status === "not-found") return { status: "not-found" };
        return { status: "invalid", reason: outcome.status === "invalid" ? outcome.issue.message : `Entry uses unsupported schema version ${outcome.foundSchemaVersion}.` };
      } catch (error) { return { status: "provider-error", reason: error instanceof Error ? error.message : "Content Entry could not be loaded." }; }
    },
  };
  const baseMappingCompositionCatalog = createMappingCompositionCatalog(compositionProviders);
  const initializeCompositions = () => Promise.allSettled(compositionInitializers.map((initializer) => initializer()));
  const mappingCompositionCatalog: MappingCompositionCatalog = {
    list: async () => { await initializeCompositions(); return baseMappingCompositionCatalog.list(); },
    resolve: async (ref) => { await initializeCompositions(); return baseMappingCompositionCatalog.resolve(ref); },
  };
  const sitemapperMappingCatalog = createMappingAssignmentCatalog([{
    descriptor: mappingProvider.descriptor,
    store: {
      list: async () => {
        const outcome = await initializeMapping();
        if (outcome.status !== "ready") throw outcome.status === "error" ? outcome.error : new Error("Mapping storage requires recovery.");
        return mappingProvider.store.list();
      },
      get: async (id) => {
        const outcome = await initializeMapping();
        if (outcome.status !== "ready") throw outcome.status === "error" ? outcome.error : new Error("Mapping storage requires recovery.");
        return mappingProvider.store.get(id);
      },
    },
  }], [{
    descriptor: contentProvider.descriptor,
    store: {
      scanEntries: async (modelId) => {
        const outcome = await initializeContent();
        if (outcome.status !== "ready") throw outcome.status === "error" ? outcome.error : new Error("Content storage requires recovery.");
        return contentProvider.store.scanEntries(modelId);
      },
    },
  }], async (mapping) => {
    const definition = await resolveMappingDefinition(mapping, { content: contentCatalog, compositions: mappingCompositionCatalog }, activeComponentProvider.catalog);
    return definition.status === "ready"
      ? { status: "ready" }
      : { status: "blocked", diagnostics: definition.diagnostics.map(({ code, message }) => ({ code, message })) };
  });
  const mappingCatalog = createMappingCatalog(mappingProviders);
  const contentPreviewSource = () => createContentPreviewSource({
    mappings: mappingCatalog,
    catalogs: { content: contentCatalog, compositions: mappingCompositionCatalog },
    manifest: activeComponentProvider.catalog,
    initializeContent: async () => {
      const outcome = await initializeContent();
      return outcome.status === "ready"
        ? { status: "ready" }
        : { status: "error", reason: outcome.status === "error" ? outcome.error.message : outcome.recovery.message };
    },
    initializeMappings: async () => {
      const outcome = await initializeMapping();
      return outcome.status === "ready"
        ? { status: "ready" }
        : { status: "error", reason: outcome.status === "error" ? outcome.error.message : outcome.recovery.message };
    },
  });
  return Object.freeze({
    componentProvider: activeComponentProvider, compositionProviders,
    compositionCatalog: createInitializedCompositionCatalog(compositionProviders, compositionInitializers),
    mappingCompositionCatalog,
    contentProviders, contentProvider, contentCatalog, createContentPreviewSource: contentPreviewSource, mappingContentEntries,
    mappingProviders, mappingProvider, mappingCatalog, sitemapperMappingCatalog, mediaProvider: undefined,
  });
}
