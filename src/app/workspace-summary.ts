// One read model over every authoring provider, for the Home dashboard and any
// other surface that needs "what is in this workspace right now".
//
// Two rules shape the design:
//
//   1. Sources resolve INDEPENDENTLY. Nothing transacts across the four
//      authoring domains and the Asset provider is a separate dev service, so
//      a single failure must degrade one panel rather than blank the dashboard.
//      Every source therefore returns `ok` or `unavailable` on its own — except
//      Asset, which can also be `absent`: there is no dev provider configured
//      at all, which is not the same failure as a configured one that could not
//      be read.
//   2. Provider initialization happens ONCE per summary UNLESS it failed. A
//      fulfilled initialization is never re-run, so a refresh can never
//      re-seed, re-verify, or restart the SiteProject integration; a failed one
//      is re-attempted on the next `refresh()` through the lifecycle's `retry()`,
//      which is what lets the dashboard's `Unavailable · Retry` succeed.
//
// SiteProject delivery routes (`/site*`) are deliberately absent: they render
// outside the CMS chrome and are not authoring records.

import { COMPOSITION_FILE_PROVIDER_CHANNEL } from "../composer/storage/file-provider";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../mapping/storage/file-provider";
import { SITEMAP_FILE_PROVIDER_DOMAIN } from "../sitemapper/storage/file-provider";
import { ASSET_PERSISTENCE_CHANNEL } from "./persistence-channels";
import type { CompositionSummary } from "../composer/browser";
import type { ContentCatalog } from "../content/catalog";
import type { ContentEntryRecord, ContentModelRecord } from "../content/model";
import type { ContentStore } from "../content/library";
import type { ComponentCatalog } from "../composer/model/types";
import { mappingDeepLinkHref } from "../features/mapping/deep-link";
import type { AssetStore } from "../assets";
import { resolveMappingDefinition, type CompositionCatalog as MappingCompositionCatalog, type MappingCatalog } from "../mapping";
import { isSafeRecordId, type RecordId } from "../shared";
import type { SitemapRecord, SitemapStore } from "../sitemapper/library";
import type { SitemapNode } from "../sitemapper/model";
import { formatIntent, type RouteIntent } from "./route-intents";

/** One provider read that succeeded, or the reason it could not be read. */
export type WorkspaceSource<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "unavailable"; readonly error: string };

/**
 * Asset-only: a third status for "no provider is configured", distinct from
 * `unavailable` (a configured provider that failed). Every other domain stays
 * on the plain `WorkspaceSource<T>` above and is structurally incapable of
 * being absent.
 */
export type WorkspaceAssetSource<T> = WorkspaceSource<T> | { readonly status: "absent" };

export type WorkspaceSourceName = "compositions" | "mappings" | "sitemaps" | "content" | "assets";

export interface WorkspaceSourceFailure {
  readonly source: WorkspaceSourceName;
  readonly error: string;
}

export interface CompositionCounts {
  readonly compositions: number;
  readonly patterns: number;
  readonly globalTemplates: number;
}
export interface MappingCounts {
  readonly mappings: number;
  readonly blockedMappings: number;
}
export interface SitemapCounts {
  readonly sitemaps: number;
  readonly pages: number;
  readonly unassignedPages: number;
}
export interface ContentCounts {
  readonly models: number;
  readonly entries: number;
  readonly incompleteEntries: number;
}
export interface AssetCounts {
  readonly assets: number;
  readonly bytes: number;
  /** Keyed by the provider's asset type, e.g. `image/png`. */
  readonly byType: Readonly<Record<string, number>>;
}

export interface WorkspaceCounts {
  readonly compositions: WorkspaceSource<CompositionCounts>;
  readonly mappings: WorkspaceSource<MappingCounts>;
  readonly sitemaps: WorkspaceSource<SitemapCounts>;
  readonly content: WorkspaceSource<ContentCounts>;
  readonly assets: WorkspaceAssetSource<AssetCounts>;
}

export type WorkspaceRecordKind =
  | "composition"
  | "pattern"
  | "global-template"
  | "mapping"
  | "sitemap"
  | "content-model"
  | "content-entry"
  | "asset";

export interface WorkspaceRecord {
  readonly kind: WorkspaceRecordKind;
  readonly id: RecordId;
  readonly label: string;
  readonly updatedAt: string;
  /** Where the chrome should navigate; always a real route, never a dead link. */
  readonly href: string;
  /** Present only where the target route accepts a typed intent. */
  readonly intent?: RouteIntent;
}

export interface WorkspaceRecent {
  /**
   * Newest first across every source, sorted before `limit` is applied, so
   * `records[0]` is the workspace's latest write at any limit.
   */
  readonly records: readonly WorkspaceRecord[];
  /** Sources omitted from `records` because they could not be read. */
  readonly unavailable: readonly WorkspaceSourceFailure[];
}

export type WorkspaceAttentionKind = "blocked-mapping" | "unassigned-page" | "incomplete-entry";

export interface WorkspaceAttentionItem {
  readonly kind: WorkspaceAttentionKind;
  readonly id: RecordId;
  readonly label: string;
  /** The first blocking reason, phrased for a dashboard row. */
  readonly detail: string;
  readonly href: string;
  readonly intent?: RouteIntent;
}

export interface WorkspaceAttention {
  readonly mappings: WorkspaceSource<readonly WorkspaceAttentionItem[]>;
  readonly sitemaps: WorkspaceSource<readonly WorkspaceAttentionItem[]>;
  readonly content: WorkspaceSource<readonly WorkspaceAttentionItem[]>;
}

/** What one lifecycle attempt answers. */
export type WorkspaceInitializationOutcome = { status: "ready" } | { status: "error"; error: Error };

/**
 * The structural slice of `ProductionProviderIntegration` this read model uses.
 * Naming it here keeps the summary testable with plain fakes and keeps the
 * integration free to grow.
 */
export interface WorkspaceSummaryIntegration {
  subscribeChanges?(listener: (channel?: string) => void): () => void;
  readonly initialization: { initialize(): Promise<WorkspaceInitializationOutcome>; retry(): Promise<WorkspaceInitializationOutcome> };
  readonly componentProvider: { readonly catalog: ComponentCatalog };
  readonly compositionProviders: readonly {
    readonly descriptor: { readonly id: string; readonly label: string };
    readonly store: { list(): Promise<readonly CompositionSummary[]> };
  }[];
  readonly contentProvider: { readonly descriptor: { id: string }; readonly store: Pick<ContentStore, "listModels" | "scanEntries"> };
  readonly contentCatalog: ContentCatalog;
  readonly mappingCatalog: MappingCatalog;
  readonly mappingCompositionCatalog: MappingCompositionCatalog;
  readonly sitemapProvider: { readonly descriptor?: { id: string }; readonly store: WorkspaceSitemapStore };
  readonly assetProvider: { readonly descriptor: { id: string }; readonly store: Pick<AssetStore, "list"> } | undefined;
}

export interface WorkspaceSummary {
  subscribe?(listener: () => void): () => void;
  dispose?(): void;
  counts(): Promise<WorkspaceCounts>;
  recent(limit?: number): Promise<WorkspaceRecent>;
  attention(): Promise<WorkspaceAttention>;
  /**
   * Drop the memoised provider reads; the next call re-reads them. A failed
   * initialization is re-attempted too; a fulfilled or in-flight one is not.
   */
  refresh(): void;
}

export const DEFAULT_RECENT_LIMIT = 8;

interface CompositionsData {
  readonly counts: CompositionCounts;
  readonly records: readonly WorkspaceRecord[];
}
interface MappingsData {
  readonly counts: MappingCounts;
  readonly records: readonly WorkspaceRecord[];
  readonly attention: readonly WorkspaceAttentionItem[];
}
interface SitemapsData {
  readonly counts: SitemapCounts;
  readonly records: readonly WorkspaceRecord[];
  readonly attention: readonly WorkspaceAttentionItem[];
}
interface ContentData {
  readonly counts: ContentCounts;
  readonly records: readonly WorkspaceRecord[];
  readonly attention: readonly WorkspaceAttentionItem[];
}
interface AssetData {
  readonly counts: AssetCounts;
  readonly records: readonly WorkspaceRecord[];
}

interface WorkspaceData {
  readonly compositions: WorkspaceSource<CompositionsData>;
  readonly mappings: WorkspaceSource<MappingsData>;
  readonly sitemaps: WorkspaceSource<SitemapsData>;
  readonly content: WorkspaceSource<ContentData>;
  readonly assets: WorkspaceAssetSource<AssetData>;
}

function reason(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function project<A, B>(source: WorkspaceSource<A>, map: (value: A) => B): WorkspaceSource<B> {
  return source.status === "ok" ? { status: "ok", value: map(source.value) } : source;
}

function projectAsset<A, B>(source: WorkspaceAssetSource<A>, map: (value: A) => B): WorkspaceAssetSource<B> {
  return source.status === "ok" ? { status: "ok", value: map(source.value) } : source;
}

/** Newest first, with a stable tie-break so equal timestamps never reorder between reads. */
function byRecency(left: WorkspaceRecord, right: WorkspaceRecord): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compositionKind(summary: CompositionSummary): WorkspaceRecordKind {
  return summary.publicationKind ?? "composition";
}

/** Entries carry no name, so borrow the first plain-text value the model defines. */
const ENTRY_LABEL_FIELD_KINDS = new Set(["text", "long-text", "slug"]);
const ENTRY_LABEL_MAX_LENGTH = 80;

function entryLabel(model: ContentModelRecord, entry: ContentEntryRecord): string {
  for (const field of model.document.fields) {
    if (!ENTRY_LABEL_FIELD_KINDS.has(field.kind)) continue;
    const value = entry.values[field.id];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed.length > ENTRY_LABEL_MAX_LENGTH ? `${trimmed.slice(0, ENTRY_LABEL_MAX_LENGTH)}…` : trimmed;
  }
  return entry.id;
}

function flattenPages(nodes: readonly SitemapNode[]): readonly SitemapNode[] {
  return nodes.flatMap((node) => [node, ...flattenPages(node.children)]);
}

/**
 * The Sitemap surface this read model needs. A collection provider answers the
 * whole set atomically; anything else is read record by record and quarantined
 * records are simply absent rather than failing the source.
 */
export type WorkspaceSitemapStore = Pick<SitemapStore, "list" | "get"> & {
  readAll?(): Promise<readonly SitemapRecord[]>;
};

async function readSitemapRecords(store: WorkspaceSitemapStore): Promise<readonly SitemapRecord[]> {
  if (typeof store.readAll === "function") return store.readAll();
  const summaries = await store.list();
  const loaded = await Promise.all(summaries.map((summary) => store.get(summary.id)));
  return loaded.flatMap((outcome) => (outcome.status === "loaded" ? [outcome.record] : []));
}

export function createWorkspaceSummary(integration: WorkspaceSummaryIntegration): WorkspaceSummary {
  // Memoised so `counts()`, `recent()` and `attention()` share one lifecycle run
  // and one set of provider reads. A failure is memoised too — one broken read
  // costs one attempt, not one per loader — and stays memoised until `refresh()`
  // re-attempts it through `retry()`. Only a failed initialization is ever
  // dropped: re-running a fulfilled one would re-seed the integration, and
  // dropping an in-flight one would leave two attempts running at once.
  // `attempted` outlives the state because, once `refresh()` has cleared a
  // failure, the state alone can no longer tell a first attempt from a re-attempt.
  let state: "idle" | "pending" | "ready" | "failed" = "idle";
  let attempted = false;
  let initialization: Promise<void> | undefined;
  const ensureInitialized = (): Promise<void> => {
    if (initialization) return initialization;
    const action = attempted ? "retry" : "initialize";
    attempted = true;
    state = "pending";
    initialization = (async () => {
      const outcome = await integration.initialization[action]();
      if (outcome.status === "error") throw outcome.error;
    })().then(
      () => {
        state = "ready";
      },
      (cause: unknown) => {
        state = "failed";
        throw cause;
      },
    );
    return initialization;
  };

  const loadCompositions = async (): Promise<CompositionsData> => {
    await ensureInitialized();
    let compositions = 0;
    let patterns = 0;
    let globalTemplates = 0;
    const records: WorkspaceRecord[] = [];
    for (const provider of integration.compositionProviders) {
      let summaries: readonly CompositionSummary[];
      try {
        summaries = await provider.store.list();
      } catch (cause) {
        throw new Error(`Compositions in ${provider.descriptor.label} could not be listed: ${reason(cause, "the provider failed.")}`, { cause });
      }
      for (const summary of summaries) {
        compositions += 1;
        if (summary.publicationKind === "pattern") patterns += 1;
        if (summary.publicationKind === "global-template") globalTemplates += 1;
        records.push({
          kind: compositionKind(summary),
          id: summary.id,
          label: summary.name,
          updatedAt: summary.updatedAt,
          // The Composer route opens records through its own library; it has no per-record intent.
          href: "/composer",
        });
      }
    }
    return { counts: { compositions, patterns, globalTemplates }, records };
  };

  const loadMappings = async (): Promise<MappingsData> => {
    await ensureInitialized();
    const listing = await integration.mappingCatalog.list();
    if (listing.failures.length > 0) {
      throw new Error(listing.failures.map(({ providerLabel, reason: message }) => `${providerLabel}: ${message}`).join("; "));
    }
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let blockedMappings = 0;
    for (const entry of listing.entries) {
      const href = mappingDeepLinkHref({ providerId: entry.ref.providerId, mappingId: entry.ref.recordId });
      records.push({ kind: "mapping", id: entry.summary.id, label: entry.summary.name, updatedAt: entry.summary.updatedAt, href });
      const resolved = await integration.mappingCatalog.resolve(entry.ref);
      if (resolved.status !== "resolved") {
        blockedMappings += 1;
        attention.push({
          kind: "blocked-mapping",
          id: entry.summary.id,
          label: entry.summary.name,
          detail: resolved.status === "not-found" ? "This Mapping record was not found." : resolved.reason,
          href,
        });
        continue;
      }
      const definition = await resolveMappingDefinition(
        resolved.record,
        { content: integration.contentCatalog, compositions: integration.mappingCompositionCatalog },
        integration.componentProvider.catalog,
      );
      const blocking = definition.diagnostics.filter(({ severity }) => severity === "blocking");
      if (definition.status !== "blocked" || blocking.length === 0) continue;
      blockedMappings += 1;
      attention.push({ kind: "blocked-mapping", id: entry.summary.id, label: entry.summary.name, detail: blocking[0]!.message, href });
    }
    return { counts: { mappings: listing.entries.length, blockedMappings }, records, attention };
  };

  const loadSitemaps = async (): Promise<SitemapsData> => {
    await ensureInitialized();
    const providerId = integration.sitemapProvider.descriptor?.id;
    if (!providerId) throw new Error("Sitemap provider identity is unavailable.");
    const sitemaps = await readSitemapRecords(integration.sitemapProvider.store);
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let pages = 0;
    let unassignedPages = 0;
    for (const sitemap of sitemaps) {
      const intent: RouteIntent = { route: "sitemapper", providerId, sitemapId: sitemap.id };
      records.push({ kind: "sitemap", id: sitemap.id, label: sitemap.document.name, updatedAt: sitemap.updatedAt, href: formatIntent(intent), intent });
      for (const page of flattenPages(sitemap.document.root)) {
        pages += 1;
        if (page.source.kind !== "unassigned") continue;
        unassignedPages += 1;
        // A page id is provider-generated; only a URL-safe one can carry a page intent.
        const pageIntent: RouteIntent = isSafeRecordId(page.id) ? { route: "sitemapper", providerId, sitemapId: sitemap.id, pageId: page.id } : intent;
        attention.push({
          kind: "unassigned-page",
          id: page.id,
          label: page.title,
          detail: `"${sitemap.document.name}" has a page with no Composition or Mapping source.`,
          href: formatIntent(pageIntent),
          intent: pageIntent,
        });
      }
    }
    return { counts: { sitemaps: sitemaps.length, pages, unassignedPages }, records, attention };
  };

  const loadContent = async (): Promise<ContentData> => {
    await ensureInitialized();
    const models = await integration.contentProvider.store.listModels();
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let entries = 0;
    let incompleteEntries = 0;
    for (const model of models) {
      const modelIntent: RouteIntent = { route: "content", providerId: integration.contentProvider.descriptor.id, modelId: model.id };
      records.push({ kind: "content-model", id: model.id, label: model.name, updatedAt: model.updatedAt, href: formatIntent(modelIntent), intent: modelIntent });
      const snapshot = await integration.contentProvider.store.scanEntries(model.id);
      entries += snapshot.count;
      const labels = new Map<RecordId, string>();
      for (const entry of snapshot.entries) {
        const label = entryLabel(snapshot.model, entry);
        labels.set(entry.id, label);
        const entryIntent: RouteIntent = { route: "content", providerId: integration.contentProvider.descriptor.id, modelId: model.id, entryId: entry.id };
        records.push({ kind: "content-entry", id: entry.id, label, updatedAt: entry.updatedAt, href: formatIntent(entryIntent), intent: entryIntent });
      }
      const firstDiagnosticByEntry = new Map<RecordId, string>();
      for (const diagnostic of snapshot.diagnostics) {
        if (!firstDiagnosticByEntry.has(diagnostic.entryId)) firstDiagnosticByEntry.set(diagnostic.entryId, diagnostic.message);
      }
      incompleteEntries += firstDiagnosticByEntry.size;
      for (const [entryId, detail] of firstDiagnosticByEntry) {
        const entryIntent: RouteIntent = { route: "content", providerId: integration.contentProvider.descriptor.id, modelId: model.id, entryId };
        attention.push({ kind: "incomplete-entry", id: entryId, label: labels.get(entryId) ?? entryId, detail, href: formatIntent(entryIntent), intent: entryIntent });
      }
    }
    return { counts: { models: models.length, entries, incompleteEntries }, records, attention };
  };

  // Assets use a separate provider with its own lifecycle, so they deliberately do
  // not wait on — or fail with — the SiteProject integration.
  const loadAsset = async (provider: NonNullable<WorkspaceSummaryIntegration["assetProvider"]>): Promise<AssetData> => {
    const summaries = await provider.store.list();
    const byType: Record<string, number> = {};
    let bytes = 0;
    const records: WorkspaceRecord[] = [];
    for (const summary of summaries) {
      bytes += summary.byteLength;
      byType[summary.mimeType] = (byType[summary.mimeType] ?? 0) + 1;
      const intent: RouteIntent = { route: "assets", providerId: integration.assetProvider!.descriptor.id, assetId: summary.id };
      records.push({ kind: "asset", id: summary.id, label: summary.fileName, updatedAt: summary.updatedAt, href: formatIntent(intent), intent });
    }
    return { counts: { assets: summaries.length, bytes, byType }, records };
  };

  // Unlike `guard`, "no provider connected" is reported as `absent` rather than
  // caught as a failure — it is the ordinary dev answer, not a broken read.
  const readAsset = async (): Promise<WorkspaceAssetSource<AssetData>> => {
    const provider = integration.assetProvider;
    if (!provider) return { status: "absent" };
    try {
      return { status: "ok", value: await loadAsset(provider) };
    } catch (cause) {
      return { status: "unavailable", error: reason(cause, "Asset could not be read.") };
    }
  };

  const guard = async <T>(fallback: string, load: () => Promise<T>): Promise<WorkspaceSource<T>> => {
    try {
      return { status: "ok", value: await load() };
    } catch (cause) {
      return { status: "unavailable", error: reason(cause, fallback) };
    }
  };

  // Cache each read model independently; Mapping diagnostics also read Content
  // schemas and Compositions, while the other summaries own just their domain.
  let cached: Partial<{ -readonly [K in keyof WorkspaceData]: Promise<WorkspaceData[K]> }> = {};
  const read = async (): Promise<WorkspaceData> => {
    const [compositions, mappings, sitemaps, content, asset] = await Promise.all([
      cached.compositions ??= guard("Compositions could not be read.", loadCompositions),
      cached.mappings ??= guard("Mappings could not be read.", loadMappings),
      cached.sitemaps ??= guard("Sitemaps could not be read.", loadSitemaps),
      cached.content ??= guard("Content could not be read.", loadContent),
      cached.assets ??= readAsset(),
    ]);
    return { compositions, mappings, sitemaps, content, assets: asset };
  };

  const listeners = new Set<() => void>();
  const stopChanges = integration.subscribeChanges?.((channel) => {
    if (channel === "sessions") return; // Pending edits are not persisted counts.
    if (channel === COMPOSITION_FILE_PROVIDER_CHANNEL) { delete cached.compositions; delete cached.mappings; }
    else if (channel === CONTENT_FILE_PROVIDER_DOMAIN) { delete cached.content; delete cached.mappings; }
    else if (channel === MAPPING_FILE_PROVIDER_DOMAIN) delete cached.mappings;
    else if (channel === SITEMAP_FILE_PROVIDER_DOMAIN) delete cached.sitemaps;
    else if (channel === ASSET_PERSISTENCE_CHANNEL) delete cached.assets;
    else cached = {}; // Workspace selection and legacy broad hints.
    for (const listener of listeners) listener();
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stopChanges?.(); cached = {}; listeners.clear(); },
    async counts() {
      const data = await read();
      return {
        compositions: project(data.compositions, ({ counts }) => counts),
        mappings: project(data.mappings, ({ counts }) => counts),
        sitemaps: project(data.sitemaps, ({ counts }) => counts),
        content: project(data.content, ({ counts }) => counts),
        assets: projectAsset(data.assets, ({ counts }) => counts),
      };
    },
    async recent(limit = DEFAULT_RECENT_LIMIT) {
      const data = await read();
      const records: WorkspaceRecord[] = [];
      const unavailable: WorkspaceSourceFailure[] = [];
      for (const source of ["compositions", "mappings", "sitemaps", "content"] as const) {
        const entry = data[source];
        if (entry.status === "ok") records.push(...entry.value.records);
        else unavailable.push({ source, error: entry.error });
      }
      // An absent Asset provider is the ordinary dev answer, not a failed read,
      // so — unlike the four sources above — it is skipped rather than listed.
      if (data.assets.status === "ok") records.push(...data.assets.value.records);
      else if (data.assets.status === "unavailable") unavailable.push({ source: "assets", error: data.assets.error });
      return { records: records.sort(byRecency).slice(0, Math.max(0, limit)), unavailable };
    },
    async attention() {
      const data = await read();
      return {
        mappings: project(data.mappings, ({ attention }) => attention),
        sitemaps: project(data.sitemaps, ({ attention }) => attention),
        content: project(data.content, ({ attention }) => attention),
      };
    },
    refresh() {
      cached = {};
      for (const listener of listeners) listener();
      if (state !== "failed") return;
      state = "idle";
      initialization = undefined;
    },
  };
}
