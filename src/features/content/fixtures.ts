import { createContentEntryRecord, createContentModelRecord, type ContentInitializationOutcome, type ContentProvider } from "../../content";

export const contentRenderFixtures = Object.freeze({
  populated: { modelCount: 2, entryCount: 3 },
  empty: { modelCount: 0, entryCount: 0 },
  single: { modelKind: "single", entryCount: 1 },
  longText: { name: "Editorial/content/with/a/very/long/delimiter-aware/model/path" },
  broken: { initialization: "recovery-required", sourcePreserved: true },
});

export function createMemoryContentProvider(options: { initialization?: ContentInitializationOutcome; failWrites?: boolean } = {}): ContentProvider {
  const model = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
  const entry = createContentEntryRecord(model.id, { title: "Hello" }, { id: "entry-1", timestamp: "2026-01-01T00:00:00.000Z" });
  let models = [model]; let entries = [entry];
  const ready = (): ContentInitializationOutcome => options.initialization ?? { status: "ready", models: models.map((record) => ({ id: record.id, name: record.document.name, kind: record.document.kind, fieldCount: record.document.fields.length, createdAt: record.createdAt, updatedAt: record.updatedAt })) };
  return { descriptor: { id: "content-indexeddb", label: "Browser storage" }, initialization: { initialize: async () => ready(), retry: async () => ready(), startFresh: async () => { models = []; entries = []; return { status: "ready", models: [] }; } }, store: {
    provider: { id: "content-indexeddb", label: "Browser storage" }, listModels: async () => { const outcome = ready(); return outcome.status === "ready" ? outcome.models : []; },
    getModel: async (id) => { const found = models.find((item) => item.id === id); return found ? { status: "loaded", record: structuredClone(found) } : { status: "not-found", id }; },
    putModel: async (record) => { if (options.failWrites) throw new Error("Write failed"); models = [structuredClone(record), ...models.filter((item) => item.id !== record.id)]; },
    deleteModel: async (id) => { const found = models.some((item) => item.id === id); models = models.filter((item) => item.id !== id); entries = entries.filter((item) => item.modelId !== id); return found; },
    countEntries: async (id) => entries.filter((item) => item.modelId === id).length,
    getEntry: async (id) => { const found = entries.find((item) => item.id === id); return found ? { status: "loaded", record: structuredClone(found) } : { status: "not-found", id }; },
    pageEntries: async (modelId, page = {}) => { const all = entries.filter((item) => item.modelId === modelId); const start = page.cursor ? Number(page.cursor) : 0; const limit = page.limit ?? 50; return { entries: structuredClone(all.slice(start, start + limit)), ...(start + limit < all.length ? { nextCursor: String(start + limit) } : {}) }; },
    scanEntries: async (modelId) => ({ model: models.find((item) => item.id === modelId)!, count: entries.filter((item) => item.modelId === modelId).length, entries: entries.filter((item) => item.modelId === modelId), diagnostics: [] }),
    putEntry: async (record) => { if (options.failWrites) throw new Error("Write failed"); entries = [structuredClone(record), ...entries.filter((item) => item.id !== record.id)]; },
    deleteEntry: async (id) => { const found = entries.some((item) => item.id === id); entries = entries.filter((item) => item.id !== id); return found; },
    removeField: async (modelId, fieldId) => { models = models.map((item) => item.id === modelId ? { ...item, document: { ...item.document, fields: item.document.fields.filter((field) => field.id !== fieldId) } } : item); entries = entries.map((item) => { const values = { ...item.values }; delete values[fieldId]; return { ...item, values }; }); },
    seed: async () => undefined, clear: async () => { models = []; entries = []; },
  } };
}
