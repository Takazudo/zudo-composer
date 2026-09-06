import injectedSiteProject, { siteProjectRevision as injectedSiteProjectRevision } from "virtual:site-project-source";
import { COMPOSITION_SCHEMA_VERSION, CompositionPersistenceError, createFileProviderCompositionStore, createIndexedDbCompositionProvider, diagnoseDocument, isCompositionCollectionStore, type CompositionDocument, type CompositionInitializationOutcome, type CompositionProvider, type CompositionStore } from "../composer/browser";
import { createContentCatalog, type ContentCatalog } from "../content/catalog";
import { ContentPersistenceError, type ContentInitializationOutcome, type ContentProvider } from "../content/library";
import { createIndexedDbContentProvider } from "../content/storage/indexeddb";
import { activeComponentProvider } from "../features/composer/active-pack";
import { createContentPreviewSource, type ContentPreviewSource } from "../features/content/preview-source";
import { createFileProviderMediaProvider, type MediaFileProvider } from "../media";
import type { MappingContentEntryCatalog } from "../features/mapping";
import type { MappingAttachmentCallbacks } from "../features/mapping/attachments";
import { createCompositionCatalog as createMappingCompositionCatalog, createIndexedDbMappingProvider, createMappingCatalog, MappingPersistenceError, resolveMappingDefinition, type CompositionCatalog as MappingCompositionCatalog, type MappingCatalog, type MappingInitializationOutcome, type MappingProvider, type MappingRecord } from "../mapping";
import { browserProviderIdFor, canonicalizeSiteProject, validateSiteProject, type SiteProject, type SiteProjectDomain } from "../site-project";
import { createCompositionCatalog, createMappingAssignmentCatalog, type CompositionCatalog } from "../sitemapper/catalog";
import { isSitemapCollectionStore, SitemapPersistenceError, type SitemapInitializationOutcome, type SitemapProvider, type SitemapRecord } from "../sitemapper/library";
import type { MappingAssignmentCatalog } from "../sitemapper/routes";
import { createIndexedDbSitemapProvider } from "../sitemapper/storage/indexeddb/provider";
import { activeSiteProjectValidationContext } from "./site-project-manifest";
import { createWorkspaceStorage, projectFromWorkspace, workspaceScopedFactory, workspaceDatabaseName, withWorkspaceInitializationLock, WORKSPACE_DATABASE_NAME, type WorkspaceRecord } from "./workspace-storage";
import { createWorkspaceSaveRegistry, type WorkspaceSaveRegistry } from "./workspace-sessions";
import { captureWorkspaceSnapshot, checkWorkspaceCapture, type WorkspaceCapture, type WorkspaceCaptureOutcome, type WorkspaceSnapshotSource, type WorkspaceToken } from "./workspace-snapshot";
import { subscribePersistenceChanges } from "../shared/persistence-generation";
import { createMappingAttachmentService } from "./mapping-attachment-service";

export class ProviderIntegrationError extends Error {
  readonly name = "ProviderIntegrationError";
  constructor(readonly phase: "source" | "composition" | "content" | "mapping" | "sitemap" | "snapshot", message: string, readonly retryable = true, options?: { cause?: unknown }) { super(message, options); }
}
export class WorkspaceResetRequiredError extends ProviderIntegrationError {
  readonly code = "reset-required";
  constructor() { super("source", "Reset requires workspace.reset(): create a new workspace and switch only after initialization succeeds. The original workspace is preserved.", false); }
}
export type ProviderIntegrationOutcome = { status: "ready" } | { status: "error"; error: ProviderIntegrationError };
export type SiteProjectSnapshotOutcome = { status: "ready"; project: SiteProject } | { status: "error"; error: ProviderIntegrationError };
export type WorkspaceProjectCaptureOutcome = Exclude<WorkspaceCaptureOutcome, { status: "ready" }> | { status: "ready"; capture: WorkspaceCapture; project: SiteProject };

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
  const retryable = outcome.error && "retryable" in outcome.error && typeof outcome.error.retryable === "boolean"
    ? outcome.error.retryable
    : false;
  const recoveryMessage = outcome.recovery?.message
    ? `${outcome.recovery.message} Start fresh is required before initialization can continue.`
    : undefined;
  throw new ProviderIntegrationError(
    phase,
    outcome.error?.message ?? recoveryMessage ?? `${phase} provider requires startFresh recovery.`,
    retryable,
    { cause: outcome.error },
  );
}

function integrationError(phase: ProviderIntegrationError["phase"], cause: unknown, fallback: string): ProviderIntegrationError {
  if (cause instanceof ProviderIntegrationError) return cause;
  const retryable = cause !== null && typeof cause === "object" && "retryable" in cause && typeof cause.retryable === "boolean"
    ? cause.retryable
    : true;
  return new ProviderIntegrationError(phase, cause instanceof Error ? cause.message : fallback, retryable, { cause });
}

function matches(domain: SiteProjectDomain, logicalId: string, browserId: string): boolean {
  try { return browserProviderIdFor(domain, logicalId as never) === browserId; } catch { return false; }
}

function resolveBrowserProviderId(domain: SiteProjectDomain, logicalId: string, phase: ProviderIntegrationError["phase"]): string {
  try {
    const browserId = browserProviderIdFor(domain, logicalId as never);
    if (typeof browserId !== "string") throw new TypeError("Provider is not registered.");
    return browserId;
  } catch (cause) {
    throw new ProviderIntegrationError(phase, `Provider "${logicalId}" is not registered for ${domain}.`, false, { cause });
  }
}

interface ContentSnapshotStore { readAll(): Promise<{ models: SiteProject["providers"]["content"][number]["models"]; entries: SiteProject["providers"]["content"][number]["entries"] }> }
interface MappingSnapshotStore { readAll(): Promise<readonly MappingRecord[]> }

export interface ProductionProviderIntegration {
  workspace: WorkspaceLifecycle;
  sessions: WorkspaceSaveRegistry;
  subscribeChanges(listener: () => void): () => void;
  captureWorkspace(): Promise<WorkspaceProjectCaptureOutcome>;
  isCaptureCurrent(capture: WorkspaceCapture): Promise<boolean>;
  componentProvider: typeof activeComponentProvider;
  compositionProviders: readonly CompositionProvider[]; compositionCatalog: CompositionCatalog; mappingCompositionCatalog: MappingCompositionCatalog;
  contentProviders: readonly ContentProvider[]; contentProvider: ContentProvider; contentCatalog: ContentCatalog;
  mediaProvider: MediaFileProvider | undefined;
  createContentPreviewSource(): ContentPreviewSource;
  mappingContentEntries: MappingContentEntryCatalog; mappingProviders: readonly MappingProvider[]; mappingProvider: MappingProvider; mappingCatalog: MappingCatalog;
  mappingAttachmentService: MappingAttachmentCallbacks;
  sitemapProvider: SitemapProvider; sitemapperMappingCatalog: MappingAssignmentCatalog;
  initialization: { initialize(): Promise<ProviderIntegrationOutcome>; retry(): Promise<ProviderIntegrationOutcome>; startFresh(): Promise<ProviderIntegrationOutcome> };
  getCurrentSiteProject(options?: { flushSessions?: boolean }): Promise<SiteProjectSnapshotOutcome>;
}
export interface WorkspaceLifecycle {
  readonly id: string | undefined;
  metadata(options?: { ensureReady?: boolean }): Promise<WorkspaceRecord>;
  updateMetadata(expectedToken: number, patch: { name?: string; activeSitemap?: SiteProject["activeSitemap"]; collectionAttachments?: readonly SiteProject["collectionAttachments"][number][] }): Promise<WorkspaceRecord>;
  reconcileBaseline(capture: WorkspaceCapture, revision: string): Promise<"applied" | "changed">;
  open(id: string): Promise<ProductionProviderIntegration>;
  create(project: SiteProject, baselineRevision: string): Promise<ProductionProviderIntegration>;
  loadExample(project: SiteProject, baselineRevision: string): Promise<ProductionProviderIntegration>;
  reset(): Promise<ProductionProviderIntegration>;
}
interface ProductionProviderIntegrationCommonOptions { workspaceId?: string; saveRegistry?: WorkspaceSaveRegistry; mediaProvider?: MediaFileProvider | null; compositionIdbFactory?: IDBFactory | null; contentIdbFactory?: IDBFactory | null; mappingIdbFactory?: IDBFactory | null; sitemapIdbFactory?: IDBFactory | null; fileCompositionProvider?: CompositionProvider | null }
export type ProductionProviderIntegrationOptions = ProductionProviderIntegrationCommonOptions & (
  | { project?: undefined; sourceRevision?: undefined }
  | { project: null; sourceRevision?: null | undefined }
  | { project: SiteProject; sourceRevision: string }
);

const SOURCE_REVISION = /^[a-f0-9]{64}$/;

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
  const providers: CompositionProvider[] = [];
  if (project?.providers.compositions.some(({ id }) => id === "indexeddb")) providers.push(createIndexedDbCompositionProvider({ seed: project.providers.compositions.find(({ id }) => id === "indexeddb")?.records ?? [], ...(idbFactory === undefined ? {} : { idbFactory }) }));
  const files = createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog });
  if (files && project?.providers.compositions.some(({ id }) => id === "files")) providers.push(providerFromStore(files));
  return providers;
}
export function createInitializedCompositionCatalog(providers: readonly CompositionProvider[]): CompositionCatalog {
  const catalog = createCompositionCatalog(providers); const ready = new Map<CompositionProvider, Promise<CompositionInitializationOutcome>>();
  const initialize = async () => {
    const results = await Promise.allSettled(providers.map((provider) => {
    const prior = ready.get(provider); if (prior) return prior;
    const pending = provider.initialization.initialize().then((outcome) => { if (outcome.status !== "ready") ready.delete(provider); return outcome; }, (error: unknown) => { ready.delete(provider); throw error; });
    ready.set(provider, pending); return pending;
    }));
    return results.flatMap((result, index) => {
      const provider = providers[index]!;
      if (result.status === "rejected") return [{ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: result.reason instanceof Error ? result.reason.message : "Composition initialization failed." }];
      if (result.value.status === "ready") return [];
      return [{ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: result.value.status === "error" ? result.value.error.message : result.value.recovery.message }];
    });
  };
  return {
    listCompositions: async () => { const failures = await initialize(); return failures.length ? { entries: [], failures } : catalog.listCompositions(); },
    resolveComposition: async (ref) => (await initialize()).length ? { status: "provider-unavailable" } : catalog.resolveComposition(ref),
  };
}

export function createProductionProviderIntegration(options: ProductionProviderIntegrationOptions = {}): ProductionProviderIntegration {
  const mediaProvider = options.mediaProvider === undefined ? createFileProviderMediaProvider() : options.mediaProvider ?? undefined;
  const usesInjectedSource = options.project === undefined;
  const activated = activate(usesInjectedSource ? injectedSiteProject : options.project);
  let project = activated.project;
  const revisionInput = usesInjectedSource ? injectedSiteProjectRevision : options.sourceRevision;
  let sourceRevision: string | undefined;
  if (project && revisionInput !== undefined && revisionInput !== null) {
    if (!SOURCE_REVISION.test(revisionInput)) {
      project = undefined;
      activated.error = new ProviderIntegrationError("source", "The active SiteProject revision is not a canonical SHA-256 value.", false);
    } else sourceRevision = revisionInput;
  } else if (project) {
    project = undefined;
    activated.error = new ProviderIntegrationError("source", "The active SiteProject source is missing its canonical revision.", false);
  }
  const initialProject = project;
  const initialRevision = sourceRevision;
  const storage = createWorkspaceStorage(options.compositionIdbFactory);
  const sessions = options.saveRegistry ?? createWorkspaceSaveRegistry();
  let workspaceRecord: WorkspaceRecord | undefined;
  let workspaceId = options.workspaceId;
  let mappingSeed: readonly MappingRecord[] = [];
  let sitemapSeed: readonly SitemapRecord[] = [];
  const idb = (value: IDBFactory | null | undefined): { idbFactory?: IDBFactory | null } => {
    return { idbFactory: workspaceScopedFactory(value, () => { if (!workspaceId) throw new Error("Open a workspace before accessing its providers."); return workspaceId; }) };
  };

  const baseComposition = createIndexedDbCompositionProvider({ seed: [], ...idb(options.compositionIdbFactory) });
  const fileStore = options.fileCompositionProvider === undefined
    ? createFileProviderCompositionStore({ catalog: activeComponentProvider.catalog })
    : null;
  const fileProvider = options.fileCompositionProvider ?? (fileStore ? providerFromStore(fileStore) : undefined);
  const compositionCandidates = new Map<string, CompositionProvider>([[baseComposition.descriptor.id, baseComposition]]);
  if (fileProvider?.descriptor.id === "files") compositionCandidates.set(fileProvider.descriptor.id, fileProvider);
  const baseCompositions: CompositionProvider[] = [];
  for (const declared of project?.providers.compositions ?? []) {
    const provider = compositionCandidates.get(browserProviderIdFor("compositions", declared.id));
    if (provider) baseCompositions.push(provider);
  }
  const baseContent = createIndexedDbContentProvider(idb(options.contentIdbFactory));
  const baseMapping = createIndexedDbMappingProvider(idb(options.mappingIdbFactory));
  const baseSitemap = createIndexedDbSitemapProvider(idb(options.sitemapIdbFactory));

  const byDomain = {
    compositions: new Map(baseCompositions.map((provider) => [provider.descriptor.id, provider])),
    content: new Map([[baseContent.descriptor.id, baseContent]]),
    mappings: new Map([[baseMapping.descriptor.id, baseMapping]]),
    sitemaps: new Map([[baseSitemap.descriptor.id, baseSitemap]]),
  };

  const verifyRegistry = (): void => {
    if (!project) throw activated.error!;
    for (const domain of ["content", "mappings", "sitemaps"] as const) {
      if (project.providers[domain].length === 0) {
        throw new ProviderIntegrationError("source", `The browser application requires a declared ${domain} provider.`, false);
      }
    }
    for (const domain of ["compositions", "content", "mappings", "sitemaps"] as const) for (const declared of project.providers[domain]) {
      const browserId = browserProviderIdFor(domain, declared.id as never);
      const provider = byDomain[domain].get(browserId as never) as { descriptor?: { id?: string } } | undefined;
      if (!provider?.descriptor?.id || !matches(domain, declared.id, provider.descriptor.id)) throw new ProviderIntegrationError("source", `SiteProject ${domain} provider "${declared.id}" does not match an available browser provider.`, false);
    }
  };

  const readCompositionRecords = async (provider: CompositionProvider): Promise<readonly import("../composer/browser").CompositionRecord[]> => {
    if (isCompositionCollectionStore(provider.store)) return provider.store.readAll();
    const summaries = await provider.store.list();
    return Promise.all(summaries.map(async ({ id }) => {
      const loaded = await provider.store.get(id);
      if (loaded.status !== "loaded") throw new ProviderIntegrationError("composition", `Composition "${provider.descriptor.id}:${id}" could not be loaded coherently.`);
      return loaded.record;
    }));
  };

  const compositionIdsByProvider = async (): Promise<Map<string, Set<string>>> => {
    const result = new Map<string, Set<string>>();
    for (const provider of baseCompositions) result.set(provider.descriptor.id, new Set((await readCompositionRecords(provider)).map(({ id }) => id)));
    return result;
  };

  const verifyMappingRefs = async (records: readonly MappingRecord[] = mappingSeed): Promise<void> => {
    const compositions = await compositionIdsByProvider();
    const content = await (baseContent.store as unknown as ContentSnapshotStore).readAll();
    const modelIds = new Set(content.models.map(({ id }) => id));
    for (const record of records) {
      const compositionProviderId = resolveBrowserProviderId("compositions", record.document.composition.providerId, "mapping");
      if (!compositions.get(compositionProviderId)?.has(record.document.composition.recordId)) throw new ProviderIntegrationError("mapping", `Mapping "${record.id}" references unavailable Composition "${record.document.composition.providerId}:${record.document.composition.recordId}".`);
      if (!matches("content", record.document.contentModel.providerId, baseContent.descriptor.id) || !modelIds.has(record.document.contentModel.recordId)) throw new ProviderIntegrationError("mapping", `Mapping "${record.id}" references an unavailable Content model.`);
    }
  };

  const verifySitemapRefs = async (action: "initialize" | "retry" | "startFresh"): Promise<void> => {
    const compositions = await compositionIdsByProvider();
    const mappings = await (baseMapping.store as unknown as MappingSnapshotStore).readAll(); const mappingIds = new Set(mappings.map(({ id }) => id));
    let live: readonly SitemapRecord[] = [];
    if (action !== "startFresh") {
      try {
        if (!isSitemapCollectionStore(baseSitemap.store)) throw new ProviderIntegrationError("sitemap", "Sitemap provider lacks atomic collection support.", false);
        live = await baseSitemap.store.readAll();
      } catch (cause) { throw integrationError("sitemap", cause, "Existing Sitemaps could not be preflighted."); }
    }
    const effective = new Map(sitemapSeed.map((record) => [record.id, record]));
    for (const record of live) effective.set(record.id, record);
    for (const sitemap of effective.values()) {
      const visit = (nodes: typeof sitemap.document.root): void => { for (const node of nodes) {
        if (node.source.kind === "composition") {
          const providerId = resolveBrowserProviderId("compositions", node.source.ref.providerId, "sitemap");
          if (!compositions.get(providerId)?.has(node.source.ref.recordId)) throw new ProviderIntegrationError("sitemap", `Sitemap "${sitemap.id}" references unavailable Composition "${node.source.ref.providerId}:${node.source.ref.recordId}".`);
        }
        if (node.source.kind === "mapping" && (!matches("mappings", node.source.ref.providerId, baseMapping.descriptor.id) || !mappingIds.has(node.source.ref.recordId))) throw new ProviderIntegrationError("sitemap", `Sitemap "${sitemap.id}" references unavailable Mapping "${node.source.ref.providerId}:${node.source.ref.recordId}".`);
        visit(node.children);
      } };
      visit(sitemap.document.root);
    }
  };

  const snapshotNow = async (capture?: WorkspaceCapture, allowAttachmentDiagnostics = false): Promise<SiteProject> => {
    if (!project) throw activated.error!;
    const authored = capture?.values.workspace as WorkspaceRecord | undefined ?? await storage.open(workspaceId);
    if (!authored) throw new ProviderIntegrationError("snapshot", "Workspace metadata is unavailable.");
    const next = projectFromWorkspace(authored);
    for (const declared of next.providers.compositions) {
      const provider = byDomain.compositions.get(browserProviderIdFor("compositions", declared.id) as "indexeddb" | "files");
      if (!provider) throw new ProviderIntegrationError("snapshot", `Composition provider "${declared.id}" is unavailable.`);
      if (capture) { declared.records = [...capture.values[`compositions:${declared.id}`] as typeof declared.records]; continue; }
      if (isCompositionCollectionStore(provider.store)) declared.records = [...await provider.store.readAll()];
      else { const summaries = await provider.store.list(); declared.records = await Promise.all(summaries.map(async ({ id }) => { const loaded = await provider.store.get(id); if (loaded.status !== "loaded") throw new ProviderIntegrationError("snapshot", `Composition "${id}" could not be loaded coherently.`); return loaded.record; })); }
    }
    for (const declared of next.providers.content) { const provider = byDomain.content.get(browserProviderIdFor("content", declared.id) as "content-indexeddb"); if (!provider || !("readAll" in provider.store)) throw new ProviderIntegrationError("snapshot", `Content provider "${declared.id}" lacks atomic snapshot support.`); const records = capture ? capture.values[`content:${declared.id}`] as Awaited<ReturnType<ContentSnapshotStore["readAll"]>> : await (provider.store as unknown as ContentSnapshotStore).readAll(); declared.models = [...records.models]; declared.entries = [...records.entries]; }
    for (const declared of next.providers.mappings) { const provider = byDomain.mappings.get(browserProviderIdFor("mappings", declared.id) as "mapping-indexeddb"); if (!provider || !("readAll" in provider.store)) throw new ProviderIntegrationError("snapshot", `Mapping provider "${declared.id}" lacks atomic snapshot support.`); declared.records = [...(capture ? capture.values[`mappings:${declared.id}`] as readonly MappingRecord[] : await (provider.store as unknown as MappingSnapshotStore).readAll())]; }
    for (const declared of next.providers.sitemaps) { const provider = byDomain.sitemaps.get(browserProviderIdFor("sitemaps", declared.id) as "sitemap-indexeddb"); if (!provider || !isSitemapCollectionStore(provider.store)) throw new ProviderIntegrationError("snapshot", `Sitemap provider "${declared.id}" lacks atomic snapshot support.`); declared.records = [...(capture ? capture.values[`sitemaps:${declared.id}`] as readonly SitemapRecord[] : await provider.store.readAll())]; }
    const result = validateSiteProject(next, activeSiteProjectValidationContext);
    if (!result.ok) {
      const onlyAttachmentDiagnostics = result.diagnostics.length > 0 && result.diagnostics.every((item) => item.path.startsWith("$.collectionAttachments"));
      if (!allowAttachmentDiagnostics || !onlyAttachmentDiagnostics) throw new ProviderIntegrationError("snapshot", `Provider snapshot is not coherent: ${result.diagnostics.map((item) => `${item.path}: ${item.message}`).join("; ")}`);
      return canonicalizeSiteProject(next);
    }
    return canonicalizeSiteProject(result.project);
  };

  let initialized = false; let active: { kind: string; promise: Promise<ProviderIntegrationOutcome> } | undefined; let tail: Promise<unknown> = Promise.resolve();
  const perform = async (kind: "initialize" | "retry" | "startFresh"): Promise<ProviderIntegrationOutcome> => {
    try {
      if (kind === "startFresh") throw new WorkspaceResetRequiredError();
      if (initialized && kind === "initialize") return { status: "ready" };
      let record = await storage.open(workspaceId);
      if (!record) {
        if (options.workspaceId) throw new ProviderIntegrationError("source", "The requested workspace does not exist. Choose one explicitly.", false);
        if (!initialProject || !initialRevision) throw activated.error!;
        record = await storage.create(initialProject, initialRevision, "initial");
      }
      workspaceId = record.id;
      return await withWorkspaceInitializationLock(options.compositionIdbFactory, workspaceId, async () => {
        workspaceRecord = (await storage.open(workspaceId))!;
        project = projectFromWorkspace(workspaceRecord);
        baseCompositions.splice(0, baseCompositions.length, ...project.providers.compositions.flatMap(({ id }) => { const provider = compositionCandidates.get(browserProviderIdFor("compositions", id)); return provider ? [provider] : []; }));
        byDomain.compositions = new Map(baseCompositions.map((provider) => [provider.descriptor.id, provider]));
        compositionProviders.splice(0, compositionProviders.length, ...baseCompositions.map(wrapComposition));
        verifyRegistry();
        if (workspaceRecord.status === "ready") {
          const databases = [
            [options.compositionIdbFactory, "zudo-composer", "composition"],
            [options.contentIdbFactory, "zudo-composer-content", "content"],
            [options.mappingIdbFactory, "zudo-composer-mapping", "mapping"],
            [options.sitemapIdbFactory, "zudo-composer-sitemapper", "sitemap"],
          ] as const;
          for (const [factory, name, phase] of databases) {
            const target = factory === undefined ? globalThis.indexedDB : factory;
            if (target?.databases && !(await target.databases()).some((database) => database.name === workspaceDatabaseName(name, workspaceId!))) throw new ProviderIntegrationError(phase, `Workspace ${phase} database is missing. Reset creates a new workspace; existing data is preserved.`, false);
          }
        }
        const seed = workspaceRecord.status === "seeding" ? workspaceRecord.seed : undefined;
        if (workspaceRecord.status === "seeding" && !seed) throw new ProviderIntegrationError("source", "Incomplete workspace seed metadata requires explicit reset.", false);
        mappingSeed = seed?.providers.mappings.find(({ id }) => id === "mapping-indexeddb")?.records ?? [];
        sitemapSeed = seed?.providers.sitemaps.find(({ id }) => id === "sitemap-indexeddb")?.records ?? [];
        for (const provider of baseCompositions) assertReady("composition", await provider.initialization[kind]());
        if (seed && isCompositionCollectionStore(baseComposition.store)) await baseComposition.store.seed(seed.providers.compositions.find(({ id }) => id === "indexeddb")?.records ?? []);
        assertReady("content", await baseContent.initialization[kind]());
        const contentSeed = seed?.providers.content.find(({ id }) => id === "content-indexeddb");
        if (contentSeed) await baseContent.store.seed({ models: contentSeed.models, entries: contentSeed.entries });
        if (seed) await verifyMappingRefs();
        assertReady("mapping", await baseMapping.initialization[kind]());
        if (seed) await baseMapping.store.seed({ mappings: mappingSeed });
        assertReady("sitemap", await baseSitemap.initialization[kind]());
        if (seed) { await verifySitemapRefs("startFresh"); if (isSitemapCollectionStore(baseSitemap.store)) await baseSitemap.store.seed(sitemapSeed); await snapshotNow(); workspaceRecord = await storage.complete(workspaceId!); }
        initialized = true;
        return { status: "ready" as const };
      });
    } catch (cause) { return { status: "error", error: integrationError("snapshot", cause, "Provider integration failed.") }; }
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
  const ensureReady = async (): Promise<void> => { const result = await lifecycle.initialize(); if (result.status === "error") throw result.error; };
  const guardedContentProviders = contentProviders.map((provider) => ({ descriptor: provider.descriptor, store: {
    listModels: async () => { await ensureReady(); return provider.store.listModels(); },
    getModel: async (id: string) => { await ensureReady(); return provider.store.getModel(id); },
    scanEntries: async (id: string) => { await ensureReady(); return provider.store.scanEntries(id); },
  } }));
  const guardedCompositionProviders = () => compositionProviders.map((provider) => ({ descriptor: provider.descriptor, store: {
    list: async () => { await ensureReady(); return provider.store.list(); },
    get: async (id: string) => { await ensureReady(); return provider.store.get(id); },
  } }));
  const guardedMappingProviders = mappingProviders.map((provider) => ({ descriptor: provider.descriptor, store: {
    list: async () => { await ensureReady(); return provider.store.list(); },
    get: async (id: string) => { await ensureReady(); return provider.store.get(id); },
  } }));
  const contentCatalog = createContentCatalog(guardedContentProviders);
  const rawMappingCompositionCatalog = () => createMappingCompositionCatalog(guardedCompositionProviders());
  const mappingCompositionCatalog: MappingCompositionCatalog = {
    list: async () => { try { await ensureReady(); return rawMappingCompositionCatalog().list(); } catch (error) { return { status: "listed", entries: [], failures: [{ providerId: "site-project", providerLabel: "Active SiteProject", reason: error instanceof Error ? error.message : "SiteProject initialization failed." }] }; } },
    resolve: async (ref) => { try { await ensureReady(); return rawMappingCompositionCatalog().resolve(ref); } catch (error) { return { status: "provider-error", reason: error instanceof Error ? error.message : "SiteProject initialization failed." }; } },
  };
  const mappingContentEntries: MappingContentEntryCatalog = {
    async scan(ref) { if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` }; const initialized = await lifecycle.initialize(); if (initialized.status !== "ready") return { status: "provider-error", reason: initialized.error.message }; try { return { status: "resolved", snapshot: await contentProvider.store.scanEntries(ref.recordId) }; } catch (error) { return { status: "provider-error", reason: error instanceof Error ? error.message : "Content snapshot failed." }; } },
    async get(ref, id) { if (ref.providerId !== contentProvider.descriptor.id) return { status: "provider-error", reason: `Content provider "${ref.providerId}" is unavailable.` }; const initialized = await lifecycle.initialize(); if (initialized.status !== "ready") return { status: "provider-error", reason: initialized.error.message }; const result = await contentProvider.store.getEntry(id); if (result.status === "loaded") return result.record.modelId === ref.recordId ? { status: "resolved", entry: result.record } : { status: "not-found" }; if (result.status === "not-found") return { status: "not-found" }; return { status: "invalid", reason: result.status === "invalid" ? result.issue.message : `Entry uses unsupported schema version ${result.foundSchemaVersion}.` }; },
  };
  const mappingCatalog = createMappingCatalog(guardedMappingProviders);
  const sitemapperMappingCatalog = createMappingAssignmentCatalog(guardedMappingProviders, guardedContentProviders, async (mapping) => { const definition = await resolveMappingDefinition(mapping, { content: contentCatalog, compositions: mappingCompositionCatalog }, activeComponentProvider.catalog); return definition.status === "ready" ? { status: "ready" } : { status: "blocked", diagnostics: definition.diagnostics.map(({ code, message }) => ({ code, message })) }; });
  const preview = () => createContentPreviewSource({ mappings: mappingCatalog, catalogs: { content: contentCatalog, compositions: mappingCompositionCatalog }, manifest: activeComponentProvider.catalog, initializeContent: async () => { const result = await lifecycle.initialize(); return result.status === "ready" ? { status: "ready" } : { status: "error", reason: result.error.message }; }, initializeMappings: async () => { const result = await lifecycle.initialize(); return result.status === "ready" ? { status: "ready" } : { status: "error", reason: result.error.message }; } });

  const initializedCompositionCatalog = () => createCompositionCatalog(guardedCompositionProviders());
  const compositionCatalog: CompositionCatalog = {
    listCompositions: async () => { try { await ensureReady(); return initializedCompositionCatalog().listCompositions(); } catch (error) { return { entries: [], failures: [{ providerId: "site-project", providerLabel: "Active SiteProject", reason: error instanceof Error ? error.message : "SiteProject initialization failed." }] }; } },
    resolveComposition: async (ref) => { try { await ensureReady(); return initializedCompositionCatalog().resolveComposition(ref); } catch { return { status: "provider-unavailable" }; } },
  };

  const sources = (includeMedia: boolean): WorkspaceSnapshotSource[] => {
    if (!project || !workspaceId) throw new ProviderIntegrationError("snapshot", "Open a workspace before capture.");
    const result: WorkspaceSnapshotSource[] = [{ id: "workspace", token: async () => (await storage.open(workspaceId))!.mutationToken, read: async () => { const value = (await storage.open(workspaceId))!; return { mutationToken: value.mutationToken, value }; } }];
    for (const domain of ["compositions", "mappings", "sitemaps"] as const) for (const declared of project.providers[domain]) {
      const store = byDomain[domain].get(browserProviderIdFor(domain, declared.id as never) as never)?.store;
      const id = `${domain}:${declared.id}`;
      if (!store?.snapshot || !store.mutationToken) throw new ProviderIntegrationError("snapshot", `${id} lacks durable snapshot/precondition capability.`, false);
      result.push({ id, token: () => store.mutationToken!(), read: async () => { const value = await store.snapshot!(); return { mutationToken: value.mutationToken, value: value.records }; } });
    }
    for (const declared of project.providers.content) {
      const store = byDomain.content.get(browserProviderIdFor("content", declared.id) as "content-indexeddb")!.store;
      result.push({ id: `content:${declared.id}`, token: async () => (await store.readAll()).mutationToken, read: async () => { const value = await store.readAll(); return { mutationToken: value.mutationToken, value }; } });
    }
    if (includeMedia) {
      if (!mediaProvider) throw new ProviderIntegrationError("snapshot", "Media is unavailable; a release capture cannot claim a complete media snapshot.", false);
      result.push({ id: `media:${mediaProvider.descriptor.id}`, token: () => mediaProvider.store.mutationToken(), read: async () => { const value = await mediaProvider.store.snapshot(); return { mutationToken: value.mutationToken, value }; } });
    }
    return result;
  };
  const capture = async (includeMedia: boolean): Promise<WorkspaceCaptureOutcome> => {
    const ready = await lifecycle.initialize();
    if (ready.status === "error") return { status: "unavailable", source: ready.error.phase, error: ready.error };
    try { return await captureWorkspaceSnapshot(workspaceId!, sessions, sources(includeMedia)); }
    catch (cause) { return { status: "unavailable", source: "capabilities", error: integrationError("snapshot", cause, "Workspace capture capability is unavailable.") }; }
  };
  const isCaptureCurrent = async (value: WorkspaceCapture) => {
    await ensureReady();
    return checkWorkspaceCapture(value, workspaceId!, sessions, sources(Object.keys(value.tokens).some((key) => key.startsWith("media:"))));
  };
  const openIntegration = async (id: string): Promise<ProductionProviderIntegration> => {
    const next = createProductionProviderIntegration({ ...options, workspaceId: id, saveRegistry: sessions });
    const ready = await next.initialization.initialize();
    if (ready.status === "error") throw ready.error;
    let selected: WorkspaceRecord | undefined;
    try { selected = await storage.open(); } catch { /* Explicit open repairs only the selection, never the original data. */ }
    if (selected?.id !== id) await storage.complete(id);
    return next;
  };
  const create = async (value: SiteProject, baselineRevision: string): Promise<ProductionProviderIntegration> => {
    const validated = activate(value);
    if (!validated.project) throw validated.error!;
    if (!SOURCE_REVISION.test(baselineRevision)) throw new ProviderIntegrationError("source", "A canonical baseline revision is required.", false);
    const record = await storage.create(validated.project, baselineRevision);
    return openIntegration(record.id);
  };
  const workspace: WorkspaceLifecycle = {
    get id() { return workspaceId; },
    async metadata(metadataOptions = {}) { if (metadataOptions.ensureReady !== false) await ensureReady(); return (await storage.open(workspaceId))!; },
    async updateMetadata(expectedToken, patch) {
      await ensureReady();
      if (patch.activeSitemap) {
        if (patch.activeSitemap.providerId !== "sitemap-indexeddb" || (await baseSitemap.store.get(patch.activeSitemap.recordId)).status !== "loaded") throw new ProviderIntegrationError("sitemap", "Select an existing provider-qualified Sitemap.", false);
      }
      return storage.update(workspaceId!, expectedToken, patch);
    },
    async reconcileBaseline(value, revision) {
      if (!await isCaptureCurrent(value)) return "changed";
      try { await storage.update(workspaceId!, value.tokens.workspace as number, { baselineRevision: revision }); return "applied"; }
      catch (cause) { if (!await isCaptureCurrent(value)) return "changed"; throw cause; }
    },
    open: openIntegration, create, loadExample: create,
    async reset() {
      if (!initialProject || !initialRevision) throw new ProviderIntegrationError("source", "Reset requires a valid example/source project. Use workspace.loadExample(project, revision).", false);
      return create(initialProject, initialRevision);
    },
  };
  const captureWithoutSessions = async (includeMedia: boolean): Promise<WorkspaceCaptureOutcome> => {
    if (!project || !workspaceId) return { status: "unavailable", source: "workspace", error: new ProviderIntegrationError("snapshot", "Open a workspace before capture.") };
    const ready = await lifecycle.initialize();
    if (ready.status === "error") return { status: "unavailable", source: ready.error.phase, error: ready.error };
    const sessionGeneration = sessions.generation;
    const before: Record<string, WorkspaceToken> = {};
    const embedded: Record<string, WorkspaceToken> = {};
    const values: Record<string, unknown> = {};
    let sourceList: WorkspaceSnapshotSource[];
    let current = "workspace";
    try {
      sourceList = sources(includeMedia);
      for (const source of sourceList) { current = source.id; before[source.id] = await source.token(); }
      for (const source of sourceList) { current = source.id; const snapshot = await source.read(); values[source.id] = snapshot.value; embedded[source.id] = snapshot.mutationToken; }
      const changed: string[] = [];
      for (const source of sourceList) { current = source.id; const after = await source.token(); if (before[source.id] !== embedded[source.id] || after !== embedded[source.id]) changed.push(source.id); }
      if (sessions.generation !== sessionGeneration) changed.push("editor-sessions");
      if (changed.length) return { status: "changed", sources: changed };
      return { status: "ready", capture: { workspaceId, sessionGeneration, tokens: embedded, values } };
    } catch (cause) {
      return { status: "unavailable", source: current, error: cause instanceof Error ? cause : new Error("Snapshot read failed.", { cause }) };
    }
  };
  const getCurrentSiteProject = async (captureOptions: { flushSessions?: boolean } = {}): Promise<SiteProjectSnapshotOutcome> => {
    const value = captureOptions.flushSessions === false ? await captureWithoutSessions(false) : await capture(false);
    if (value.status !== "ready") return { status: "error", error: new ProviderIntegrationError("snapshot", value.status === "unavailable" ? `${value.source}: ${value.error.message}` : value.status === "save-failed" ? value.failures.map((failure) => `${failure.feature}/${failure.providerId}/${failure.recordId ?? "operation"}: ${failure.error.message}`).join("; ") : `Workspace changed during capture: ${value.sources.join(", ")}.`) };
    try { return { status: "ready", project: await snapshotNow(value.capture, true) }; }
    catch (cause) { return { status: "error", error: integrationError("snapshot", cause, "Snapshot validation failed.") }; }
  };
  const subscribeChanges = (listener: () => void) => {
    const stopStorage = subscribePersistenceChanges((database) => { if (database === WORKSPACE_DATABASE_NAME || database === "media" || database === "compositions:files" || database.endsWith(`-workspace-v1-${workspaceId}`)) listener(); });
    let sessionGeneration = sessions.generation;
    const stopSessions = sessions.subscribe(() => { if (sessionGeneration !== sessions.generation) { sessionGeneration = sessions.generation; listener(); } });
    return () => { stopStorage(); stopSessions(); };
  };
  const mappingAttachmentService = createMappingAttachmentService({
    mediaStore: mediaProvider?.store,
    getCurrentSiteProject,
    workspace,
    componentCatalog: activeComponentProvider.catalog,
    subscribe: (listener) => subscribePersistenceChanges((database) => { if (database === WORKSPACE_DATABASE_NAME || database.endsWith(`-workspace-v1-${workspaceId}`)) listener(); }),
  });
  return Object.freeze({ componentProvider: activeComponentProvider, compositionProviders, compositionCatalog, mappingCompositionCatalog, contentProviders, contentProvider, contentCatalog, mediaProvider, createContentPreviewSource: preview, mappingContentEntries, mappingProviders, mappingProvider, mappingCatalog, mappingAttachmentService, sitemapProvider, sitemapperMappingCatalog, initialization: lifecycle, workspace, sessions,
    subscribeChanges,
    captureWorkspace: async (): Promise<WorkspaceProjectCaptureOutcome> => {
      const outcome = await capture(true);
      if (outcome.status !== "ready") return outcome;
      try { return { ...outcome, project: await snapshotNow(outcome.capture) }; }
      catch (cause) { return { status: "unavailable", source: "project-validation", error: integrationError("snapshot", cause, "Project validation failed.") }; }
    }, isCaptureCurrent,
    getCurrentSiteProject,
  });
}
