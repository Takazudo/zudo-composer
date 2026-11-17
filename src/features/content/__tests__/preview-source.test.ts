import { describe, expect, it, vi } from "vitest";
import { createComponentCatalog } from "../../../composer/model/types";
import type { CompositionRecord } from "../../../composer/library";
import type { ContentCatalog, ContentModelRef } from "../../../content/catalog";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_MODEL_SCHEMA_VERSION, type ContentEntryRecord, type ContentModelRecord } from "../../../content/model";
import { createMappingCatalog, createMappingRecord, type CompositionCatalog, type MappingCatalog, type MappingCatalogEntry, type MappingRecord } from "../../../mapping";
import { createContentPreviewSource } from "../preview-source";

const stamp = "2026-08-30T00:00:00.000Z";
const contentRef = { providerId: "content-a", recordId: "articles" };
const otherRef = { providerId: "content-b", recordId: "articles" };
const model: ContentModelRecord = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { description: "", schemaVersion: CONTENT_MODEL_SCHEMA_VERSION, id: "articles", name: "Articles", kind: "collection", fields: [{ id: "body", key: "body", label: "Body", required: true, kind: "markdown" }] } };
const composition: CompositionRecord = { id: "page", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 2, id: "page", name: "Article page", root: [{ id: "copy", componentId: "copy", componentVersion: 1, props: { markdown: "Static" }, slots: {} }] } };
const manifest = createComponentCatalog({ kind: "zudo-composer/component-pack", contractVersion: 2, packId: "test", packVersion: "1", components: [{ id: "copy", schemaVersion: 1, title: "Copy", category: "Test", description: "", source: { module: "x", exportKind: "named", exportName: "Copy" }, defaults: {}, fields: [{ schema: { type: "string" }, editor: { kind: "text" }, prop: "markdown", label: "Markdown" }], slots: [] }] });
const entry = (value: string): ContentEntryRecord => ({ lifecycle: "draft" as const, generation: 0, schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION, id: "draft", modelId: model.id, createdAt: stamp, updatedAt: stamp, values: { body: value } });
const mapping = (id: string, ref: ContentModelRef = contentRef, sourceFieldId = "body"): MappingRecord => createMappingRecord({ id, name: id, contentModel: ref, composition: { providerId: "files", recordId: composition.id }, bindings: [{ id: `${id}-binding`, sourceFieldId, target: { nodeId: "copy", prop: "markdown" }, transform: { kind: "identity" } }], createdAt: stamp });
const catalogEntry = (id: string, providerId = "mapping"): MappingCatalogEntry => ({ ref: { providerId, recordId: id }, providerLabel: providerId, summary: { id, name: id, createdAt: stamp, updatedAt: stamp, bindingCount: 1 } });

function harness(options: { list?: MappingCatalog["list"]; resolve?: MappingCatalog["resolve"]; readInventory?: MappingCatalog["readInventory"] } = {}) {
  const records = new Map([["ready", mapping("ready")], ["blocked", mapping("blocked", contentRef, "missing")], ["wrong-provider", mapping("wrong-provider", otherRef)]]);
  const resolve = options.resolve ?? vi.fn(async (ref) => ref.recordId === "broken" ? { status: "invalid" as const, reason: "Malformed Mapping preserved." } : { status: "resolved" as const, record: records.get(ref.recordId)! });
  const mappings: MappingCatalog = {
    ...(options.readInventory ? { readInventory: options.readInventory } : {}),
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

  it("keeps ready candidates available when another candidate throws during resolution", async () => {
    const h = harness({
      list: vi.fn(async () => ({
        status: "listed" as const,
        entries: [catalogEntry("ready"), catalogEntry("unavailable")],
        failures: [],
      })),
      resolve: vi.fn(async (ref) => {
        if (ref.recordId === "unavailable") throw new Error("Provider disconnected.");
        return { status: "resolved" as const, record: mapping("ready") };
      }),
    });

    await h.source.load(contentRef, entry("Still previewable"));

    expect(h.source.state).toMatchObject({
      phase: "ready",
      selectedRef: { providerId: "mapping", recordId: "ready" },
      document: { root: [{ props: { markdown: "Still previewable" } }] },
    });
    expect(h.source.state.failures).toContainEqual({
      scope: "candidate",
      mappingRef: { providerId: "mapping", recordId: "unavailable" },
      message: "Provider disconnected.",
    });
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
    expect(h.source.state).toMatchObject({ phase: "loading", modelRef: otherRef, candidates: [], selectedRef: null, document: null });
    h.source.evaluate(entry("must not use stale definition"));
    expect(h.source.state.document).toBeNull();
    await current;
    release({ status: "listed", entries: [catalogEntry("ready")], failures: [] });
    await stale;
    expect(h.source.state.modelRef).toEqual(otherRef);
    expect(h.source.state.candidates).toEqual([]);
    expect(h.source.state.requestRevision).toBe(2);
  });
});

describe("Content preview batch discovery", () => {
 it("filters many unrelated records without gets and resolves the qualified model once per load", async () => {
  const records = [...Array.from({length:165},(_,i)=>mapping("unrelated-"+i,otherRef)),mapping("ready"),mapping("blocked",contentRef,"missing")];
  const snapshot=vi.fn(async()=>({mutationToken:"token",records}));const list=vi.fn(async()=>[]),get=vi.fn();
  const catalog=createMappingCatalog([{descriptor:{id:"mapping",label:"Mapping"},store:{list,get,snapshot}}]);const h=harness({readInventory:catalog.readInventory});
  await h.source.load(contentRef,entry("draft"));expect(snapshot).toHaveBeenCalledTimes(1);expect(list).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();expect(h.resolve).not.toHaveBeenCalled();expect(h.content.resolveModel).toHaveBeenCalledTimes(1);expect(h.compositions.resolve).toHaveBeenCalledTimes(2);expect(h.source.state.candidates.map(c=>c.ref.recordId)).toEqual(["blocked","ready"]);
  await h.source.load(contentRef,entry("next"));expect(snapshot).toHaveBeenCalledTimes(2);expect(h.content.resolveModel).toHaveBeenCalledTimes(2);
 });
 it("memoizes missing model outcomes only for one load, preserving blocked candidates",async()=>{
  const h=harness();vi.mocked(h.content.resolveModel).mockResolvedValue({status:"not-found"});await h.source.load(contentRef,entry("draft"));expect(h.content.resolveModel).toHaveBeenCalledTimes(1);expect(h.source.state.candidates.every(c=>c.status==="broken")).toBe(true);
  vi.mocked(h.content.resolveModel).mockResolvedValue({status:"resolved",record:model});await h.source.load(contentRef,entry("next"));expect(h.content.resolveModel).toHaveBeenCalledTimes(2);expect(h.source.state.selectedRef?.recordId).toBe("ready");
 });
 it("does not publish or resolve a stale inventory after switching models",async()=>{
  let release!: (value: Awaited<ReturnType<NonNullable<MappingCatalog["readInventory"]>>>)=>void;let calls=0;
  const pending=new Promise<Awaited<ReturnType<NonNullable<MappingCatalog["readInventory"]>>>>(r=>{release=r;});
  const h=harness({readInventory:()=>++calls===1?pending:Promise.resolve({entries:[],failures:[],snapshots:[]})});const old=h.source.load(contentRef,entry("old"));await Promise.resolve();await Promise.resolve();await h.source.load(otherRef,entry("new"));release({entries:[catalogEntry("ready")],failures:[],snapshots:[{providerId:"mapping",snapshot:{mutationToken:"old",records:[mapping("ready")]}}]});await old;expect(h.source.state.modelRef).toEqual(otherRef);expect(h.source.state.candidates).toEqual([]);expect(h.content.resolveModel).not.toHaveBeenCalled();
 });
});

it("keeps equal Mapping IDs provider-qualified and retains dangling Composition diagnostics",async()=>{
 const first=mapping("same"),foreign=mapping("same",otherRef);
 const providers=[{descriptor:{id:"first",label:"First"},store:{list:vi.fn(),get:vi.fn(),snapshot:async()=>({mutationToken:"1",records:[first]})}},{descriptor:{id:"foreign",label:"Foreign"},store:{list:vi.fn(),get:vi.fn(),snapshot:async()=>({mutationToken:"1",records:[foreign]})}}];
 const catalog=createMappingCatalog(providers),h=harness({readInventory:catalog.readInventory});vi.mocked(h.compositions.resolve).mockResolvedValue({status:"not-found"});await h.source.load(contentRef,entry("draft"));
 expect(h.source.state.candidates).toHaveLength(1);expect(h.source.state.candidates[0]).toMatchObject({ref:{providerId:"first",recordId:"same"},status:"broken"});expect(h.source.state.candidates[0]!.diagnostics.map(d=>d.code)).toContain("composition-not-found");expect(h.source.state.selectedRef).toBeNull();expect(h.content.resolveModel).toHaveBeenCalledTimes(1);
});


it("does not let a malformed legacy reference reuse a valid model memo", async () => {
 const valid = mapping("valid"), malformed = mapping("malformed");
 Object.assign(malformed.document.contentModel, { unexpected: true });
 const h = harness({ list: async () => ({ status: "listed", entries: [catalogEntry("valid"), catalogEntry("malformed")], failures: [] }), resolve: async ref => ({ status: "resolved", record: ref.recordId === "valid" ? valid : malformed }) });
 vi.mocked(h.content.resolveModel).mockImplementation(async ref => Object.keys(ref).length === 2 ? { status: "resolved", record: model } : { status: "invalid", reason: "Malformed qualified reference." });
 await h.source.load(contentRef, entry("draft"));
 expect(h.content.resolveModel).toHaveBeenCalledTimes(2);
 expect(h.source.state.candidates.map(candidate => [candidate.ref.recordId, candidate.status])).toEqual([["valid", "ready"], ["malformed", "broken"]]);
});
