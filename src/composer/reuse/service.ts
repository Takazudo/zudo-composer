import {
  CompositionPersistenceError,
  compareCompositionSummariesNewestFirst,
} from "../library";
import type {
  CompositionLoadOutcome,
  CompositionRecord,
  CompositionRecordRef,
  CompositionSummary,
} from "../library";
import { findLocation } from "../model/index-model";
import type { ComponentCatalog } from "../model/types";
import { resolveGlobalTemplateLoad } from "./resolver";
import type {
  CompositionReuseService,
  GlobalTemplateOutletRule,
  GlobalTemplateResolutionOutcome,
  ReuseCatalogEntry,
  ReuseCatalogOutcome,
  ReuseDependentsOutcome,
  ReuseReadProvider,
  ReuseSelectionOutcome,
} from "./types";

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function failure(error: unknown): { status: "unavailable" | "load-error"; message: string } {
  const status = error instanceof CompositionPersistenceError && error.code === "unavailable"
    ? "unavailable"
    : "load-error";
  return { status, message: message(error, "The reusable Composition could not be loaded.") };
}

function refFor(provider: ReuseReadProvider, recordId: string): CompositionRecordRef {
  return { providerId: provider.provider.id, recordId };
}

function sameRef(a: CompositionRecordRef | undefined, b: CompositionRecordRef): boolean {
  return a?.providerId === b.providerId && a.recordId === b.recordId;
}

/**
 * Summary-only eligibility check. It intentionally cannot synthesize `None`:
 * that is a New-dialog UI choice rather than a persisted reusable source.
 */
export function catalogEntryFromSummary(
  provider: ReuseReadProvider,
  summary: CompositionSummary,
  current?: CompositionRecordRef,
): ReuseCatalogEntry | undefined {
  const ref = refFor(provider, summary.id);
  if (sameRef(current, ref)) return undefined;
  if (summary.reuseStatus !== "eligible") return undefined;
  if (summary.publicationKind === "pattern") {
    if ((summary.rootCount ?? 0) === 0) return undefined;
    return { ref, summary, kind: "pattern" };
  }
  if (summary.publicationKind === "global-template" && summary.outletId) {
    return {
      ref,
      summary,
      kind: "global-template",
      outlet: { id: summary.outletId, label: summary.outletLabel ?? "" },
    };
  }
  return undefined;
}

/**
 * Resolve a Global template's exposed outlet slot into its display rule.
 * Mirrors `resolveGlobalTemplate`'s location/slot lookup, but it has no
 * consumer to validate against here, so it stops once the slot itself is
 * found — and returns undefined (not an `unavailable`/error outcome) for an
 * invalid outlet target: the listing still shows the template either way.
 */
function outletRuleFromRecord(
  record: CompositionRecord,
  manifest: ComponentCatalog,
): GlobalTemplateOutletRule | undefined {
  const publication = record.document.publication;
  if (publication?.kind !== "global-template") return undefined;
  const location = findLocation(record.document, manifest, publication.outlet.target.parentId);
  const owner = location?.node;
  const entry = owner ? manifest.get(owner.componentId) : undefined;
  const slot = entry?.slots.find((candidate) => candidate.id === publication.outlet.target.slotId);
  if (!owner || !entry || !slot) return undefined;
  return {
    componentId: entry.id,
    slotId: slot.id,
    accepts: slot.accepts ? [...slot.accepts] : null,
    cardinality: slot.cardinality,
    ...(slot.min === undefined ? {} : { min: slot.min }),
    ...(slot.max === undefined ? {} : { max: slot.max }),
  };
}

function selectionFromLoad(
  load: CompositionLoadOutcome,
  current: CompositionRecordRef | undefined,
  provider: ReuseReadProvider,
): ReuseSelectionOutcome {
  if (load.status === "not-found") return { status: "invalid", reason: "not-reusable" };
  if (load.status === "invalid" || load.status === "future-schema") {
    return { status: "invalid", reason: "not-reusable" };
  }
  const record = load.record;
  if (sameRef(current, refFor(provider, record.id))) {
    return { status: "invalid", reason: "current-record", record };
  }
  if (record.document.binding) return { status: "invalid", reason: "nested-template", record };
  const publication = record.document.publication;
  if (publication?.kind === "pattern") {
    return record.document.root.length === 0
      ? { status: "empty", record, reason: "empty-pattern" }
      : { status: "loaded", record, kind: "pattern" };
  }
  if (publication?.kind === "global-template") {
    return publication.outlet.id.length > 0
      ? { status: "loaded", record, kind: "global-template" }
      : { status: "invalid", reason: "missing-outlet", record };
  }
  return { status: "invalid", reason: "not-reusable", record };
}

/**
 * Parent-application adapter around one active provider. It makes no mutation
 * calls and never crosses provider boundaries, even when record ids collide.
 */
export function createCompositionReuseService(
  provider: ReuseReadProvider,
  manifest: ComponentCatalog,
): CompositionReuseService {
  return {
    async listCatalog(current): Promise<ReuseCatalogOutcome> {
      try {
        const summaries = await provider.list();
        const candidates = summaries
          .map((summary) => catalogEntryFromSummary(provider, summary, current))
          .filter((entry): entry is ReuseCatalogEntry => entry !== undefined);
        const entries = await Promise.all(
          candidates.map(async (entry) => {
            if (entry.kind !== "global-template") return entry;
            const outcome = await provider.get(entry.ref.recordId);
            if (outcome.status !== "loaded") return entry;
            const outletRule = outletRuleFromRecord(outcome.record, manifest);
            return outletRule ? { ...entry, outletRule } : entry;
          }),
        );
        entries.sort((a, b) => compareCompositionSummariesNewestFirst(a.summary, b.summary));
        return { status: "listed", entries };
      } catch (error) {
        return failure(error);
      }
    },

    async loadSelection(ref, current): Promise<ReuseSelectionOutcome> {
      if (ref.providerId !== provider.provider.id) {
        return { status: "unavailable", message: "The requested Composition belongs to another provider." };
      }
      try {
        return selectionFromLoad(await provider.get(ref.recordId), current, provider);
      } catch (error) {
        return failure(error);
      }
    },

    async listDependents(sourceRecordId): Promise<ReuseDependentsOutcome> {
      try {
        const summaries = await provider.list();
        const loaded = await Promise.all(
          summaries.map(async (summary) => ({ summary, outcome: await provider.get(summary.id) })),
        );
        const dependents = loaded
          .flatMap(({ summary, outcome }) => {
            if (outcome.status !== "loaded") return [];
            const binding = outcome.record.document.binding;
            return binding?.sourceRecordId === sourceRecordId
              ? [{ ref: refFor(provider, outcome.record.id), summary, binding }]
              : [];
          })
          .sort((a, b) => compareCompositionSummariesNewestFirst(a.summary, b.summary));
        return { status: "listed", dependents };
      } catch (error) {
        return failure(error);
      }
    },

    async resolve(consumer: CompositionRecord): Promise<GlobalTemplateResolutionOutcome> {
      const binding = consumer.document.binding;
      if (!binding) {
        return { status: "unbound", binding: undefined, localRoot: consumer.document.root };
      }
      if (binding.sourceRecordId === consumer.id) {
        return resolveGlobalTemplateLoad(consumer, { status: "not-found", id: binding.sourceRecordId }, manifest);
      }
      try {
        return resolveGlobalTemplateLoad(consumer, await provider.get(binding.sourceRecordId), manifest);
      } catch (error) {
        const preserved = { binding, localRoot: consumer.document.root };
        return {
          status: "missing-template",
          reason: error instanceof CompositionPersistenceError && error.code === "unavailable"
            ? "unavailable"
            : "load-error",
          ...preserved,
        };
      }
    },
  };
}
