// One read model over every authoring provider, for the Home dashboard and any
// other surface that needs "what is in this workspace right now".
//
// Two rules shape the design:
//
//   1. Sources resolve INDEPENDENTLY. IndexedDB cannot transact across the four
//      authoring databases and the Media provider is a separate dev service, so
//      a single failure must degrade one panel rather than blank the dashboard.
//      Every source therefore returns `ok` or `unavailable` on its own.
//   2. Provider initialization happens ONCE per summary. `refresh()` re-reads
//      the providers; it never re-runs the lifecycle, so a refresh can never
//      re-seed, re-verify, or restart the SiteProject integration.
//
// SiteProject delivery routes (`/site*`) are deliberately absent: they render
// outside the CMS chrome and are not authoring records.

import type { CompositionSummary } from "../composer/browser";
import type { ContentCatalog } from "../content/catalog";
import type { ContentEntryRecord, ContentModelRecord } from "../content/model";
import type { ContentStore } from "../content/library";
import type { ComponentCatalog } from "../composer/model/types";
import { mappingDeepLinkHref } from "../features/mapping/deep-link";
import type { MediaStore } from "../media";
import { resolveMappingDefinition, type CompositionCatalog as MappingCompositionCatalog, type MappingCatalog } from "../mapping";
import { isSafeRecordId, type RecordId } from "../shared";
import type { SitemapRecord, SitemapStore } from "../sitemapper/library";
import type { SitemapNode } from "../sitemapper/model";
import { formatIntent, type RouteIntent } from "./route-intents";

/** One provider read that succeeded, or the reason it could not be read. */
export type WorkspaceSource<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "unavailable"; readonly error: string };

export type WorkspaceSourceName = "compositions" | "mappings" | "sitemaps" | "content" | "media";

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
export interface MediaCounts {
  readonly assets: number;
  readonly bytes: number;
  /** Keyed by the provider's media type, e.g. `image/png`. */
  readonly byType: Readonly<Record<string, number>>;
}

export interface WorkspaceCounts {
  readonly compositions: WorkspaceSource<CompositionCounts>;
  readonly mappings: WorkspaceSource<MappingCounts>;
  readonly sitemaps: WorkspaceSource<SitemapCounts>;
  readonly content: WorkspaceSource<ContentCounts>;
  readonly media: WorkspaceSource<MediaCounts>;
}

export type WorkspaceRecordKind =
  | "composition"
  | "pattern"
  | "global-template"
  | "mapping"
  | "sitemap"
  | "content-model"
  | "content-entry"
  | "media";

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

/**
 * The structural slice of `ProductionProviderIntegration` this read model uses.
 * Naming it here keeps the summary testable with plain fakes and keeps the
 * integration free to grow.
 */
export interface WorkspaceSummaryIntegration {
  readonly initialization: { initialize(): Promise<{ status: "ready" } | { status: "error"; error: Error }> };
  readonly componentProvider: { readonly catalog: ComponentCatalog };
  readonly compositionProviders: readonly {
    readonly descriptor: { readonly id: string; readonly label: string };
    readonly store: { list(): Promise<readonly CompositionSummary[]> };
  }[];
  readonly contentProvider: { readonly store: Pick<ContentStore, "listModels" | "scanEntries"> };
  readonly contentCatalog: ContentCatalog;
  readonly mappingCatalog: MappingCatalog;
  readonly mappingCompositionCatalog: MappingCompositionCatalog;
  readonly sitemapProvider: { readonly store: WorkspaceSitemapStore };
  readonly mediaProvider: { readonly store: Pick<MediaStore, "list"> } | undefined;
}

export interface WorkspaceSummary {
  counts(): Promise<WorkspaceCounts>;
  recent(limit?: number): Promise<WorkspaceRecent>;
  attention(): Promise<WorkspaceAttention>;
  /** Drop the memoised provider reads; the next call re-reads them. */
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
interface MediaData {
  readonly counts: MediaCounts;
  readonly records: readonly WorkspaceRecord[];
}

interface WorkspaceData {
  readonly compositions: WorkspaceSource<CompositionsData>;
  readonly mappings: WorkspaceSource<MappingsData>;
  readonly sitemaps: WorkspaceSource<SitemapsData>;
  readonly content: WorkspaceSource<ContentData>;
  readonly media: WorkspaceSource<MediaData>;
}

function reason(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function project<A, B>(source: WorkspaceSource<A>, map: (value: A) => B): WorkspaceSource<B> {
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
  // and one set of provider reads. A rejection is memoised too: initialization
  // is attempted exactly once per summary, `refresh()` included.
  let initialization: Promise<void> | undefined;
  const ensureInitialized = (): Promise<void> => (initialization ??= (async () => {
    const outcome = await integration.initialization.initialize();
    if (outcome.status === "error") throw outcome.error;
  })());

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
    const sitemaps = await readSitemapRecords(integration.sitemapProvider.store);
    const records: WorkspaceRecord[] = [];
    const attention: WorkspaceAttentionItem[] = [];
    let pages = 0;
    let unassignedPages = 0;
    for (const sitemap of sitemaps) {
      const intent: RouteIntent = { route: "sitemapper", sitemapId: sitemap.id };
      records.push({ kind: "sitemap", id: sitemap.id, label: sitemap.document.name, updatedAt: sitemap.updatedAt, href: formatIntent(intent), intent });
      for (const page of flattenPages(sitemap.document.root)) {
        pages += 1;
        if (page.source.kind !== "unassigned") continue;
        unassignedPages += 1;
        // A page id is provider-generated; only a URL-safe one can carry a page intent.
        const pageIntent: RouteIntent = isSafeRecordId(page.id) ? { route: "sitemapper", sitemapId: sitemap.id, pageId: page.id } : intent;
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
      const modelIntent: RouteIntent = { route: "content", modelId: model.id };
      records.push({ kind: "content-model", id: model.id, label: model.name, updatedAt: model.updatedAt, href: formatIntent(modelIntent), intent: modelIntent });
      const snapshot = await integration.contentProvider.store.scanEntries(model.id);
      entries += snapshot.count;
      const labels = new Map<RecordId, string>();
      for (const entry of snapshot.entries) {
        const label = entryLabel(snapshot.model, entry);
        labels.set(entry.id, label);
        const entryIntent: RouteIntent = { route: "content", modelId: model.id, entryId: entry.id };
        records.push({ kind: "content-entry", id: entry.id, label, updatedAt: entry.updatedAt, href: formatIntent(entryIntent), intent: entryIntent });
      }
      const firstDiagnosticByEntry = new Map<RecordId, string>();
      for (const diagnostic of snapshot.diagnostics) {
        if (!firstDiagnosticByEntry.has(diagnostic.entryId)) firstDiagnosticByEntry.set(diagnostic.entryId, diagnostic.message);
      }
      incompleteEntries += firstDiagnosticByEntry.size;
      for (const [entryId, detail] of firstDiagnosticByEntry) {
        const entryIntent: RouteIntent = { route: "content", modelId: model.id, entryId };
        attention.push({ kind: "incomplete-entry", id: entryId, label: labels.get(entryId) ?? entryId, detail, href: formatIntent(entryIntent), intent: entryIntent });
      }
    }
    return { counts: { models: models.length, entries, incompleteEntries }, records, attention };
  };

  // Media is a separate provider with its own lifecycle, so it deliberately does
  // not wait on — or fail with — the SiteProject integration.
  const loadMedia = async (): Promise<MediaData> => {
    const provider = integration.mediaProvider;
    if (!provider) throw new Error("No Media provider is connected.");
    const summaries = await provider.store.list();
    const byType: Record<string, number> = {};
    let bytes = 0;
    const records: WorkspaceRecord[] = [];
    for (const summary of summaries) {
      bytes += summary.byteLength;
      byType[summary.mediaType] = (byType[summary.mediaType] ?? 0) + 1;
      const intent: RouteIntent = { route: "media", assetId: summary.id };
      records.push({ kind: "media", id: summary.id, label: summary.fileName, updatedAt: summary.updatedAt, href: formatIntent(intent), intent });
    }
    return { counts: { assets: summaries.length, bytes, byType }, records };
  };

  const guard = async <T>(fallback: string, load: () => Promise<T>): Promise<WorkspaceSource<T>> => {
    try {
      return { status: "ok", value: await load() };
    } catch (cause) {
      return { status: "unavailable", error: reason(cause, fallback) };
    }
  };

  let pending: Promise<WorkspaceData> | undefined;
  const read = (): Promise<WorkspaceData> => (pending ??= (async () => {
    const [compositions, mappings, sitemaps, content, media] = await Promise.all([
      guard("Compositions could not be read.", loadCompositions),
      guard("Mappings could not be read.", loadMappings),
      guard("Sitemaps could not be read.", loadSitemaps),
      guard("Content could not be read.", loadContent),
      guard("Media could not be read.", loadMedia),
    ]);
    return { compositions, mappings, sitemaps, content, media };
  })());

  return {
    async counts() {
      const data = await read();
      return {
        compositions: project(data.compositions, ({ counts }) => counts),
        mappings: project(data.mappings, ({ counts }) => counts),
        sitemaps: project(data.sitemaps, ({ counts }) => counts),
        content: project(data.content, ({ counts }) => counts),
        media: project(data.media, ({ counts }) => counts),
      };
    },
    async recent(limit = DEFAULT_RECENT_LIMIT) {
      const data = await read();
      const records: WorkspaceRecord[] = [];
      const unavailable: WorkspaceSourceFailure[] = [];
      for (const source of ["compositions", "mappings", "sitemaps", "content", "media"] as const) {
        const entry = data[source];
        if (entry.status === "ok") records.push(...entry.value.records);
        else unavailable.push({ source, error: entry.error });
      }
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
      pending = undefined;
    },
  };
}
