import type { SitemapDocument, SitemapNode } from "../types";
import { SITEMAP_SCHEMA_VERSION } from "../types";

export function node(
  id: string,
  children: SitemapNode[] = [],
): SitemapNode {
  return { id, title: id, source: { kind: "unassigned" }, children };
}

export function document(root: SitemapNode[] = [node("home")]): SitemapDocument {
  return {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id: "site-map",
    name: "Site map",
    root,
  };
}
