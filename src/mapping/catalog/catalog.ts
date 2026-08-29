import { isSafeRecordId } from "../../shared";
import type { CompositionCatalog, CompositionCatalogProvider, CompositionCatalogResolveOutcome, MappingCatalog, MappingCatalogProvider, MappingCatalogResolveOutcome } from "./types";

function reason(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback; }
function providersById<T extends { descriptor: { id: string; label: string } }>(providers: readonly T[]): Map<string, T> {
  const result = new Map<string, T>(); for (const provider of providers) { if (!provider?.descriptor?.id || !provider.descriptor.label) throw new TypeError("Catalog providers require a non-empty id and label."); if (result.has(provider.descriptor.id)) throw new TypeError(`Duplicate provider id "${provider.descriptor.id}".`); result.set(provider.descriptor.id, provider); } return result;
}

export function createCompositionCatalog(providers: readonly CompositionCatalogProvider[]): CompositionCatalog {
  const byId = providersById(providers);
  return {
    async list() { const entries = []; const failures = []; for (const provider of providers) { try { for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary }); } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Composition provider could not list records.") }); } } return { status: "listed" as const, entries, failures }; },
    async resolve(ref): Promise<CompositionCatalogResolveOutcome> { if (!ref || typeof ref !== "object" || !ref.providerId || !isSafeRecordId(ref.recordId)) return { status: "invalid", reason: "Composition reference is malformed." }; const provider = byId.get(ref.providerId); if (!provider) return { status: "not-found" }; try { const outcome = await provider.store.get(ref.recordId); switch (outcome.status) { case "loaded": return { status: "resolved", record: outcome.record }; case "not-found": return { status: "not-found" }; case "invalid": return { status: "invalid", reason: outcome.issue.message }; case "future-schema": return { status: "invalid", reason: `Composition uses unsupported schema version ${outcome.foundSchemaVersion}.` }; } } catch (error) { return { status: "provider-error", reason: reason(error, "Composition provider could not resolve the record.") }; } },
  };
}

export function createMappingCatalog(providers: readonly MappingCatalogProvider[]): MappingCatalog {
  const byId = providersById(providers);
  return {
    async list() { const entries = []; const failures = []; for (const provider of providers) { try { for (const summary of await provider.store.list()) entries.push({ ref: { providerId: provider.descriptor.id, recordId: summary.id }, providerLabel: provider.descriptor.label, summary }); } catch (error) { failures.push({ providerId: provider.descriptor.id, providerLabel: provider.descriptor.label, reason: reason(error, "Mapping provider could not list records.") }); } } return { status: "listed" as const, entries, failures }; },
    async resolve(ref): Promise<MappingCatalogResolveOutcome> { if (!ref || typeof ref !== "object" || typeof ref.providerId !== "string" || !ref.providerId || !isSafeRecordId(ref.recordId)) return { status: "invalid", reason: "Mapping reference is malformed." }; const provider = byId.get(ref.providerId); if (!provider) return { status: "not-found" }; try { const outcome = await provider.store.get(ref.recordId); switch (outcome.status) { case "loaded": return { status: "resolved", record: outcome.record }; case "not-found": return { status: "not-found" }; case "invalid": return { status: "invalid", reason: outcome.issue.message }; case "future-schema": return { status: "invalid", reason: `Mapping uses unsupported schema version ${outcome.foundSchemaVersion}.` }; } } catch (error) { return { status: "provider-error", reason: reason(error, "Mapping provider could not resolve the record.") }; } },
  };
}
