import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";

export function page(
  id: string,
  title = id,
  children: SitemapNode[] = [],
): SitemapNode {
  return { id, title, children };
}

export function fixtureDocument(): SitemapDocument {
  return {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id: "tree-test",
    name: "Tree test",
    root: [
      page("home", "Home", [
        page("about", "About", [page("team", "Team")]),
        page("contact", "Contact"),
      ]),
    ],
  };
}
