// The Composition document as the shared `OutlineTree` sees it (epic #156).
//
// `OutlineTree` renders `OutlineNode`s and knows nothing about compositions.
// This module is the whole translation, kept pure so the rules that decide how
// the structure rail behaves are testable without a DOM:
//
//   1. The document is the `category`: its slug is the composition id and its
//      count is every component in it.
//   2. A component that declares slots is a `group` whose children are its
//      slots; a component with none is a `leaf`.
//   3. A slot is a `group` with `variant: "slot"` — the quiet row the outline
//      draws for a container's named region. Its children are the components
//      inside it, so a component never parents a component directly.
//
// Slot rows have no id of their own in the document, so this module mints one
// and hands back the `rows` lookup that turns any outline id — including the
// document row — back into the thing it stands for.

import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionNode,
  InsertionTarget,
} from "../../../../composer/browser";
import { findLocation, isPublishedOutletTarget, orderedSlotIds, VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import type { OutlineNode } from "../../../../components/outline-tree";
import type { ComponentDefinition } from "../../active-pack";
import { countDescendants, summarizeNode } from "./tree-helpers";

/** The outline id of the document row. A node id is a UUID, so this cannot collide. */
export const DOCUMENT_ROW_ID = "composer:document";

const SLOT_ROW_PREFIX = "composer:slot:";

/** The outline id of one component's named slot. */
export function slotRowId(parentId: string, slotId: string): string {
  return `${SLOT_ROW_PREFIX}${parentId}:${slotId}`;
}

export interface ComposerSlotRow {
  kind: "slot";
  parentId: string;
  slotId: string;
  /** The slot's human label, e.g. "Content". */
  label: string;
  /** How many components it holds — the insert index of the terminal Add row. */
  childCount: number;
  /** False when the slot is full, unavailable, or a published template outlet. */
  canAdd: boolean;
  /** True for a slot that is empty and could be published as a named outlet. */
  outletCandidate: boolean;
  /** True for the slot this composition already publishes as its outlet. */
  isOutlet: boolean;
}

export type ComposerOutlineRow =
  | { kind: "document"; childCount: number }
  | { kind: "component"; nodeId: string }
  | ComposerSlotRow;

export interface ComposerOutline {
  readonly nodes: readonly OutlineNode[];
  /** Every outline row id, including the document and slot rows. */
  readonly rows: ReadonlyMap<string, ComposerOutlineRow>;
  /** Every row that can be opened and closed, in render order. */
  readonly expandableIds: readonly string[];
  /** Total component count, shown on the document row and the pane header. */
  readonly total: number;
}

export interface BuildComposerOutlineOptions {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  /** The richer catalog, for component titles. */
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  /** Suppresses every Add affordance — Preview mode and linked documents. */
  readOnly?: boolean;
}

/** Translate one composition into outline rows plus the lookup back to the document. */
export function buildComposerOutline({
  document,
  manifest,
  catalogById,
  readOnly = false,
}: BuildComposerOutlineOptions): ComposerOutline {
  const rows = new Map<string, ComposerOutlineRow>();
  const expandableIds: string[] = [];

  const visitComponent = (node: CompositionNode): OutlineNode => {
    rows.set(node.id, { kind: "component", nodeId: node.id });
    const summary = summarizeNode(node, manifest, catalogById);
    const entry = manifest.get(node.componentId);
    const slotIds = orderedSlotIds(node, entry);
    const base = {
      id: node.id,
      title: summary.title,
      ...(summary.subtitle === null ? {} : { hint: summary.subtitle }),
      ...(summary.opaque ? { tag: "Unavailable" } : {}),
    };

    if (slotIds.length === 0) return { ...base, kind: "leaf" };

    expandableIds.push(node.id);
    const descendants = countDescendants(node);
    return {
      ...base,
      kind: "group",
      ...(descendants > 0 ? { count: descendants } : {}),
      children: slotIds.map((slotId) => visitSlot(node, slotId, summary.opaque)),
    };
  };

  const visitSlot = (parent: CompositionNode, slotId: string, parentOpaque: boolean): OutlineNode => {
    const entry = manifest.get(parent.componentId);
    const slotMeta = entry?.slots.find((slot) => slot.id === slotId);
    const children = parent.slots[slotId] ?? [];
    const label = slotMeta?.label ?? `${slotId} (unavailable)`;
    const isOutlet = isPublishedOutletTarget(document, parent.id, slotId);
    const canAdd =
      !readOnly &&
      !parentOpaque &&
      slotMeta !== undefined &&
      !isOutlet &&
      !(slotMeta.cardinality === "single" && children.length >= 1);

    const id = slotRowId(parent.id, slotId);
    rows.set(id, {
      kind: "slot",
      parentId: parent.id,
      slotId,
      label,
      childCount: children.length,
      canAdd,
      outletCandidate: slotMeta !== undefined && !parentOpaque && children.length === 0 && !isOutlet,
      isOutlet,
    });
    expandableIds.push(id);

    return {
      id,
      kind: "group",
      variant: "slot",
      title: label,
      slug: "slot",
      count: children.length,
      ...(isOutlet ? { tag: "Outlet" } : {}),
      children: children.map(visitComponent),
    };
  };

  const children = document.root.map(visitComponent);
  const total = document.root.reduce((sum, node) => sum + 1 + countDescendants(node), 0);
  rows.set(DOCUMENT_ROW_ID, { kind: "document", childCount: document.root.length });
  expandableIds.unshift(DOCUMENT_ROW_ID);

  return {
    nodes: [
      {
        id: DOCUMENT_ROW_ID,
        kind: "category",
        title: "Document",
        slug: document.id,
        count: total,
        children,
      },
    ],
    rows,
    expandableIds,
    total,
  };
}

/**
 * The document insertion this outline row's children list stands for, or null
 * when nothing can be inserted there. A component group parents slots, not
 * components, so it never yields one.
 */
export function insertionTargetFor(
  outline: ComposerOutline,
  parentRowId: string | null,
  index: number,
): InsertionTarget | null {
  if (parentRowId === null) return null;
  const row = outline.rows.get(parentRowId);
  if (row === undefined) return null;
  if (row.kind === "document") return { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index };
  if (row.kind === "slot") return row.canAdd ? { parentId: row.parentId, slotId: row.slotId, index } : null;
  return null;
}

/**
 * Every row that has to be open for `nodeId` to be visible: its ancestor
 * components, the slots they sit in, and the document row. Nearest first.
 */
export function ancestorRowIds(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  nodeId: string,
): string[] {
  const ids: string[] = [];
  let current: string | null = nodeId;
  while (current !== null) {
    const location = findLocation(document, manifest, current);
    if (!location) break;
    if (location.parentId === null) break;
    ids.push(slotRowId(location.parentId, location.slotId), location.parentId);
    current = location.parentId;
  }
  ids.push(DOCUMENT_ROW_ID);
  return ids;
}
