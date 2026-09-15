// Machine-readable composition grammar for agents — derived, never authored,
// from the component manifest plus the host's Global templates. A template
// whose outlet targets a slot on a container component is a "page kind": its
// consumers' virtual root inherits that slot's `accepts`/cardinality/min/max
// as their `RootPolicy` (see `../model/validate`'s `effectiveRootPolicy`).
// This module renders the SAME rule for agents, independent of any bound
// consumer. Pure, no IO: the CLI and, later, the inspector load the manifest
// and template documents and pass them in.

import type { SlotCardinality } from "@zudo-composer/component-contract";
import type { ComponentCatalog, CompositionDocument } from "../model/types";
import { findLocation } from "../model/index-model";

/** One component kind a region accepts, with its own children rule (if any). */
export interface GrammarAcceptedKind {
  id: string;
  title: string;
  description: string;
  /** `null` when the kind has no slot of its own that narrows its children. */
  accepts: string[] | null;
}

/** The container slot rule backing one template's page-kind outlet. */
export interface GrammarRegion {
  outletLabel: string;
  componentId: string;
  componentTitle: string;
  slotId: string;
  slotLabel: string;
  cardinality: SlotCardinality;
  min?: number;
  max?: number;
  accepts: GrammarAcceptedKind[] | "any";
}

/** One page kind: a Global template whose outlet targets a container slot. */
export interface GrammarTemplate {
  id: string;
  name: string;
  /** `null` when the outlet's target slot declares no `accepts` and no cardinality/min/max bound — any component, any count. */
  region: GrammarRegion | null;
  open: boolean;
}

/** A published Global template left out because its outlet does not resolve against the manifest. */
export interface GrammarUnavailableTemplate {
  id: string;
  name: string;
  reason: string;
}

export interface Grammar {
  pack: { id: string; version: string };
  templates: GrammarTemplate[];
  /** Skipped templates, mirroring the resolver treating an unresolvable template as unavailable. */
  unavailableTemplates: GrammarUnavailableTemplate[];
  /** Pages bound to no template use the ordinary unrestricted virtual root. */
  openRoot: { accepts: "any" };
}

export interface BuildGrammarOptions {
  manifest: ComponentCatalog;
  /** Any Composition may be passed; only published Global templates contribute an entry. */
  templates: readonly CompositionDocument[];
}

/**
 * Union, in first-seen order, of the `accepts` lists of a kind's own slots.
 * Exported so a surface that synthesizes a `GrammarRegion` for a rule not
 * backed by a published Global template outlet (the inspector's plain
 * restricted-slot and root-policy cases) can describe a kind's own children
 * the same way `buildTemplateEntry` does, without a second traversal.
 */
export function describeKindChildren(kindId: string, manifest: ComponentCatalog): string[] | null {
  const entry = manifest.get(kindId);
  if (!entry) return null;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const slot of entry.slots) {
    if (!slot.accepts) continue;
    for (const id of slot.accepts) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  return merged.length > 0 ? merged : null;
}

type TemplateEntryResult = { entry: GrammarTemplate } | { unavailable: string };

function buildTemplateEntry(document: CompositionDocument, manifest: ComponentCatalog): TemplateEntryResult {
  const publication = document.publication;
  if (publication?.kind !== "global-template") {
    throw new Error(`buildGrammar: Composition "${document.id}" is not a published Global template.`);
  }
  const { parentId, slotId } = publication.outlet.target;
  const parent = findLocation(document, manifest, parentId)?.node;
  if (!parent) return { unavailable: `outlet target "${parentId}" was not found.` };
  const containerEntry = manifest.get(parent.componentId);
  if (!containerEntry) return { unavailable: `outlet owner "${parent.componentId}" is not in the manifest.` };
  const slot = containerEntry.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return { unavailable: `outlet slot "${slotId}" is not declared on "${parent.componentId}".` };

  const bounds = {
    cardinality: slot.cardinality,
    ...(slot.min !== undefined ? { min: slot.min } : {}),
    ...(slot.max !== undefined ? { max: slot.max } : {}),
  };

  if (!slot.accepts) {
    // Cardinality `single`, `min`, or `max` on an accepts-free slot is still a
    // real constraint an agent must respect, so it is reported as bounds on
    // an `accepts: "any"` region rather than discarded as a plain open slot.
    const isBounded = slot.cardinality === "single" || slot.min !== undefined || slot.max !== undefined;
    if (!isBounded) {
      return { entry: { id: document.id, name: document.name, region: null, open: true } };
    }
    const region: GrammarRegion = {
      outletLabel: publication.outlet.label,
      componentId: parent.componentId,
      componentTitle: containerEntry.title,
      slotId,
      slotLabel: slot.label,
      ...bounds,
      accepts: "any",
    };
    return { entry: { id: document.id, name: document.name, region, open: true } };
  }

  const accepts: GrammarAcceptedKind[] = slot.accepts.map((kindId) => {
    const kindEntry = manifest.get(kindId);
    return {
      id: kindId,
      title: kindEntry?.title ?? kindId,
      description: kindEntry?.description ?? "",
      accepts: describeKindChildren(kindId, manifest),
    };
  });

  const region: GrammarRegion = {
    outletLabel: publication.outlet.label,
    componentId: parent.componentId,
    componentTitle: containerEntry.title,
    slotId,
    slotLabel: slot.label,
    ...bounds,
    accepts,
  };

  return { entry: { id: document.id, name: document.name, region, open: false } };
}

/** Build the composition grammar from a resolved component pack and the host's templates. */
export function buildGrammar(options: BuildGrammarOptions): Grammar {
  const { manifest, templates } = options;
  const entries: GrammarTemplate[] = [];
  const unavailableTemplates: GrammarUnavailableTemplate[] = [];
  for (const document of templates) {
    if (document.publication?.kind !== "global-template") continue;
    const result = buildTemplateEntry(document, manifest);
    if ("entry" in result) entries.push(result.entry);
    else unavailableTemplates.push({ id: document.id, name: document.name, reason: result.unavailable });
  }
  return {
    pack: { id: manifest.pack.packId, version: manifest.pack.packVersion },
    templates: entries,
    unavailableTemplates,
    openRoot: { accepts: "any" },
  };
}

export { renderGrammarMarkdown } from "./render-markdown";
