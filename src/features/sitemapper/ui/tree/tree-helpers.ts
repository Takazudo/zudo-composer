// Shared page-tree arithmetic for the Sitemapper surfaces (issue #165).
//
// The outline, the inspector and the delete confirmation all have to say how
// much a page carries with it, and they must agree — a confirmation that
// undercounts is the one place this number matters.

import type { SitemapNode } from "../../../../sitemapper/model";

/** Total pages below this one, excluding the page itself. */
export function countDescendants(node: SitemapNode): number {
  return node.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}
