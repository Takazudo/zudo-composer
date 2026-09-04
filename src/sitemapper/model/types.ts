// Persisted Sitemapper schema — the recursive, provider-independent page tree.
//
// The root array is a VIRTUAL insertion slot rather than a page node. Keeping
// it as an array preserves an upgrade path while current validation deliberately
// requires exactly one root page. Composition references are provider-qualified
// because record ids are unique only within a provider.

import type { RecordId } from "../../shared";

/** The only Sitemap document schema version understood by this build. */
export const SITEMAP_SCHEMA_VERSION = 2 as const;
export type SitemapSchemaVersion = typeof SITEMAP_SCHEMA_VERSION;

/** A stable reference to a saved Composer composition. */
export interface CompositionRef {
  providerId: string;
  recordId: RecordId;
}

/** A stable reference to a saved Mapping. */
export interface MappingRef {
  providerId: string;
  recordId: RecordId;
}

/** Content field kinds that can be presented verbatim as a plain route title. */
export const SITEMAP_DISPLAY_TITLE_FIELD_KINDS = ["text", "long-text", "slug"] as const;
export type SitemapDisplayTitleFieldKind = (typeof SITEMAP_DISPLAY_TITLE_FIELD_KINDS)[number];

export function isSitemapDisplayTitleFieldKind(kind: string): kind is SitemapDisplayTitleFieldKind {
  return (SITEMAP_DISPLAY_TITLE_FIELD_KINDS as readonly string[]).includes(kind);
}

export type MappingRoute =
  | { kind: "single" }
  | { kind: "entry-field"; fieldId: RecordId; titleFieldId?: RecordId };

/** Every authored page has one explicit, persisted source. */
export type SitemapPageSource =
  | { kind: "unassigned" }
  | { kind: "composition"; ref: CompositionRef }
  | { kind: "mapping"; ref: MappingRef; route: MappingRoute };

/** One authored page in the sitemap tree. Mapping Entries are never persisted here. */
export interface SitemapNode {
  id: string;
  title: string;
  slug?: string;
  source: SitemapPageSource;
  notes?: string;
  children: SitemapNode[];
}

/** The complete persisted Sitemap document. */
export interface SitemapDocument {
  schemaVersion: SitemapSchemaVersion;
  id: string;
  name: string;
  /** Virtual insertion slot. The array itself is never a page node. */
  root: SitemapNode[];
}
