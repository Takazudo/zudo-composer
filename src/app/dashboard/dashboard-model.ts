// Presentation derivations for the Dashboard (issue #173).
//
// `workspace-summary.ts` answers *what is in the workspace*; this module turns
// that into *what the page says*, and nothing here reads a provider. Keeping
// the arithmetic and the wording out of the component is what makes the
// "never invent a number" rule checkable: an unavailable source can only reach
// the page as an `unavailable` card, never as a zero.

import {
  ComposerIcon,
  ContentIcon,
  FileIcon,
  FolderIcon,
  MappingIcon,
  SitemapperIcon,
  type IconComponent,
} from "../../components/icons";
import type {
  ContentCounts,
  MediaCounts,
  WorkspaceAttention,
  WorkspaceAttentionItem,
  WorkspaceAttentionKind,
  WorkspaceCounts,
  WorkspaceRecent,
  WorkspaceRecordKind,
  WorkspaceSource,
  WorkspaceSourceFailure,
  WorkspaceSourceName,
} from "../workspace-summary";

/** How each source is named when the page has to talk about it failing. */
export const SOURCE_LABELS: Record<WorkspaceSourceName, string> = {
  content: "Content",
  media: "Media",
  compositions: "Compositions",
  mappings: "Mappings",
  sitemaps: "Sitemaps",
};

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The same ladder the Media route prints. It is duplicated rather than imported
 * because `src/features/media` is a barrel over the whole upload/controller
 * feature, and the Home route must not pull that graph in for one number.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

/**
 * `byType` is keyed by raw media type, so the split is folded into the three
 * groups an author recognises rather than printing `image/png · image/jpeg`.
 */
export function mediaTypeSummary(byType: MediaCounts["byType"]): readonly string[] {
  let images = 0;
  let pdfs = 0;
  let other = 0;
  for (const [mediaType, count] of Object.entries(byType)) {
    if (mediaType.startsWith("image/")) images += count;
    else if (mediaType === "application/pdf") pdfs += count;
    else other += count;
  }
  const parts: string[] = [];
  if (images > 0) parts.push(countLabel(images, "image"));
  if (pdfs > 0) parts.push(`${pdfs} PDF${pdfs === 1 ? "" : "s"}`);
  if (other > 0) parts.push(countLabel(other, "other file"));
  return parts;
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

interface RecordKindPresentation {
  readonly label: string;
  readonly icon: IconComponent;
  /** `accent` marks a publication kind; everything else is a plain tag. */
  readonly accent?: true;
}

const RECORD_KINDS: Record<WorkspaceRecordKind, RecordKindPresentation> = {
  "content-model": { label: "Content model", icon: ContentIcon },
  "content-entry": { label: "Entry", icon: FileIcon },
  media: { label: "Media", icon: FileIcon },
  composition: { label: "Composition", icon: ComposerIcon },
  pattern: { label: "Pattern", icon: ComposerIcon, accent: true },
  "global-template": { label: "Global template", icon: ComposerIcon, accent: true },
  mapping: { label: "Mapping", icon: MappingIcon },
  sitemap: { label: "Sitemap", icon: SitemapperIcon },
};

export function recordKindPresentation(kind: WorkspaceRecordKind): RecordKindPresentation {
  return RECORD_KINDS[kind];
}

/* --------------------------------------------------------------------------
 * Stat cards
 * -------------------------------------------------------------------------- */

interface StatCardIdentity {
  readonly id: WorkspaceSourceName;
  readonly label: string;
  readonly href: string;
  readonly icon: IconComponent;
}

interface StatCardFigures {
  readonly value: number;
  /** Rendered small beside the number where the card label is not the unit. */
  readonly unit?: string;
  readonly detail: readonly string[];
  /** A non-zero backlog; the card renders it as a warning chip. */
  readonly alert?: string;
}

export type StatCard = StatCardIdentity &
  (({ readonly status: "ok" } & StatCardFigures) | { readonly status: "unavailable"; readonly error: string });

function statCard<T>(identity: StatCardIdentity, source: WorkspaceSource<T>, figures: (value: T) => StatCardFigures): StatCard {
  return source.status === "ok"
    ? { ...identity, status: "ok", ...figures(source.value) }
    : { ...identity, status: "unavailable", error: source.error };
}

function nonZero(count: number, suffix: string): string | undefined {
  return count > 0 ? `${count} ${suffix}` : undefined;
}

/** The five cards, in the order the prototype reads them. */
export function statCards(counts: WorkspaceCounts): readonly StatCard[] {
  return [
    statCard({ id: "content", label: "Content", href: "/content", icon: ContentIcon }, counts.content, (value) => ({
      value: value.entries,
      unit: value.entries === 1 ? "entry" : "entries",
      detail: [countLabel(value.models, "model")],
      alert: nonZero(value.incompleteEntries, "incomplete"),
    })),
    statCard({ id: "media", label: "Media", href: "/media", icon: FolderIcon }, counts.media, (value) => ({
      value: value.assets,
      unit: value.assets === 1 ? "asset" : "assets",
      detail: [...mediaTypeSummary(value.byType), formatByteSize(value.bytes)],
    })),
    statCard({ id: "compositions", label: "Compositions", href: "/composer", icon: ComposerIcon }, counts.compositions, (value) => ({
      value: value.compositions,
      detail: [countLabel(value.patterns, "pattern"), countLabel(value.globalTemplates, "global template")],
    })),
    statCard({ id: "mappings", label: "Mappings", href: "/mapping", icon: MappingIcon }, counts.mappings, (value) => ({
      value: value.mappings,
      detail: [],
      alert: nonZero(value.blockedMappings, "blocked"),
    })),
    statCard({ id: "sitemaps", label: "Sitemaps", href: "/sitemapper", icon: SitemapperIcon }, counts.sitemaps, (value) => ({
      value: value.sitemaps,
      detail: [countLabel(value.pages, "page")],
      alert: nonZero(value.unassignedPages, "unassigned"),
    })),
  ];
}

/**
 * A workspace nobody has authored into yet.
 *
 * An authoring source that could not be read might hold records, so it is never
 * counted as empty. Media is the one exception: "no Media provider is
 * connected" is the ordinary dev answer and means there are no assets to show,
 * not that the answer is unknown.
 */
export function isEmptyWorkspace(counts: WorkspaceCounts): boolean {
  return (
    counts.content.status === "ok" &&
    counts.content.value.models === 0 &&
    counts.content.value.entries === 0 &&
    counts.compositions.status === "ok" &&
    counts.compositions.value.compositions === 0 &&
    counts.mappings.status === "ok" &&
    counts.mappings.value.mappings === 0 &&
    counts.sitemaps.status === "ok" &&
    counts.sitemaps.value.sitemaps === 0 &&
    (counts.media.status !== "ok" || counts.media.value.assets === 0)
  );
}

/* --------------------------------------------------------------------------
 * Needs attention
 * -------------------------------------------------------------------------- */

interface AttentionPresentation {
  readonly icon: IconComponent;
  /** The verb on the row's link; it says what the target route is for. */
  readonly action: string;
}

const ATTENTION_KINDS: Record<WorkspaceAttentionKind, AttentionPresentation> = {
  "blocked-mapping": { icon: MappingIcon, action: "Fix" },
  "unassigned-page": { icon: SitemapperIcon, action: "Assign" },
  "incomplete-entry": { icon: ContentIcon, action: "Review" },
};

export function attentionPresentation(kind: WorkspaceAttentionKind): AttentionPresentation {
  return ATTENTION_KINDS[kind];
}

export interface AttentionView {
  /** Blocking first, then unassigned pages, then incomplete entries. */
  readonly rows: readonly WorkspaceAttentionItem[];
  readonly total: number;
  /** How many of `total` the cap left off the page. */
  readonly hidden: number;
  readonly unavailable: readonly WorkspaceSourceFailure[];
}

export const ATTENTION_ROW_LIMIT = 6;

export function attentionView(attention: WorkspaceAttention, limit: number = ATTENTION_ROW_LIMIT): AttentionView {
  const rows: WorkspaceAttentionItem[] = [];
  const unavailable: WorkspaceSourceFailure[] = [];
  for (const source of ["mappings", "sitemaps", "content"] as const) {
    const entry = attention[source];
    if (entry.status === "ok") rows.push(...entry.value);
    else unavailable.push({ source, error: entry.error });
  }
  const capped = rows.slice(0, Math.max(0, limit));
  return { rows: capped, total: rows.length, hidden: rows.length - capped.length, unavailable };
}

/* --------------------------------------------------------------------------
 * "How the pieces connect" and Storage
 * -------------------------------------------------------------------------- */

export interface PipelineStage {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: IconComponent;
  readonly href: string;
  /** Omitted where the stage's source could not be read. */
  readonly count?: string;
}

function stageCount<T>(source: WorkspaceSource<T> | undefined, label: (value: T) => string): string | undefined {
  return source?.status === "ok" ? label(source.value) : undefined;
}

/**
 * The authoring chain, in the order a record travels through it. The stages are
 * the one part of the page whose text owes nothing to a provider, so `null`
 * counts render the explainer with every count simply left off.
 */
export function pipelineStages(counts: WorkspaceCounts | null): readonly PipelineStage[] {
  return [
    {
      id: "content",
      label: "Content",
      description: "Models define the fields; entries hold the values.",
      icon: ContentIcon,
      href: "/content",
      count: stageCount<ContentCounts>(counts?.content, (value) => countLabel(value.models, "model")),
    },
    {
      id: "mapping",
      label: "Mapping",
      description: "Binds entry fields to Composition props.",
      icon: MappingIcon,
      href: "/mapping",
      count: stageCount(counts?.mappings, (value) => countLabel(value.mappings, "mapping")),
    },
    {
      id: "composition",
      label: "Composition",
      description: "Reusable page structure built from provider components.",
      icon: ComposerIcon,
      href: "/composer",
      count: stageCount(counts?.compositions, (value) => countLabel(value.compositions, "composition")),
    },
    {
      id: "sitemap",
      label: "Sitemap",
      description: "Places Compositions or Mappings on routes.",
      icon: SitemapperIcon,
      href: "/sitemapper",
      count: stageCount(counts?.sitemaps, (value) => countLabel(value.sitemaps, "sitemap")),
    },
  ];
}

export type LastWrite =
  | { readonly status: "known"; readonly at: string }
  /** Every source answered and none of them holds a record. */
  | { readonly status: "none" }
  /** At least one source could not be read, so the newest write is not known. */
  | { readonly status: "unknown" };

export function lastWrite(recent: WorkspaceRecent): LastWrite {
  const newest = recent.records[0];
  if (newest) return { status: "known", at: newest.updatedAt };
  return recent.unavailable.length > 0 ? { status: "unknown" } : { status: "none" };
}
