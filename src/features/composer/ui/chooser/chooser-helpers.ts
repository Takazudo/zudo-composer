// Pure helpers for the component chooser dialog (issue #250).
//
// Kept DOM-free so eligibility/search/filter logic is unit-testable directly,
// independent of the dialog's focus/capture mechanics — see
// `composer-chooser.tsx` for how these compose into the rendered dialog.

import type { ComponentCatalog, CompositionDocument, CompositionNode, InsertionTarget, RootPolicy } from "../../../../composer";
import { findLocation, insertForest, isNodeOpaque } from "../../../../composer";
import type { ComponentDefinition } from "../../active-pack";

export interface ChooserEligibility {
  /** Catalog entries this target's slot can currently accept. */
  entries: ComponentDefinition[];
  /** Non-null when NOTHING can be added here (e.g. a single-cardinality slot already occupied). */
  blockedReason: string | null;
}

/**
 * Filter the catalog down to what `target` can currently accept: the virtual
 * root accepts anything (mirrors `@/composer`'s `addNode`); a real slot is
 * filtered by its `accepts` whitelist (undefined = any opted-in component) and
 * refuses everything when a `single`-cardinality slot already has a child.
 */
export function eligibleEntries(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  catalog: readonly ComponentDefinition[],
  target: InsertionTarget,
): ChooserEligibility {
  if (target.parentId === null) {
    return { entries: [...catalog], blockedReason: null };
  }

  const location = findLocation(document, manifest, target.parentId);
  if (!location) return { entries: [], blockedReason: "This destination no longer exists." };

  const entry = manifest.get(location.node.componentId);
  const slot = entry?.slots.find((s) => s.id === target.slotId);
  if (!entry || !slot) return { entries: [], blockedReason: "This destination is no longer available." };

  // Mirrors `@/composer`'s own `validateInsertionTarget` guard: nothing may be
  // added into an opaque parent (unknown component, unsupported version,
  // cardinality/accepts violation). The tree only ever offers Add on a
  // non-opaque parent, but the chooser is a shared, reusable dialog any
  // future trigger (e.g. a canvas insert point) can open with an arbitrary
  // target — this keeps it from showing a false "you can add here" state
  // `addNode` would then silently reject.
  if (isNodeOpaque(location.node, manifest)) {
    return { entries: [], blockedReason: "This component is unavailable and cannot accept new children." };
  }

  const children = location.node.slots[target.slotId] ?? [];
  if (slot.cardinality === "single" && children.length >= 1) {
    return { entries: [], blockedReason: "This slot already has a component." };
  }

  const filtered = catalog.filter((candidate) => !slot.accepts || slot.accepts.includes(candidate.id));
  return { entries: filtered, blockedReason: null };
}

/** Case-insensitive title/category/description substring match. */
export function matchesQuery(entry: ComponentDefinition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${entry.title} ${entry.category} ${entry.description}`.toLowerCase();
  return haystack.includes(q);
}

export interface PatternForestEligibility {
  eligible: boolean;
  /** The exact atomic-command rejection shown before an attempted insertion. */
  reason?: string;
}

/**
 * Ask the same atomic forest command used for submit whether this complete
 * Pattern root forest can currently be inserted. The disposable id factory is
 * deliberately collision-free against both inputs, so this dry run neither
 * changes a document nor consumes the real controller's node ids.
 *
 * The submit callback must still invoke `insertForest` through the controller:
 * a target, root policy, or manifest can change after this advisory check.
 */
export function assessPatternForestInsertion(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  target: InsertionTarget,
  sourceRoots: readonly CompositionNode[],
  rootPolicy?: RootPolicy,
): PatternForestEligibility {
  const occupiedIds = new Set<string>();
  const collect = (nodes: readonly CompositionNode[]): void => {
    for (const node of nodes) {
      occupiedIds.add(node.id);
      for (const children of Object.values(node.slots)) collect(children);
    }
  };
  collect(document.root);
  collect(sourceRoots);

  let sequence = 0;
  const result = insertForest(
    document,
    manifest,
    target,
    sourceRoots,
    () => {
      let id = "";
      do {
        sequence += 1;
        id = `chooser-pattern-validation-${sequence}`;
      } while (occupiedIds.has(id));
      occupiedIds.add(id);
      return id;
    },
    rootPolicy,
  );
  return result.ok ? { eligible: true } : { eligible: false, reason: result.error };
}

/** A human-readable label for the dialog title/status: "Document root" or "Parent › Slot". */
export function describeInsertionTarget(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  catalogById: ReadonlyMap<string, ComponentDefinition>,
  target: InsertionTarget,
): string {
  if (target.parentId === null) return "Document root";
  const location = findLocation(document, manifest, target.parentId);
  if (!location) return target.slotId;
  const parentTitle = catalogById.get(location.node.componentId)?.title ?? location.node.componentId;
  const entry = manifest.get(location.node.componentId);
  const slotLabel = entry?.slots.find((s) => s.id === target.slotId)?.label ?? target.slotId;
  return `${parentTitle} › ${slotLabel}`;
}
