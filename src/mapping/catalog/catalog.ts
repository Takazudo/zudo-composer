import { summarizeMapping, validateMappingRecord } from "../model";
import { isSafeRecordId } from "../../shared";
import type { CompositionCatalog, CompositionCatalogProvider, CompositionCatalogResolveOutcome, MappingCatalog, MappingCatalogProvider, MappingCatalogResolveOutcome, MappingCatalogInventory } from "./types";

function reason(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback; }
function providersById<T extends { descriptor: { id: string; label: string } }>(providers: readonly T[]): Map<string, T> {
  const result = new Map<string, T>(); for (const provider of providers) { if (!provider?.descriptor?.id || !provider.descriptor.label || !("store" in provider) || !provider.store || typeof provider.store !== "object") throw new TypeError("Catalog providers require a non-empty id, label, and store."); if (result.has(provider.descriptor.id)) throw new TypeError(`Duplicate provider id "${provider.descriptor.id}".`); result.set(provider.descriptor.id, provider); } return result;
}
function validRef(ref: unknown): ref is { providerId: string; recordId: string } { if (!ref || typeof ref !== "object" || Array.isArray(ref)) return false; const value = ref as Record<string, unknown>; return Object.keys(value).length === 2 && typeof value.providerId === "string" && value.providerId.length > 0 && isSafeRecordId(value.recordId); }

export function createCompositionCatalog(providers: readonly CompositionCatalogProvider[]): CompositionCatalog {
  const byId = providersById(providers);
  for (const provider of providers) if (typeof provider.store.list !== "function" || typeof provider.store.get !== "function") throw new TypeError("Composition catalog providers require list and get methods.");
  return {
    async list() { const entries = []; const failures = []; for (const provider of providers) { try { for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary }); } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Composition provider could not list records.") }); } } return { status: "listed" as const, entries, failures }; },
    async resolve(ref): Promise<CompositionCatalogResolveOutcome> { if (!validRef(ref)) return { status: "invalid", reason: "Composition reference is malformed." }; const provider = byId.get(ref.providerId); if (!provider) return { status: "not-found" }; try { const outcome = await provider.store.get(ref.recordId); switch (outcome.status) { case "loaded": return { status: "resolved", record: outcome.record }; case "not-found": return { status: "not-found" }; case "invalid": return { status: "invalid", reason: outcome.issue.message }; case "future-schema": return { status: "invalid", reason: `Composition uses unsupported schema version ${outcome.foundSchemaVersion}.` }; } } catch (error) { return { status: "provider-error", reason: reason(error, "Composition provider could not resolve the record.") }; } },
  };
}

export function createMappingCatalog(providers: readonly MappingCatalogProvider[]): MappingCatalog {
  const byId = providersById(providers);
  for (const provider of providers) if (typeof provider.store.list !== "function" || typeof provider.store.get !== "function") throw new TypeError("Mapping catalog providers require list and get methods.");
  return {
    async readInventory(): Promise<MappingCatalogInventory> {
      const entries: MappingCatalogInventory["entries"][number][] = [], failures: MappingCatalogInventory["failures"][number][] = [], snapshots: MappingCatalogInventory["snapshots"][number][] = [];
      for (const provider of providers) {
        try {
          if (provider.store.snapshot) {
            const snapshot = structuredClone(await provider.store.snapshot());
            if (!(typeof snapshot.mutationToken === "string" ? snapshot.mutationToken.length > 0 : Number.isSafeInteger(snapshot.mutationToken) && snapshot.mutationToken >= 0)
              || !Array.isArray(snapshot.records) || snapshot.records.some(record => !validateMappingRecord(record).ok)
              || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) throw new Error("Invalid canonical Mapping inventory.");
            snapshots.push({ providerId: provider.descriptor.id, snapshot });
            const summaries = snapshot.records.map(summarizeMapping).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
            entries.push(...summaries.map(summary => ({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary })));
          } else {
            for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary });
          }
        } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Mapping provider could not read inventory.") }); }
      }
      return { entries, failures, snapshots };
    },
    async list() { const entries = []; const failures = []; for (const provider of providers) { try { for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary }); } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Mapping provider could not list records.") }); } } return { status: "listed" as const, entries, failures }; },
    async resolve(ref): Promise<MappingCatalogResolveOutcome> { if (!validRef(ref)) return { status: "invalid", reason: "Mapping reference is malformed." }; const provider = byId.get(ref.providerId); if (!provider) return { status: "not-found" }; try { const outcome = await provider.store.get(ref.recordId); switch (outcome.status) { case "loaded": return { status: "resolved", record: outcome.record }; case "not-found": return { status: "not-found" }; case "invalid": return { status: "invalid", reason: outcome.issue.message }; case "future-schema": return { status: "invalid", reason: `Mapping uses unsupported schema version ${outcome.foundSchemaVersion}.` }; } } catch (error) { return { status: "provider-error", reason: reason(error, "Mapping provider could not resolve the record.") }; } },
  };
}
