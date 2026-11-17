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

import type { PersistedSnapshot } from "../shared/persistence-generation";
import { COMPOSITION_FILE_PROVIDER_CHANNEL } from "../composer/storage/file-provider";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../mapping/storage/file-provider";
import { SITEMAP_FILE_PROVIDER_DOMAIN } from "../sitemapper/storage/file-provider";
import { ASSET_PERSISTENCE_CHANNEL } from "./persistence-channels";
import { summarizeComposition, validateCompositionRecord, type CompositionRecord, type CompositionSummary } from "../composer/browser";
import type { ContentCatalog } from "../content/catalog";
import { validateContentModelRecord, validateContentEntryRecord, type ContentEntryRecord, type ContentModelRecord } from "../content/model";
import { summarizeContentModel, compareContentModelsNewestFirst, compareContentEntriesForPaging, diagnoseContentEntryCompleteness, contentEntrySemanticIssue, type ContentSnapshot, type ContentStore } from "../content/library";
import type { ComponentCatalog } from "../composer/model/types";
import { mappingDeepLinkHref } from "../features/mapping/deep-link";
import type { AssetStore } from "../assets";
import { resolveMappingDefinition, summarizeMapping, validateMappingRecord, type MappingRecord, type MappingCatalogEntry, type CompositionCatalog as MappingCompositionCatalog, type MappingCatalog } from "../mapping";
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
    readonly store: {
      list(): Promise<readonly CompositionSummary[]>;
      /** Validated canonical inventory; does not generate or repair JSX. */
      snapshot?(): Promise<PersistedSnapshot<CompositionRecord>>;
    };
  }[];
  readonly contentProvider: { readonly descriptor: { id: string }; readonly store: Pick<ContentStore, "listModels" | "scanEntries"> & Partial<Pick<ContentStore, "readAll">> };
  readonly contentCatalog: ContentCatalog;
  /** Complete configured provider inventory when supplied; legacy catalogs remain supported. */
  readonly mappingProviders?: readonly {
    readonly descriptor: { readonly id: string; readonly label: string };
    readonly store: { snapshot?(): Promise<PersistedSnapshot<MappingRecord>> };
  }[];
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

  // Summary metadata and Mapping diagnostics need canonical records, not JSX
  // repair. Keep each real snapshot (including its token) only until the normal
  // Composition invalidation/refresh boundary. An old promise cannot repopulate
  // a cleared cache when it settles after a newer read.
  let compositionInventory = new Map<string, Promise<PersistedSnapshot<CompositionRecord>>>();
  const inventory = (provider: WorkspaceSummaryIntegration["compositionProviders"][number]) => {
    let pending = compositionInventory.get(provider.descriptor.id);
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const value = await provider.store.snapshot!();
        if (!(typeof value.mutationToken === "string" ? value.mutationToken.length > 0 : Number.isSafeInteger(value.mutationToken) && value.mutationToken >= 0) || !Array.isArray(value.records)
          || value.records.some(record => !validateCompositionRecord(record).ok)
          || new Set(value.records.map(record => record.id)).size !== value.records.length) {
          throw new Error(`Invalid canonical Composition inventory from ${provider.descriptor.id}.`);
        }
        return value;
      });
      compositionInventory.set(provider.descriptor.id, pending);
    }
    return pending;
  };
  const summaryCompositions: MappingCompositionCatalog = {
    ...integration.mappingCompositionCatalog,
    async resolve(ref) {
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).sort().join(",") !== "providerId,recordId"
        || typeof ref.providerId !== "string" || !ref.providerId || !isSafeRecordId(ref.recordId)) {
        return { status: "invalid", reason: "Composition reference is malformed." };
      }
      const provider = integration.compositionProviders.find(candidate => candidate.descriptor.id === ref.providerId);
      if (!provider?.store.snapshot) return integration.mappingCompositionCatalog.resolve(ref);
      try {
        const record = (await inventory(provider)).records.find(candidate => candidate.id === ref.recordId);
        return record ? { status: "resolved", record } : { status: "not-found" };
      } catch (cause) {
        return { status: "provider-error", reason: reason(cause, "Canonical Composition inventory could not be read.") };
      }
    },
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
        summaries = provider.store.snapshot ? (await inventory(provider)).records.map(summarizeComposition) : await provider.store.list();
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

  let mappingInventory = new Map<string, Promise<PersistedSnapshot<MappingRecord>>>();
  const readMappings = (provider: NonNullable<WorkspaceSummaryIntegration["mappingProviders"]>[number]) => {
    let pending = mappingInventory.get(provider.descriptor.id);
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const snapshot = await provider.store.snapshot!();
        if (!(typeof snapshot.mutationToken === "string" ? snapshot.mutationToken.length > 0 : Number.isSafeInteger(snapshot.mutationToken) && snapshot.mutationToken >= 0)
          || !Array.isArray(snapshot.records) || snapshot.records.some(record => !validateMappingRecord(record).ok)
          || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) {
          throw new Error(`Invalid canonical Mapping inventory from ${provider.descriptor.id}.`);
        }
        return snapshot;
      });
      mappingInventory.set(provider.descriptor.id, pending);
    }
    return pending;
  };

  const loadMappings = async (): Promise<MappingsData> => {
    await ensureInitialized();
    const providers = integration.mappingProviders;
    if (providers && (providers.some(provider => !provider.descriptor.id || !provider.descriptor.label) || new Set(providers.map(provider => provider.descriptor.id)).size !== providers.length)) throw new Error("Duplicate Mapping provider identity.");
    const canonical = (providers ?? []).filter(provider => typeof provider.store.snapshot === "function");
    const canonicalIds = new Set(canonical.map(provider => provider.descriptor.id));
    const fallback = !providers || canonical.length !== providers.length ? await integration.mappingCatalog.list() : { entries: [], failures: [] };
    const listing = { entries: fallback.entries.filter(entry => !canonicalIds.has(entry.ref.providerId)) as MappingCatalogEntry[], failures: fallback.failures.filter(failure => !canonicalIds.has(failure.providerId)) };
    const recordsByProvider = new Map<string, readonly MappingRecord[]>();
    for (const provider of canonical) {
      const snapshot = await readMappings(provider);
      recordsByProvider.set(provider.descriptor.id, snapshot.records);
      listing.entries.push(...snapshot.records.map(record => ({ ref: { providerId: provider.descriptor.id, recordId: record.id }, providerLabel: provider.descriptor.label, summary: summarizeMapping(record) }))
        .sort((a, b) => b.summary.updatedAt.localeCompare(a.summary.updatedAt) || a.summary.id.localeCompare(b.summary.id)));
    }
    if (providers) {
      // Catalog lists are grouped in configured provider order. Stable sorting
      // preserves each legacy provider's own ordering within its group.
      const order = new Map(providers.map((provider, index) => [provider.descriptor.id, index]));
      listing.entries.sort((a, b) => (order.get(a.ref.providerId) ?? providers.length) - (order.get(b.ref.providerId) ?? providers.length));
    }
    if (listing.failures.length > 0) {
      throw new Error(listing.failures.map(({ providerLabel, reason: message }) => `${providerLabel}: ${message}`).join("; "));
    }
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let blockedMappings = 0;
    // One evaluation may reference the same model hundreds of times. Preserve
    // the original outcome per qualified owner; do not cache across refreshes.
    const models = new Map<string, ReturnType<ContentCatalog["resolveModel"]>>();
    const content: ContentCatalog = { ...integration.contentCatalog, resolveModel: ref => {
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).sort().join(",") !== "providerId,recordId") return integration.contentCatalog.resolveModel(ref);
      const key = JSON.stringify([ref.providerId, ref.recordId]);
      let pending = models.get(key);
      if (!pending) { pending = integration.contentCatalog.resolveModel(ref); models.set(key, pending); }
      return pending;
    } };
    for (const entry of listing.entries) {
      const href = mappingDeepLinkHref({ providerId: entry.ref.providerId, mappingId: entry.ref.recordId });
      records.push({ kind: "mapping", id: entry.summary.id, label: entry.summary.name, updatedAt: entry.summary.updatedAt, href });
      const captured = recordsByProvider.get(entry.ref.providerId);
      const record = captured?.find(candidate => candidate.id === entry.ref.recordId);
      const resolved = captured ? record ? { status: "resolved" as const, record } : { status: "not-found" as const } : await integration.mappingCatalog.resolve(entry.ref);
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
        { content, compositions: summaryCompositions },
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
    // One domain snapshot per summary refresh; never reused as a write precondition.
    const captured = integration.contentProvider.store.readAll ? structuredClone(await integration.contentProvider.store.readAll()) : null;
    if (integration.contentProvider.store.readAll) validateSummaryContent(captured!, integration.contentProvider.descriptor.id);
    const models = captured ? captured.models.map(summarizeContentModel).sort(compareContentModelsNewestFirst) : await integration.contentProvider.store.listModels();
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let entries = 0;
    let incompleteEntries = 0;
    for (const model of models) {
      const modelIntent: RouteIntent = { route: "content", providerId: integration.contentProvider.descriptor.id, modelId: model.id };
      records.push({ kind: "content-model", id: model.id, label: model.name, updatedAt: model.updatedAt, href: formatIntent(modelIntent), intent: modelIntent });
      const snapshot = captured ? summaryContentEntries(captured, model.id) : await integration.contentProvider.store.scanEntries(model.id);
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
    if (channel === COMPOSITION_FILE_PROVIDER_CHANNEL) { compositionInventory = new Map(); delete cached.compositions; delete cached.mappings; }
    else if (channel === CONTENT_FILE_PROVIDER_DOMAIN) { delete cached.content; delete cached.mappings; }
    else if (channel === MAPPING_FILE_PROVIDER_DOMAIN) { mappingInventory = new Map(); delete cached.mappings; }
    else if (channel === SITEMAP_FILE_PROVIDER_DOMAIN) delete cached.sitemaps;
    else if (channel === ASSET_PERSISTENCE_CHANNEL) delete cached.assets;
    else { cached = {}; compositionInventory = new Map(); mappingInventory = new Map(); } // Workspace selection and legacy broad hints.
    for (const listener of listeners) listener();
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { stopChanges?.(); cached = {}; compositionInventory = new Map(); mappingInventory = new Map(); listeners.clear(); },
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
      compositionInventory = new Map();
      mappingInventory = new Map();
      for (const listener of listeners) listener();
      if (state !== "failed") return;
      state = "idle";
      initialization = undefined;
    },
  };
}

/** Match scanEntries' semantics: invalid saved values are unavailable, not complete. */
function validateSummaryContent(snapshot: ContentSnapshot, providerId: string): void {
  if (!snapshot || typeof snapshot !== "object" || snapshot.providerId !== providerId || !Number.isSafeInteger(snapshot.mutationToken) || snapshot.mutationToken < 0
    || !Array.isArray(snapshot.models) || !Array.isArray(snapshot.entries)
    || snapshot.models.some(model => !validateContentModelRecord(model).ok)
    || snapshot.entries.some(entry => !validateContentEntryRecord(entry).ok)
    || new Set(snapshot.models.map(model => model.id)).size !== snapshot.models.length
    || new Set(snapshot.entries.map(entry => entry.id)).size !== snapshot.entries.length) throw new Error("Invalid canonical Content inventory.");
  const models = new Map(snapshot.models.map(model => [model.id, model]));
  for (const entry of snapshot.entries) {
    const model = models.get(entry.modelId);
    // The existing summary enumerates listed models only, just like scanEntries.
    // An orphan is not a member of any listed model; do not invent a count for it.
    if (!model) continue;
    const issue = contentEntrySemanticIssue(entry, model);
    if (issue) throw new Error(issue);
  }
}
function summaryContentEntries(snapshot: ContentSnapshot, modelId: string) {
  const model = snapshot.models.find(model => model.id === modelId)!;
  const entries = snapshot.entries.filter(entry => entry.modelId === modelId).sort(compareContentEntriesForPaging);
  return { model, count: entries.length, entries, diagnostics: entries.flatMap(entry => diagnoseContentEntryCompleteness(model, entry)) };
}
