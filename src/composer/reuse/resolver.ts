import { findLocation } from "../model/index-model";
import { validateRootForest } from "../model/validate";
import type { RootPolicy } from "../model/types";
import type { CompositionLoadOutcome, CompositionRecord } from "../library/types";
import type {
  GlobalTemplateResolutionOutcome,
  ResolveGlobalTemplateOptions,
} from "./types";

function base(consumer: CompositionRecord) {
  return {
    binding: consumer.document.binding!,
    localRoot: consumer.document.root,
  };
}

/**
 * Pure, non-mutating source/outlet validation. The parent provider adapter
 * supplies a saved source record; this layer has no storage or framework I/O.
 */
export function resolveGlobalTemplate(
  options: ResolveGlobalTemplateOptions,
): GlobalTemplateResolutionOutcome {
  const { consumer, source, manifest } = options;
  const binding = consumer.document.binding;
  if (!binding) return { status: "unbound", binding: undefined, localRoot: consumer.document.root };

  const preserved = base(consumer);
  if (binding.sourceRecordId === consumer.id) return { status: "self-reference", ...preserved };
  if (source.id !== binding.sourceRecordId) {
    return { status: "missing-template", reason: "source-id-mismatch", ...preserved };
  }

  // A Global source is never itself a consumer in v1, even if malformed data
  // happens to retain an otherwise plausible publication.
  if (source.document.binding) return { status: "nested-template", source, ...preserved };

  const publication = source.document.publication;
  if (publication?.kind !== "global-template") {
    return { status: "invalid-template", source, reason: "not-global-template", ...preserved };
  }
  const outlet = publication.outlet;
  if (outlet.id !== binding.outletId) return { status: "missing-outlet", source, ...preserved };

  const location = findLocation(source.document, manifest, outlet.target.parentId);
  const owner = location?.node;
  const entry = owner ? manifest.get(owner.componentId) : undefined;
  const slot = entry?.slots.find((candidate) => candidate.id === outlet.target.slotId);
  if (!owner || !slot || (owner.slots[outlet.target.slotId]?.length ?? 0) > 0) {
    return { status: "invalid-template", source, reason: "invalid-outlet-target", ...preserved };
  }

  const rootPolicy: Extract<RootPolicy, { kind: "resolved" }> = {
    kind: "resolved",
    ...(slot.accepts ? { accepts: [...slot.accepts] } : {}),
    cardinality: slot.cardinality,
  };
  const localValidation = validateRootForest(consumer.document.root, rootPolicy);
  if (!localValidation.ok) {
    return {
      status: "incompatible-local-root",
      source,
      outlet,
      rootPolicy,
      message: localValidation.error ?? "The local roots do not fit the published outlet.",
      ...preserved,
    };
  }
  return { status: "resolved", source, outlet, rootPolicy, ...preserved };
}

/** Map a provider load outcome into the same deterministic, content-preserving resolution union. */
export function resolveGlobalTemplateLoad(
  consumer: CompositionRecord,
  source: CompositionLoadOutcome,
  manifest: ResolveGlobalTemplateOptions["manifest"],
): GlobalTemplateResolutionOutcome {
  const binding = consumer.document.binding;
  if (!binding) return { status: "unbound", binding: undefined, localRoot: consumer.document.root };
  const preserved = base(consumer);
  if (binding.sourceRecordId === consumer.id) return { status: "self-reference", ...preserved };
  if (source.status === "not-found") return { status: "missing-template", reason: "not-found", ...preserved };
  if (source.status === "invalid") return { status: "missing-template", reason: "invalid-record", ...preserved };
  if (source.status === "future-schema") return { status: "missing-template", reason: "future-schema", ...preserved };
  return resolveGlobalTemplate({ consumer, source: source.record, manifest });
}
