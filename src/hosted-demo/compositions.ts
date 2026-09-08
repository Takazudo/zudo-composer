import { COMPOSITION_PROVIDERS, CompositionPersistenceError, summarizeComposition, validateCompositionRecord, type CompositionCollectionStore, type CompositionLifecycleStore, type CompositionRecord } from "../composer/library";
import { notifyPersistenceChange } from "../shared/persistence-generation";

export function memoryCompositions(): CompositionCollectionStore & CompositionLifecycleStore {
  let records = new Map<string, CompositionRecord>();
  let token = 0;
  const provider = { ...COMPOSITION_PROVIDERS.files, label: "Disposable demo", storageLabel: "This tab's memory" };
  const changed = () => { token++; notifyPersistenceChange("compositions:files"); };
  const fail = (message: string): never => { throw new CompositionPersistenceError("put", "validation", message, false); };
  const checked = (record: CompositionRecord) => { const result = validateCompositionRecord(record); if (!result.ok) fail(result.issue.message); return structuredClone(record); };
  const dependents = (id: string) => [...records.values()].filter((r) => r.document.binding?.sourceRecordId === id).map((r) => ({ summary: summarizeComposition(r), binding: structuredClone(r.document.binding!) }));
  const put = async (record: CompositionRecord) => {
    const next = checked(record);
    const binding = next.document.binding;
    if (binding) {
      const source = records.get(binding.sourceRecordId);
      if (source?.id === next.id || source?.document.publication?.kind !== "global-template" || source.document.binding || source.document.publication.outlet.id !== binding.outletId) fail("Binding requires an existing matching Global template outlet.");
    }
    const previous = records.get(next.id);
    if (previous?.document.publication?.kind === "global-template" && dependents(next.id).length && (next.document.publication?.kind !== "global-template" || next.document.publication.outlet.id !== previous.document.publication.outlet.id)) fail("Detach template consumers before changing its publication outlet.");
    records.set(next.id, next); changed();
    return { canonical: { status: "saved" as const }, derived: { status: "current" as const, records: [] } };
  };
  return {
    provider,
    async list() { return [...records.values()].map(summarizeComposition); },
    async get(id) { const record = records.get(id); return record ? { status: "loaded", record: structuredClone(record) } : { status: "not-found", id }; },
    put,
    async delete(id) { if (dependents(id).length) fail("Detach template consumers before deletion."); const removed = records.delete(id); if (removed) changed(); return removed; },
    async clear() { if ([...records.keys()].some((id) => dependents(id).length)) fail("Detach template consumers before clearing compositions."); if (records.size) { records.clear(); changed(); } },
    async readAll() { return structuredClone([...records.values()]); },
    async snapshot() { return { mutationToken: token, records: structuredClone([...records.values()]) }; },
    async mutationToken() { return token; },
    async seed(seed) { if (records.size) return; const next = new Map(seed.map((r) => [r.id, checked(r)])); if (next.size !== seed.length) fail("Duplicate composition IDs."); records = next; changed(); },
    async deleteWithDependencyCheck(id) { const dependencies = dependents(id); if (dependencies.length) return { status: "blocked", dependents: dependencies }; if (!records.delete(id)) return { status: "not-found" }; changed(); return { status: "deleted" }; },
    async unpublishWithDependencyCheck(id) { const record = records.get(id); if (!record) return { status: "not-found" }; if (!record.document.publication) return { status: "not-published" }; const dependencies = dependents(id); if (dependencies.length) return { status: "blocked", dependents: dependencies }; delete record.document.publication; changed(); return { status: "unpublished" }; },
    async saveLifecycleRecord(record) { await put(record); },
  };
}
