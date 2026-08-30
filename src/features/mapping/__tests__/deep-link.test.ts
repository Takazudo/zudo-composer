import { describe, expect, it, vi } from "vitest";
import { createMappingRecord, MAPPING_PROVIDERS, type MappingProvider, type MappingRecord } from "../../../mapping";
import type { CompositionRecord } from "../../../composer/library";
import type { ContentCatalog, ContentEntryRecord, ContentModelRecord } from "../../../content";
import { activeComponentProvider } from "../../composer/active-pack";
import { createMappingEditorController } from "../controller";
import { mappingDeepLinkHref, parseMappingDeepLink } from "../deep-link";

const now = "2026-01-02T03:04:05.000Z";
const component = activeComponentProvider.manifest.components.find((item) => item.fields.some((field) => field.kind === "text"))!;
const model: ContentModelRecord = { id: "model-1", createdAt: now, updatedAt: now, document: { schemaVersion: 1, id: "model-1", name: "Articles", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }] } };
const entry: ContentEntryRecord = { schemaVersion: 1, id: "entry-1", modelId: model.id, createdAt: now, updatedAt: now, values: { title: "Hello" } };
const composition: CompositionRecord = { id: "composition-1", createdAt: now, updatedAt: now, document: { schemaVersion: 2, id: "composition-1", name: "Article page", root: [{ id: "node-1", componentId: component.id, componentVersion: component.schemaVersion, props: { ...component.defaults }, slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])) }] } };
const record = createMappingRecord({ id: "mapping-1", name: "Article", contentModel: { providerId: "content-indexeddb", recordId: model.id }, composition: { providerId: "indexeddb", recordId: composition.id }, createdAt: now });

function controllerFor(records: readonly MappingRecord[] = [record], getOverride?: MappingProvider["store"]["get"]) {
  const stored = new Map(records.map((item) => [item.id, item]));
  const provider: MappingProvider = {
    descriptor: MAPPING_PROVIDERS.indexeddb,
    store: {
      provider: MAPPING_PROVIDERS.indexeddb,
      async list() { return [...stored.values()].map((item) => ({ id: item.id, name: item.document.name, createdAt: item.createdAt, updatedAt: item.updatedAt, bindingCount: item.document.bindings.length })); },
      async get(id) { return getOverride ? getOverride(id) : stored.has(id) ? { status: "loaded" as const, record: stored.get(id)! } : { status: "not-found" as const, id }; },
      async put(item) { stored.set(item.id, item); },
      async delete(id) { return stored.delete(id); },
      async seed() {},
      async clear() { stored.clear(); },
    },
    initialization: {
      async initialize() { return { status: "ready" as const, summaries: await provider.store.list() }; },
      async retry() { return provider.initialization.initialize(); },
      async startFresh() { await provider.store.clear(); return { status: "ready" as const, summaries: [] }; },
    },
  };
  const content: ContentCatalog = {
    async listModels() { return { status: "listed" as const, entries: [{ ref: { providerId: "content-indexeddb", recordId: model.id }, providerLabel: "Browser storage", summary: { id: model.id, name: model.document.name, kind: model.document.kind, fieldCount: 1, createdAt: now, updatedAt: now } }], failures: [] }; },
    async resolveModel(ref) { return ref.recordId === model.id ? { status: "resolved" as const, record: model } : { status: "not-found" as const }; },
  };
  const compositions = {
    async list() { return { status: "listed" as const, entries: [{ ref: { providerId: "indexeddb" as const, recordId: composition.id }, providerLabel: "Browser storage", summary: { id: composition.id, name: composition.document.name, createdAt: now, updatedAt: now, nodeCount: 1 } }], failures: [] }; },
    async resolve(ref: { providerId: "indexeddb"; recordId: string }) { return ref.recordId === composition.id ? { status: "resolved" as const, record: composition } : { status: "not-found" as const }; },
  };
  const contentEntries = { async scan() { return { status: "resolved" as const, snapshot: { model, count: 1, entries: [entry], diagnostics: [] } }; }, async get() { return { status: "resolved" as const, entry }; } };
  return createMappingEditorController(provider, { content, compositions }, contentEntries, activeComponentProvider.catalog);
}

describe("Mapping provider-qualified deep links", () => {
  it("parses the canonical link and leaves ordinary Mapping routes alone", () => {
    expect(parseMappingDeepLink("https://example.test/mapping")).toEqual({ status: "none" });
    expect(parseMappingDeepLink(mappingDeepLinkHref({ providerId: "mapping-indexeddb", mappingId: "mapping-1" }))).toEqual({ status: "requested", request: { providerId: "mapping-indexeddb", mappingId: "mapping-1" } });
    expect(parseMappingDeepLink("/mapping?provider=mapping-indexeddb")).toMatchObject({ status: "invalid" });
    expect(parseMappingDeepLink("/mapping?mapping=../mapping-1&provider=mapping-indexeddb")).toMatchObject({ status: "invalid" });
    expect(parseMappingDeepLink("/composer?provider=mapping-indexeddb&mapping=mapping-1")).toEqual({ status: "none" });
  });

  it("rejects malformed requests before opening any record", async () => {
    const controller = controllerFor();
    await controller.initialize();
    const outcome = await controller.openDeepLink({ providerId: "mapping provider", mappingId: "mapping-1" });
    expect(outcome).toMatchObject({ status: "invalid" });
    expect(controller.state.mapping).toBeNull();
  });

  it("opens the exact provider-qualified record during direct initialization", async () => {
    const controller = controllerFor();
    await controller.initialize({ providerId: "mapping-indexeddb", mappingId: "mapping-1" });
    expect(controller.state.deepLink).toEqual({ status: "ready", request: { providerId: "mapping-indexeddb", mappingId: "mapping-1" } });
    expect(controller.state.mapping?.id).toBe("mapping-1");
  });

  it("reports missing records without falling back to the library", async () => {
    const controller = controllerFor([]);
    await controller.initialize({ providerId: "mapping-indexeddb", mappingId: "mapping-1" });
    expect(controller.state.deepLink).toMatchObject({ status: "missing", request: { mappingId: "mapping-1" } });
    expect(controller.state.mapping).toBeNull();
  });

  it("reports a provider mismatch and a provider read failure explicitly", async () => {
    const mismatch = controllerFor();
    await mismatch.initialize({ providerId: "other-provider", mappingId: "mapping-1" });
    expect(mismatch.state.deepLink).toMatchObject({ status: "provider-failure", request: { providerId: "other-provider" } });

    const failure = controllerFor([record], vi.fn(async () => { throw new Error("offline"); }));
    await failure.initialize({ providerId: "mapping-indexeddb", mappingId: "mapping-1" });
    expect(failure.state.deepLink).toMatchObject({ status: "provider-failure", message: "offline" });
  });

  it("does not leave a link loading while the provider needs recovery", async () => {
    const controller = controllerFor();
    controller.provider.initialization.initialize = async () => ({
      status: "recovery-required" as const,
      summaries: [],
      recovery: { kind: "quarantined" as const, reason: "invalid", sourcePreserved: true, affectedRecordIds: ["mapping-1"], message: "Malformed source preserved." },
    });
    await controller.initialize({ providerId: "mapping-indexeddb", mappingId: "mapping-1" });
    expect(controller.state.deepLink).toMatchObject({ status: "provider-failure", message: "Malformed source preserved." });
  });
});
