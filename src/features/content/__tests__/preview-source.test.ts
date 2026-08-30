import { describe, expect, it, vi } from "vitest";
import { createComponentCatalog } from "../../../composer/model/types";
import type { CompositionRecord } from "../../../composer/library";
import type { ContentCatalog, ContentModelRef } from "../../../content/catalog";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_MODEL_SCHEMA_VERSION, type ContentEntryRecord, type ContentModelRecord } from "../../../content/model";
import { createMappingRecord, type CompositionCatalog, type MappingCatalog, type MappingCatalogEntry, type MappingRecord } from "../../../mapping";
import { createContentPreviewSource } from "../preview-source";

const stamp = "2026-08-30T00:00:00.000Z";
const contentRef = { providerId: "content-a", recordId: "articles" };
const otherRef = { providerId: "content-b", recordId: "articles" };
const model: ContentModelRecord = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: CONTENT_MODEL_SCHEMA_VERSION, id: "articles", name: "Articles", kind: "collection", fields: [{ id: "body", key: "body", label: "Body", required: true, kind: "markdown" }] } };
const composition: CompositionRecord = { id: "page", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 2, id: "page", name: "Article page", root: [{ id: "copy", componentId: "copy", componentVersion: 1, props: { markdown: "Static" }, slots: {} }] } };
const manifest = createComponentCatalog({ kind: "zudo-composer/component-pack", contractVersion: 1, packId: "test", packVersion: "1", components: [{ id: "copy", schemaVersion: 1, title: "Copy", category: "Test", description: "", source: { module: "x", exportKind: "named", exportName: "Copy" }, defaults: {}, fields: [{ kind: "text", prop: "markdown", label: "Markdown" }], slots: [] }] });
const entry = (value: string): ContentEntryRecord => ({ schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION, id: "draft", modelId: model.id, createdAt: stamp, updatedAt: stamp, values: { body: value } });
const mapping = (id: string, ref: ContentModelRef = contentRef, sourceFieldId = "body"): MappingRecord => createMappingRecord({ id, name: id, contentModel: ref, composition: { providerId: "indexeddb", recordId: composition.id }, bindings: [{ id: `${id}-binding`, sourceFieldId, target: { nodeId: "copy", prop: "markdown" }, transform: { kind: "identity" } }], createdAt: stamp });
const catalogEntry = (id: string, providerId = "mapping"): MappingCatalogEntry => ({ ref: { providerId, recordId: id }, providerLabel: providerId, summary: { id, name: id, createdAt: stamp, updatedAt: stamp, bindingCount: 1 } });

function harness(options: { list?: MappingCatalog["list"]; resolve?: MappingCatalog["resolve"] } = {}) {
  const records = new Map([["ready", mapping("ready")], ["blocked", mapping("blocked", contentRef, "missing")], ["wrong-provider", mapping("wrong-provider", otherRef)]]);
  const resolve = options.resolve ?? vi.fn(async (ref) => ref.recordId === "broken" ? { status: "invalid" as const, reason: "Malformed Mapping preserved." } : { status: "resolved" as const, record: records.get(ref.recordId)! });
  const mappings: MappingCatalog = {
    list: options.list ?? vi.fn(async () => ({ status: "listed" as const, entries: [catalogEntry("ready"), catalogEntry("blocked"), catalogEntry("wrong-provider"), catalogEntry("broken")], failures: [{ providerId: "offline", providerLabel: "Offline", reason: "unavailable" }] })),
    resolve,
  };
  const content: ContentCatalog = { listModels: vi.fn(), resolveModel: vi.fn(async (ref) => ref.providerId === contentRef.providerId && ref.recordId === contentRef.recordId ? { status: "resolved" as const, record: model } : { status: "not-found" as const }) };
  const compositions: CompositionCatalog = { list: vi.fn(), resolve: vi.fn(async () => ({ status: "resolved" as const, record: composition })) };
  const calls: string[] = [];
  const source = createContentPreviewSource({ mappings, catalogs: { content, compositions }, manifest,
    initializeContent: async () => { calls.push("content"); return { status: "ready" }; },
    initializeMappings: async () => { calls.push("mapping"); return { status: "ready" }; },
  });
  return { source, calls, resolve, content, compositions };
}

describe("ContentPreviewSource", () => {
  it("initializes Content first, filters exact provider-qualified refs, and retains broken/blocked candidates plus partial failures", async () => {
    const h = harness();
    await h.source.load(contentRef, entry("# Current draft"));
    expect(h.calls).toEqual(["content", "mapping"]);
    expect(h.source.state.candidates.map(({ ref, status }) => [ref.recordId, status])).toEqual([["ready", "ready"], ["blocked", "broken"]]);
    expect(h.source.state.candidates.some(({ ref }) => ref.recordId === "wrong-provider")).toBe(false);
    expect(h.source.state.candidates.find(({ ref }) => ref.recordId === "blocked")?.diagnostics.map(({ code }) => code)).toContain("source-field-missing");
    expect(h.source.state.failures).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "catalog", providerId: "offline" }), expect.objectContaining({ scope: "candidate", mappingRef: expect.objectContaining({ recordId: "broken" }) })]));
    expect(h.source.state.selectedRef).toEqual({ providerId: "mapping", recordId: "ready" });
    expect(h.source.state.context).toMatchObject({ mapping: { id: "ready" }, composition: { id: "page" }, contentModel: { ref: contentRef }, entry: { providerId: "content-a", entryId: "draft" }, appliedBindingCount: 1, appliedBindings: [{ bindingId: "ready-binding", sourceFieldId: "body", target: { nodeId: "copy", prop: "markdown" }, value: "# Current draft" }] });
  });

  it("evaluates each current unsaved revision synchronously without rereading providers", async () => {
    const h = harness();
    await h.source.load(contentRef, entry("Stored-looking value"));
    const resolutionCalls = vi.mocked(h.resolve).mock.calls.length;
    const contentCalls = vi.mocked(h.content.resolveModel).mock.calls.length;
    const next = h.source.evaluate(entry("## Unsaved\n\n**Markdown**"));
    expect(next.document?.root[0]?.props.markdown).toBe("## Unsaved\n\n**Markdown**");
    expect(next.entryRevision).toBe(2);
    expect(vi.mocked(h.resolve)).toHaveBeenCalledTimes(resolutionCalls);
    expect(vi.mocked(h.content.resolveModel)).toHaveBeenCalledTimes(contentCalls);
  });

  it("suppresses stale asynchronous model-transition results", async () => {
    let release!: (value: Awaited<ReturnType<MappingCatalog["list"]>>) => void;
    let calls = 0;
    const first = new Promise<Awaited<ReturnType<MappingCatalog["list"]>>>((resolve) => { release = resolve; });
    const list: MappingCatalog["list"] = async () => ++calls === 1 ? first : { status: "listed", entries: [], failures: [] };
    const h = harness({ list });
    const stale = h.source.load(contentRef, entry("old"));
    await Promise.resolve(); await Promise.resolve();
    const current = h.source.load(otherRef, entry("new"));
    await current;
    release({ status: "listed", entries: [catalogEntry("ready")], failures: [] });
    await stale;
    expect(h.source.state.modelRef).toEqual(otherRef);
    expect(h.source.state.candidates).toEqual([]);
    expect(h.source.state.requestRevision).toBe(2);
  });
});
