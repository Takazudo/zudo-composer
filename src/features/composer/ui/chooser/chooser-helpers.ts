// Pure helpers for the component chooser dialog (issue Takazudo/zudo-sg#250).
//
// Kept DOM-free so eligibility/search/filter logic is unit-testable directly,
// independent of the dialog's focus/capture mechanics — see
// `composer-chooser.tsx` for how these compose into the rendered dialog.

import type { ComponentCatalog, CompositionDocument, CompositionNode, InsertionTarget, RootPolicy } from "../../../../composer/browser";
import { effectiveRootPolicy, findLocation, insertForest } from "../../../../composer/browser";
import type { ComponentDefinition } from "../../active-pack";
import { describeSlotRule, type SlotRuleComponent } from "../slot-rules";

export interface ChooserEligibility {
  /** Catalog entries this target's slot can currently accept. */
  entries: ComponentDefinition[];
  /** Catalog entries the slot's `accepts` rule excludes, in catalog order. */
  hiddenByRule: SlotRuleComponent[];
  /** Non-null when NOTHING can be added here (e.g. a full slot or an unresolved template outlet). */
  blockedReason: string | null;
}

/**
 * Filter the catalog down to what `target` can currently accept, via
 * `describeSlotRule`: a nested slot and the virtual root (under its effective
 * `rootPolicy`) both apply `accepts`, refuse everything when full, and refuse
 * everything when the destination is unavailable.
 */
export function eligibleEntries(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  catalog: readonly ComponentDefinition[],
  target: InsertionTarget,
  rootPolicy?: RootPolicy,
): ChooserEligibility {
  const rule = describeSlotRule({ catalog, manifest, document, target, rootPolicy });
  if (rule.blockedReason !== null) {
    return { entries: [], hiddenByRule: rule.hiddenByRule, blockedReason: rule.blockedReason };
  }
  const accepted = new Set(rule.accepts.map((component) => component.id));
  return {
    entries: catalog.filter((candidate) => accepted.has(candidate.id)),
    hiddenByRule: rule.hiddenByRule,
    blockedReason: null,
  };
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
      let id: string;
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

/**
 * A human-readable label for the dialog title/status: "Parent › Slot", or at
 * the root either the bound template outlet's label or "Document root".
 */
export function describeInsertionTarget(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  catalogById: ReadonlyMap<string, ComponentDefinition>,
  target: InsertionTarget,
  rootPolicy?: RootPolicy,
): string {
  if (target.parentId === null) {
    const policy = effectiveRootPolicy(document, rootPolicy);
    const origin = policy.kind === "resolved" ? policy.origin : undefined;
    return origin ? (origin.viaTemplate?.outletLabel ?? origin.slotLabel) : "Document root";
  }
  const location = findLocation(document, manifest, target.parentId);
  if (!location) return target.slotId;
  const parentTitle = catalogById.get(location.node.componentId)?.title ?? location.node.componentId;
  const entry = manifest.get(location.node.componentId);
  const slotLabel = entry?.slots.find((s) => s.id === target.slotId)?.label ?? target.slotId;
  return `${parentTitle} › ${slotLabel}`;
}
