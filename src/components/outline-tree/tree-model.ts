/**
 * Outline tree geometry and navigation, as pure functions.
 *
 * Connector geometry, insert-point indices and the keyboard order are all
 * index arithmetic over the node list, so they are unit-tested without a DOM
 * and the component keeps only the rendering.
 */

import type { OutlineInsertTarget, OutlineNode } from "./types";

export function childrenOf(node: OutlineNode): readonly OutlineNode[] {
  return node.children ?? [];
}

/**
 * `kind` is the authority, not the data: a node declared a leaf never expands,
 * so the flattened keyboard order can never disagree with what is rendered.
 */
export function isExpandable(node: OutlineNode): boolean {
  return node.kind !== "leaf" && childrenOf(node).length > 0;
}

/** One visible row, with everything the row and the keyboard map need. */
export interface OutlineRowPosition {
  node: OutlineNode;
  /** 0 for a root; children of a node at depth d are at depth d + 1. */
  depth: number;
  parentId: string | null;
  index: number;
  siblingCount: number;
  expandable: boolean;
  expanded: boolean;
}

/** Rows in DOM order, skipping everything under a collapsed node. */
export function flattenVisibleRows(
  nodes: readonly OutlineNode[],
  expandedIds: ReadonlySet<string>,
): OutlineRowPosition[] {
  const rows: OutlineRowPosition[] = [];
  const walk = (list: readonly OutlineNode[], depth: number, parentId: string | null) => {
    list.forEach((node, index) => {
      const expandable = isExpandable(node);
      const expanded = expandable && expandedIds.has(node.id);
      rows.push({ node, depth, parentId, index, siblingCount: list.length, expandable, expanded });
      if (expanded) walk(childrenOf(node), depth + 1, node.id);
    });
  };
  walk(nodes, 0, null);
  return rows;
}

/** Every node that owns children — what Collapse all / Open all act on. */
export function collectExpandableIds(nodes: readonly OutlineNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly OutlineNode[]) => {
    for (const node of list) {
      if (!isExpandable(node)) continue;
      ids.push(node.id);
      walk(childrenOf(node));
    }
  };
  walk(nodes);
  return ids;
}

export function findRowIndex(rows: readonly OutlineRowPosition[], id: string): number {
  return rows.findIndex((row) => row.node.id === id);
}

/**
 * Which element closes a children list and so carries `is-last` — the class
 * that stops the dashed vline at the hline. A rendered terminal "Add …" row is
 * last, so the node above it must not claim the class as well.
 */
export function isLastInList(index: number, count: number, hasAddRow: boolean): boolean {
  return !hasAddRow && index === count - 1;
}

/** The `a` / `+` keyboard target: a new sibling directly below the row. */
export function insertTargetAfter(row: OutlineRowPosition): OutlineInsertTarget {
  return { parentId: row.parentId, index: row.index + 1 };
}

export function isSameTarget(a: OutlineInsertTarget | null, b: OutlineInsertTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.parentId === b.parentId && a.index === b.index;
}
