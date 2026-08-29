// Ephemeral Sitemapper traversal index — fast locations without persisted refs.
//
// Persistence remains a recursive tree so parent links cannot dangle. Commands
// may build this throwaway pre-order index and treat duplicate ids as a broken
// invariant rather than attempting to choose one ambiguous node.

import type { SitemapDocument, SitemapNode } from "./types";

/** Where one node sits. `parentId: null` means the virtual root slot. */
export interface SitemapNodeLocation {
  node: SitemapNode;
  parentId: string | null;
  index: number;
  depth: number;
}

/** Fast lookup plus canonical pre-order node ids. */
export interface SitemapDocumentIndex {
  byId: Map<string, SitemapNodeLocation>;
  order: string[];
}

/** Visit every page in pre-order; the virtual root is not visited. */
export function traverse(
  document: SitemapDocument,
  visit: (node: SitemapNode, location: SitemapNodeLocation) => void,
): void {
  const walk = (
    children: readonly SitemapNode[],
    parentId: string | null,
    depth: number,
  ): void => {
    children.forEach((node, index) => {
      visit(node, { node, parentId, index, depth });
      walk(node.children, node.id, depth + 1);
    });
  };

  walk(document.root, null, 0);
}

/** Build an ephemeral index, throwing when globally unique ids are violated. */
export function indexDocument(document: SitemapDocument): SitemapDocumentIndex {
  const byId = new Map<string, SitemapNodeLocation>();
  const order: string[] = [];

  traverse(document, (node, location) => {
    if (byId.has(node.id)) {
      throw new Error(`Duplicate node id "${node.id}" in Sitemap document`);
    }
    byId.set(node.id, location);
    order.push(node.id);
  });

  return { byId, order };
}

/** Return canonical page ids in parent-before-children order. */
export function traversalOrder(document: SitemapDocument): string[] {
  return indexDocument(document).order;
}

/** Resolve one node and its location, or `undefined` when it is absent. */
export function findLocation(
  document: SitemapDocument,
  nodeId: string,
): SitemapNodeLocation | undefined {
  return indexDocument(document).byId.get(nodeId);
}
