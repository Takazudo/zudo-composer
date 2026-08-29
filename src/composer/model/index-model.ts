// Ephemeral traversal + index for fast commands.
//
// Builds a throwaway id → location map over a `CompositionDocument` so commands
// can resolve a node's parent, slot, and sibling index in O(1). This index is
// NEVER persisted — persistence keeps the recursive tree; normalising it into
// flat rows with parent-id references would create the dangling-reference class
// the epic explicitly forbids.

import type {
  ComponentCatalog,
  ComponentDefinition,
  CompositionDocument,
  CompositionNode,
} from "./types";
import { VIRTUAL_ROOT_SLOT_ID } from "./types";

/** Where a single node sits in the tree. `parentId: null` = the virtual root. */
export interface NodeLocation {
  node: CompositionNode;
  parentId: string | null;
  slotId: string;
  index: number;
  depth: number;
}

/** The ephemeral index over a document. */
export interface DocumentIndex {
  /** Node id → its location. */
  byId: Map<string, NodeLocation>;
  /** Pre-order node ids, in canonical (slot-declaration) order. */
  order: string[];
}

/**
 * Canonical slot ordering for a node: declared slots first (in manifest
 * declaration order), then any extra slot ids present on the node but not
 * declared (opaque/removed slots) appended in stable alphabetical order. The
 * traversal AND the JSX generator both use this so tree order and source order
 * agree for named-slot fixtures (an acceptance requirement).
 */
export function orderedSlotIds(
  node: CompositionNode,
  entry: ComponentDefinition | undefined,
): string[] {
  const present = Object.keys(node.slots);
  const declared = (entry?.slots ?? []).map((s) => s.id).filter((id) => id in node.slots);
  const declaredSet = new Set(declared);
  const extra = present.filter((id) => !declaredSet.has(id)).sort();
  return [...declared, ...extra];
}

/**
 * Pre-order visit of every node. `visit` receives the node and its location.
 * Children within a node are traversed in canonical slot order (see
 * `orderedSlotIds`) so the flattened order is deterministic and matches source
 * generation. The virtual root is not itself visited (it is not a node).
 */
export function traverse(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  visit: (node: CompositionNode, location: NodeLocation) => void,
): void {
  const walk = (
    children: CompositionNode[],
    parentId: string | null,
    slotId: string,
    depth: number,
  ): void => {
    children.forEach((node, index) => {
      visit(node, { node, parentId, slotId, index, depth });
      const entry = manifest.get(node.componentId);
      for (const childSlotId of orderedSlotIds(node, entry)) {
        walk(node.slots[childSlotId] ?? [], node.id, childSlotId, depth + 1);
      }
    });
  };
  walk(document.root, null, VIRTUAL_ROOT_SLOT_ID, 0);
}

/** Builds the ephemeral index. Throws on duplicate ids (a broken invariant). */
export function indexDocument(
  document: CompositionDocument,
  manifest: ComponentCatalog,
): DocumentIndex {
  const byId = new Map<string, NodeLocation>();
  const order: string[] = [];
  traverse(document, manifest, (node, location) => {
    if (byId.has(node.id)) {
      throw new Error(`Duplicate node id "${node.id}" in Composition document`);
    }
    byId.set(node.id, location);
    order.push(node.id);
  });
  return { byId, order };
}

/**
 * Pre-order node ids in canonical order. This is the "tree traversal order"
 * that must equal the JSX generator's emitted-node order for the A/B/C fixture.
 */
export function traversalOrder(
  document: CompositionDocument,
  manifest: ComponentCatalog,
): string[] {
  return indexDocument(document, manifest).order;
}

/** Resolve a node (and its location) by id, or `undefined` if absent. */
export function findLocation(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
): NodeLocation | undefined {
  return indexDocument(document, manifest).byId.get(nodeId);
}
