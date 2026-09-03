// The Sitemap document as the shared outline tree sees it (issue #165).
//
// `OutlineTree` knows nothing about Sitemaps: it renders `OutlineNode`s. This
// module is the whole translation, kept pure so the two rules that actually
// decide how the outline behaves are testable without a DOM:
//
//   1. Only a page that ALREADY has children is a `group`. A childless page is
//      a `leaf`, which renders no children list and therefore no terminal
//      "Add page" row — the prototype's shape. A leaf gains its first child
//      through the row's own Add-child action, and the mapping is derived per
//      render, so the page becomes a `group` on the very next one.
//   2. The root page is the `category`. Its children list renders even while it
//      is empty, so a fresh Sitemap still offers somewhere to add the first
//      page.

import type { OutlineNode, OutlineStatus } from "../../../../components/outline-tree";
import type { SitemapDocument, SitemapNode } from "../../../../sitemapper/model";
import { authoredPath } from "../../../../sitemapper/routes";
import { countDescendants } from "./tree-helpers";

/** The dot beside a page: what renders it, or that nothing does yet. */
export function pageOutlineStatus(node: SitemapNode): OutlineStatus {
  switch (node.source.kind) {
    case "composition":
      return { tone: "ok", label: "Composition" };
    case "mapping":
      return { tone: "accent", label: "Mapping route family" };
    case "unassigned":
      return { tone: "warn", label: "Unassigned" };
  }
}

export interface SitemapOutline {
  readonly nodes: readonly OutlineNode[];
  /** The authored route of every page, keyed by page id. */
  readonly routes: ReadonlyMap<string, string>;
}

/** Translate one Sitemap document into outline rows plus their routes. */
export function buildSitemapOutline(document: SitemapDocument): SitemapOutline {
  const routes = new Map<string, string>();

  const visit = (node: SitemapNode, ancestors: readonly string[], depth: number): OutlineNode => {
    const fragments = [...ancestors, node.slug ?? ""];
    const route = authoredPath(fragments);
    routes.set(node.id, route);
    const descendants = countDescendants(node);
    const children = node.children.map((child) => visit(child, fragments, depth + 1));
    return {
      id: node.id,
      kind: depth === 0 ? "category" : children.length > 0 ? "group" : "leaf",
      title: node.title,
      slug: route,
      status: pageOutlineStatus(node),
      ...(descendants > 0 ? { count: descendants } : {}),
      children,
    };
  };

  return { nodes: document.root.map((node) => visit(node, [], 0)), routes };
}
