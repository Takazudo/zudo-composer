// One pure presentation derivation of "what may go in this slot, and why"
// shared by every authoring surface (chooser, tree, inspector, canvas).
//
// Lives in the feature layer because it joins the model's insertion rules
// with the UI catalog's titles/categories. Guard text is taken from, or kept
// identical in meaning to, the model commands so a surface never promises an
// insertion `addNode` would then reject.

import type {
  ComponentCatalog,
  CompositionDocument,
  InsertionTarget,
  RootPolicy,
  RootPolicyOrigin,
} from "../../../composer/browser";
import {
  effectiveRootPolicy,
  findLocation,
  isNodeOpaque,
  isPublishedOutletTarget,
  validateRootInsertion,
} from "../../../composer/browser";
import type { ComponentDefinition } from "../active-pack";

export interface SlotRuleComponent {
  id: string;
  title: string;
  category: string;
}

export interface SlotRuleAcceptedComponent extends SlotRuleComponent {
  /** The accepted component restricts at least one of its own slots. */
  hasOwnRule: boolean;
}

export interface SlotRule {
  /** `open`: any catalog component; `restricted`: an `accepts` list; `unavailable`: nothing may be added. */
  kind: "open" | "restricted" | "unavailable";
  /** Catalog components the rule allows — declared rule order when restricted, catalog order when open. */
  accepts: SlotRuleAcceptedComponent[];
  /** The rest of the catalog, in catalog order. Empty when open or unavailable. */
  hiddenByRule: SlotRuleComponent[];
  cardinality: "single" | "many";
  min?: number;
  max?: number;
  /** Children currently in the target slot. */
  count: number;
  /** A `single` slot with one child, or `count >= max`. */
  full: boolean;
  /** The component slot the rule comes from; null for an open document root or a missing destination. */
  origin: RootPolicyOrigin | null;
  /** Why nothing can be added right now: set when unavailable, and when an otherwise valid slot is full. */
  blockedReason: string | null;
}

export interface DescribeSlotRuleInput {
  catalog: readonly ComponentDefinition[];
  manifest: ComponentCatalog;
  document: CompositionDocument;
  target: InsertionTarget;
  rootPolicy?: RootPolicy;
}

function toComponent(definition: ComponentDefinition): SlotRuleComponent {
  return { id: definition.id, title: definition.title, category: definition.category };
}

function unavailable(
  blockedReason: string,
  fields: Partial<Pick<SlotRule, "cardinality" | "min" | "max" | "count" | "origin">> = {},
): SlotRule {
  return {
    kind: "unavailable",
    accepts: [],
    hiddenByRule: [],
    cardinality: fields.cardinality ?? "many",
    ...(fields.min === undefined ? {} : { min: fields.min }),
    ...(fields.max === undefined ? {} : { max: fields.max }),
    count: fields.count ?? 0,
    full: false,
    origin: fields.origin ?? null,
    blockedReason,
  };
}

function isFull(cardinality: "single" | "many", max: number | undefined, count: number): boolean {
  return (cardinality === "single" && count >= 1) || (max !== undefined && count >= max);
}

/**
 * Split the catalog into what a slot's `accepts` list allows vs. hides.
 * Exported so a surface that must describe a slot's rule without asking
 * "can I insert here right now" (the inspector's read-only view of a
 * published-outlet slot, which `describeSlotRule` always blocks for local
 * insertion) can reuse the same partitioning.
 */
export function partitionCatalog(
  catalog: readonly ComponentDefinition[],
  manifest: ComponentCatalog,
  accepts: readonly string[] | undefined,
): Pick<SlotRule, "kind" | "accepts" | "hiddenByRule"> {
  const hasOwnRule = (id: string): boolean =>
    manifest.get(id)?.slots.some((slot) => slot.accepts !== undefined) ?? false;
  const accepted = (definition: ComponentDefinition): SlotRuleAcceptedComponent => ({
    ...toComponent(definition),
    hasOwnRule: hasOwnRule(definition.id),
  });

  if (!accepts) return { kind: "open", accepts: catalog.map(accepted), hiddenByRule: [] };

  const byId = new Map(catalog.map((definition) => [definition.id, definition]));
  const allowed = new Set(accepts);
  return {
    kind: "restricted",
    // An accepted id the catalog does not offer cannot be chosen, so it is not listed.
    accepts: [...allowed].flatMap((id) => {
      const definition = byId.get(id);
      return definition ? [accepted(definition)] : [];
    }),
    hiddenByRule: catalog.filter((definition) => !allowed.has(definition.id)).map(toComponent),
  };
}

/** Derive the display rule for inserting into `target`, mirroring the model's insertion guards. */
export function describeSlotRule({ catalog, manifest, document, target, rootPolicy }: DescribeSlotRuleInput): SlotRule {
  if (isPublishedOutletTarget(document, target.parentId, target.slotId)) {
    return unavailable("This Global template outlet is reserved for its consumers and cannot receive local children.");
  }

  if (target.parentId === null) {
    const count = document.root.length;
    const policy = effectiveRootPolicy(document, rootPolicy);
    if (policy.kind === "unrestricted") {
      return {
        ...partitionCatalog(catalog, manifest, undefined),
        cardinality: "many",
        count,
        full: false,
        origin: null,
        blockedReason: null,
      };
    }
    if (policy.kind === "unresolved") {
      return unavailable(
        validateRootInsertion(count, "", policy).error ?? "The Global template outlet is not resolved.",
        { count },
      );
    }

    const full = isFull(policy.cardinality, policy.max, count);
    // Bounds only, so the model's own single/max wording is reported without an accepts rejection.
    const boundsCheck = validateRootInsertion(count, "", { ...policy, accepts: undefined });
    return {
      ...partitionCatalog(catalog, manifest, policy.accepts),
      cardinality: policy.cardinality,
      ...(policy.min === undefined ? {} : { min: policy.min }),
      ...(policy.max === undefined ? {} : { max: policy.max }),
      count,
      full,
      origin: policy.origin ?? null,
      blockedReason: full ? (boundsCheck.error ?? "The bound Global template outlet is full.") : null,
    };
  }

  const location = findLocation(document, manifest, target.parentId);
  if (!location) return unavailable("This destination no longer exists.");
  const entry = manifest.get(location.node.componentId);
  const slot = entry?.slots.find((candidate) => candidate.id === target.slotId);
  if (!entry || !slot) return unavailable("This destination is no longer available.");

  const count = location.node.slots[target.slotId]?.length ?? 0;
  const origin: RootPolicyOrigin = {
    componentId: entry.id,
    componentTitle: catalog.find((definition) => definition.id === entry.id)?.title ?? entry.title,
    slotId: slot.id,
    slotLabel: slot.label,
  };
  const bounds = {
    cardinality: slot.cardinality,
    ...(slot.min === undefined ? {} : { min: slot.min }),
    ...(slot.max === undefined ? {} : { max: slot.max }),
    count,
    origin,
  };

  // Same rule as `validateInsertionTarget`: nothing may enter an opaque parent.
  if (isNodeOpaque(location.node, manifest)) {
    return unavailable("This component is unavailable and cannot accept new children.", bounds);
  }

  const full = isFull(slot.cardinality, slot.max, count);
  let blockedReason: string | null = null;
  if (full) {
    blockedReason = slot.cardinality === "single" && count >= 1
      ? "This slot already has a component."
      : `This slot is full: it holds at most ${slot.max} ${slot.max === 1 ? "component" : "components"}.`;
  }
  return {
    ...partitionCatalog(catalog, manifest, slot.accepts),
    ...bounds,
    full,
    blockedReason,
  };
}
