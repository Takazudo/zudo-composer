import type { ContentStore } from "../../content";
import type { MappingCatalogProvider, MappingLoadOutcome, MappingRecord, MappingStore } from "../../mapping";
import type { MappingRef } from "../model";
import type { MappingAssignmentCatalog, MappingRouteCatalog } from "../routes";

export interface SitemapperContentProvider {
  descriptor: { id: string; label: string };
  store: Pick<ContentStore, "scanEntries">;
}

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mappingFailure(outcome: Exclude<MappingLoadOutcome, { status: "loaded" | "not-found" }>): string {
  return outcome.status === "invalid" ? outcome.issue.message : `Unsupported Mapping schema ${outcome.foundSchemaVersion}.`;
}

/** One injected catalog supplies picker rows and snapshot-consistent route reads. */
export function createMappingAssignmentCatalog(
  mappingProviders: readonly MappingCatalogProvider[],
  contentProviders: readonly SitemapperContentProvider[],
): MappingAssignmentCatalog {
  const mappings = new Map(mappingProviders.map((provider) => [provider.descriptor.id, provider]));
  const contents = new Map(contentProviders.map((provider) => [provider.descriptor.id, provider]));
  if (mappings.size !== mappingProviders.length) throw new TypeError("Duplicate Mapping provider id.");
  if (contents.size !== contentProviders.length) throw new TypeError("Duplicate Content provider id.");
  const routes: MappingRouteCatalog = {
    async list() {
      const entries = [];
      const failures = [];
      for (const provider of mappingProviders) {
        try {
          for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary });
        } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Could not list Mappings.") }); }
      }
      return { status: "listed" as const, entries, failures };
    },
    async resolveMapping(ref: MappingRef) {
      const provider = mappings.get(ref.providerId);
      if (!provider) return { status: "provider-error" as const, reason: `Mapping provider "${ref.providerId}" is unavailable.` };
      let outcome: MappingLoadOutcome;
      try { outcome = await provider.store.get(ref.recordId); }
      catch (error) { return { status: "provider-error" as const, reason: reason(error, "Could not read Mapping.") }; }
      if (outcome.status === "loaded") return { status: "resolved" as const, record: outcome.record };
      if (outcome.status === "not-found") return { status: "not-found" as const };
      return { status: "invalid" as const, reason: mappingFailure(outcome) };
    },
    async resolveContentSnapshot(mapping: MappingRecord) {
      const ref = mapping.document.contentModel;
      const provider = contents.get(ref.providerId);
      if (!provider) return { status: "provider-error" as const, reason: `Content provider "${ref.providerId}" is unavailable.` };
      try {
        const snapshot = await provider.store.scanEntries(ref.recordId);
        return { status: "resolved" as const, model: snapshot.model, snapshot };
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        if (code === "not-found") return { status: "not-found" as const };
        if (code === "validation" || code === "unsupported-version") return { status: "invalid" as const, reason: reason(error, "The Content model or one of its Entries is invalid.") };
        return { status: "provider-error" as const, reason: reason(error, "Could not scan Content snapshot.") };
      }
    },
  };
  return {
    async list() { const outcome = await routes.list(); return { entries: outcome.entries, failures: outcome.failures }; },
    routes,
  };
}

export type SitemapperMappingStore = Pick<MappingStore, "list" | "get">;
