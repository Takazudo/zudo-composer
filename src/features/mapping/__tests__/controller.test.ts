import { describe, expect, it } from "vitest";
import { createSequentialIdFactory } from "../../../shared";
import { createMappingRecord, MAPPING_PROVIDERS, type CompositionCatalog, type MappingLoadOutcome, type MappingProvider, type MappingRecord } from "../../../mapping";
import type { ContentCatalog, ContentEntryRecord, ContentModelRecord } from "../../../content";
import type { CompositionRecord } from "../../../composer/library";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingEditorController, type MappingContentEntryCatalog } from "../controller";

const now = "2026-01-02T03:04:05.000Z";
const component = activeComponentProvider.manifest.components.find((item) => item.fields.some((field) => field.kind === "text"))!;
const targetField = component.fields.find((field) => field.kind === "text")!;
const sourceKind = "text" as const;
const model: ContentModelRecord = { id: "model-1", createdAt: now, updatedAt: now, document: { schemaVersion: 1, id: "model-1", name: "Articles", kind: "collection", fields: [{ id: "field-1", key: "title", label: "Title", required: true, kind: sourceKind }] } };
const entry: ContentEntryRecord = { schemaVersion: 1, id: "entry-1", modelId: model.id, createdAt: now, updatedAt: now, values: { "field-1": "Hello" } };
const composition: CompositionRecord = { id: "composition-1", createdAt: now, updatedAt: now, document: { schemaVersion: 2, id: "composition-1", name: "Article page", root: [{ id: "node-1", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] } };

function harness(seed: readonly MappingRecord[] = [], contentEntries: MappingContentEntryCatalog = {
  async scan(ref) { return ref.providerId === "content-indexeddb" && ref.recordId === model.id ? { status: "resolved", snapshot: { model, count: 1, entries: [entry], diagnostics: [] } } : { status: "not-found" }; },
  async get(ref, id) { return ref.providerId === "content-indexeddb" && ref.recordId === model.id && id === entry.id ? { status: "resolved", entry } : { status: "not-found" }; },
}) {
  const records = new Map(seed.map((record) => [record.id, structuredClone(record)])); let puts = 0;
  const provider: MappingProvider = { descriptor: MAPPING_PROVIDERS.indexeddb, store: { provider: MAPPING_PROVIDERS.indexeddb, async list() { return [...records.values()].map((record) => ({ id: record.id, name: record.document.name, createdAt: record.createdAt, updatedAt: record.updatedAt, bindingCount: record.document.bindings.length })); }, async get(id): Promise<MappingLoadOutcome> { const record = records.get(id); return record ? { status: "loaded", record: structuredClone(record) } : { status: "not-found", id }; }, async put(record) { puts += 1; records.set(record.id, structuredClone(record)); }, async delete(id) { return records.delete(id); }, async seed() {}, async clear() {} }, initialization: { async initialize() { return { status: "ready", summaries: await provider.store.list() }; }, async retry() { return this.initialize(); }, async startFresh() { records.clear(); return { status: "ready", summaries: [] }; } } };
  const content: ContentCatalog = { async listModels() { return { status: "listed", entries: [{ ref: { providerId: "content-indexeddb", recordId: model.id }, providerLabel: "Browser storage", summary: { id: model.id, name: model.document.name, kind: model.document.kind, fieldCount: 1, createdAt: now, updatedAt: now } }], failures: [] }; }, async resolveModel(ref) { return ref.recordId === model.id ? { status: "resolved", record: model } : { status: "not-found" }; } };
  const compositions: CompositionCatalog = { async list() { return { status: "listed", entries: [{ ref: { providerId: "indexeddb", recordId: composition.id }, providerLabel: "Browser storage", summary: { id: composition.id, name: composition.document.name, createdAt: now, updatedAt: now, nodeCount: 1 } }], failures: [] }; }, async resolve(ref) { return ref.recordId === composition.id ? { status: "resolved", record: composition } : { status: "not-found" }; } };
  const controller = new MappingEditorController(provider, { content, compositions }, contentEntries, activeComponentProvider.catalog, { idFactory: createSequentialIdFactory("test"), now: () => now });
  return { controller, provider, records, get puts() { return puts; } };
}

describe("MappingEditorController", () => {
  it("creates, resolves, binds, evaluates, saves, reloads, reorders and deletes", async () => {
    const h = harness(); await h.controller.initialize();
    await h.controller.create("Article Mapping", { providerId: "content-indexeddb", recordId: model.id }, { providerId: "indexeddb", recordId: composition.id });
    expect(h.controller.state.definition?.status).toBe("ready");
    await h.controller.addBinding("field-1", { nodeId: "node-1", prop: targetField.prop });
    expect(h.controller.state.evaluation?.status).toBe("ready");
    expect(h.controller.state.previewDocument?.root[0]?.props[targetField.prop]).toEqual(entry.values["field-1"]);
    h.controller.rename("Renamed"); await h.controller.flush();
    const id = h.controller.state.mapping!.id; await h.controller.close(); await h.controller.open(id);
    expect(h.controller.state.mapping?.document.name).toBe("Renamed");
    await h.controller.removeBinding(h.controller.state.mapping!.document.bindings[0]!.id); await h.controller.flush(); await h.controller.delete(id);
    expect(h.records.size).toBe(0);
  });

  it("preserves broken references until explicitly repaired", async () => {
    const broken = createMappingRecord({ id: "mapping-broken", name: "Broken", contentModel: { providerId: "content-indexeddb", recordId: "missing" }, composition: { providerId: "indexeddb", recordId: "missing" }, createdAt: now });
    const h = harness([broken]); await h.controller.initialize(); await h.controller.open(broken.id);
    expect(h.controller.state.definition?.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["content-model-not-found", "composition-not-found"]));
    expect(h.controller.state.mapping?.document.contentModel.recordId).toBe("missing");
    await h.controller.selectContentModel({ providerId: "content-indexeddb", recordId: model.id });
    await h.controller.selectComposition({ providerId: "indexeddb", recordId: composition.id });
    expect(h.controller.state.definition?.status).toBe("ready");
  });

  it("surfaces provider failure and quarantined recovery without overwriting source", async () => {
    const failed = harness(); failed.provider.initialization.initialize = async () => ({ status: "error", error: new Error("offline") as never });
    await failed.controller.initialize(); expect(failed.controller.state.phase).toBe("error"); expect(failed.controller.state.message).toBe("offline");
    const recovery = harness(); recovery.provider.initialization.initialize = async () => ({ status: "recovery-required", summaries: [], recovery: { kind: "quarantined", reason: "invalid", sourcePreserved: true, affectedRecordIds: ["bad"], message: "Malformed source preserved." } });
    await recovery.controller.initialize(); expect(recovery.controller.state.phase).toBe("recovery"); expect(recovery.controller.state.recoveryMessage).toContain("preserved");
    await recovery.controller.startFresh(); expect(recovery.controller.state.phase).toBe("ready");
  });

  it("uses the provider-qualified Content source and never falls back across duplicate ids", async () => {
    const selectedEntry = { ...entry, values: { "field-1": "Selected provider" } };
    const calls: string[] = [];
    const h = harness([], {
      async scan(ref) {
        calls.push(`scan:${ref.providerId}:${ref.recordId}`);
        return ref.providerId === "content-indexeddb" ? { status: "resolved", snapshot: { model, count: 1, entries: [selectedEntry], diagnostics: [] } } : { status: "provider-error", reason: "wrong provider" };
      },
      async get(ref, id) {
        calls.push(`get:${ref.providerId}:${ref.recordId}:${id}`);
        return ref.providerId === "content-indexeddb" ? { status: "resolved", entry: selectedEntry } : { status: "provider-error", reason: "wrong provider" };
      },
    });
    await h.controller.initialize();
    await h.controller.create("Qualified", { providerId: "content-indexeddb", recordId: model.id }, { providerId: "indexeddb", recordId: composition.id });
    expect(h.controller.state.entry?.values["field-1"]).toBe("Selected provider");
    await h.controller.selectEntry(entry.id);
    expect(calls.every((call) => call.includes("content-indexeddb:model-1"))).toBe(true);
  });

  it("surfaces an unavailable selected Content provider", async () => {
    const h = harness([], { async scan() { return { status: "provider-error", reason: "Provider alpha is unavailable." }; }, async get() { return { status: "provider-error", reason: "Provider alpha is unavailable." }; } });
    await h.controller.initialize();
    await h.controller.create("Unavailable", { providerId: "content-indexeddb", recordId: model.id }, { providerId: "indexeddb", recordId: composition.id });
    expect(h.controller.state.entryFailure).toBe("Provider alpha is unavailable.");
    expect(h.controller.state.entries).toEqual([]);
  });
});
