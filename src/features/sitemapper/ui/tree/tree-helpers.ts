// Pure traversal helpers for the Sitemapper outline rail (issue #410).
//
// The persisted sitemap is intentionally a small recursive page tree. These
// helpers keep DOM rendering independent from command/controller state and
// make the ordering/boundary rules easy to test without a browser.

import {
  findLocation as findSitemapLocation,
  indexDocument as indexSitemapDocument,
} from "../../../../sitemapper/model";
import type {
  SitemapDocument,
  SitemapDocumentIndex,
  SitemapNode,
  SitemapNodeLocation,
} from "../../../../sitemapper/model";

/** Build one ephemeral location index for a render. */
export function buildDocumentIndex(document: SitemapDocument): SitemapDocumentIndex {
  return indexSitemapDocument(document);
}

/** Total descendants below a page, excluding the page itself. */
export function countDescendants(node: SitemapNode): number {
  return node.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}

export interface SiblingBounds {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * Return whether a page has a previous/next sibling in its current list.
 *
 * Root pages have no sibling in v1, so both controls are disabled. Missing
 * ids are deliberately safe false/false values; the command layer remains the
 * authority for validating an actual mutation.
 */
export function siblingBounds(
  document: SitemapDocument,
  index: SitemapDocumentIndex,
  nodeId: string,
): SiblingBounds {
  const location = index.byId.get(nodeId);
  if (!location) return { canMoveUp: false, canMoveDown: false };
  if (location.parentId === null) return { canMoveUp: false, canMoveDown: false };

  const siblings = index.byId.get(location.parentId)?.node.children;
  if (!siblings) return { canMoveUp: false, canMoveDown: false };

  return {
    canMoveUp: location.index > 0,
    canMoveDown: location.index < siblings.length - 1,
  };
}

/** Find a page location using the supplied index, avoiding a second walk. */
export function findNodeLocation(
  index: SitemapDocumentIndex,
  nodeId: string,
): SitemapNodeLocation | undefined {
  return index.byId.get(nodeId);
}

/**
 * Return the page and its ancestors, nearest first. The root page is included
 * and the virtual root is represented by an empty array for null.
 */
export function ancestorChainIds(document: SitemapDocument, nodeId: string | null): string[] {
  if (nodeId === null) return [];

  const ids: string[] = [];
  let currentId: string | null = nodeId;
  while (currentId !== null) {
    ids.push(currentId);
    currentId = findSitemapLocation(document, currentId)?.parentId ?? null;
  }
  return ids;
}
/** Return visible page ids in pre-order for outline/keyboard consumers. */
export function visibleNodeIds(
  document: SitemapDocument,
  expandedIds: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly SitemapNode[]): void => {
    for (const node of nodes) {
      ids.push(node.id);
      if (expandedIds.has(node.id)) visit(node.children);
    }
  };
  visit(document.root);
  return ids;
}
