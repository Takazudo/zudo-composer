// Persisted Sitemapper schema — the recursive, provider-independent page tree.
//
// The root array is a VIRTUAL insertion slot rather than a page node. Keeping
// it as an array preserves an upgrade path while v1 validation deliberately
// requires exactly one root page. Composition references are provider-qualified
// because record ids are unique only within a provider.

import type { RecordId } from "../../shared";

/** The only Sitemap document schema version understood by this build. */
export const SITEMAP_SCHEMA_VERSION = 1 as const;
export type SitemapSchemaVersion = typeof SITEMAP_SCHEMA_VERSION;

/** A stable reference to a saved Composer composition. */
export interface CompositionRef {
  providerId: string;
  recordId: RecordId;
}

/** One persisted page in the sitemap tree. */
export interface SitemapNode {
  id: string;
  title: string;
  slug?: string;
  composition?: CompositionRef;
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
