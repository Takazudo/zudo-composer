import { describe, expect, it, vi } from "vitest";
import { createMappingRecord } from "../../../mapping";
import type { MappingAttachmentCallbacks, MappingAttachmentItem, MappingAttachmentSnapshot } from "../attachments";
import {
  COMPOSITION_REF,
  CONTENT_REF,
  composition,
  entry,
  HEADING_NODE,
  HEADING_TARGET,
  NOW,
  READY_BINDING,
  RESOLVED_ENTRIES,
  harness,
  mappingRecord,
  model,
} from "./harness";

describe("MappingEditorController", () => {
  it("drains newer edits accepted during an in-flight shared flush", async () => {
    const source = mappingRecord([READY_BINDING]); const h = harness([source]);
    await h.controller.initialize(); await h.controller.open(source.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = h.provider.store.put.bind(h.provider.store);
    const put = vi.spyOn(h.provider.store, "put").mockImplementationOnce(async (record) => { await gate; await original(record); });
    h.controller.rename("First"); const pending = h.controller.flush();
    h.controller.rename("Newest"); const joined = h.controller.flush();
    release(); await Promise.all([pending, joined]);
    expect(put).toHaveBeenCalledTimes(2); expect(h.records.get(source.id)?.document.name).toBe("Newest");
    expect(h.controller.state.saveStatus).toBe("saved");
  });
  it("creates, resolves, binds, evaluates, saves, reloads, reorders and deletes", async () => {
    const h = harness();
    await h.controller.initialize();
    const id = await h.controller.create("Article Mapping", CONTENT_REF, COMPOSITION_REF);
    // Creating is not opening: the route is URL-addressed, so it navigates.
    expect(h.controller.state.mapping).toBeNull();
    expect(h.controller.state.mappings.map((summary) => summary.id)).toEqual([id]);

    await h.controller.open(id);
    expect(h.controller.state.definition?.status).toBe("ready");
    await h.controller.addBinding("field-title", HEADING_TARGET);
    expect(h.controller.state.evaluation?.status).toBe("ready");
    expect(h.controller.state.previewDocument?.root[0]?.props[HEADING_TARGET.prop]).toEqual(entry.values["field-title"]);

    h.controller.rename("Renamed");
    await h.controller.flush();
    await h.controller.close();
    await h.controller.open(id);
    expect(h.controller.state.mapping?.document.name).toBe("Renamed");

    await h.controller.removeBinding(h.controller.state.mapping!.document.bindings[0]!.id);
    await h.controller.flush();
    await h.controller.delete(id);
    expect(h.records.size).toBe(0);
  });

  it("duplicates a stored record under a fresh id without touching the original", async () => {
    const source = mappingRecord([READY_BINDING]);
    source.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [{ fieldId: "field-title", operator: "contains", value: "Hello" }], sort: [{ fieldId: "field-date", direction: "desc" }], pins: [{ providerId: CONTENT_REF.providerId, modelId: CONTENT_REF.recordId, recordId: entry.id }], limit: 7 } };
    const h = harness([source]);
    await h.controller.initialize();
    const duplicateId = await h.controller.duplicate(source.id);

    expect(duplicateId).not.toBe(source.id);
    const copy = h.records.get(duplicateId)!;
    expect(copy.document.name).toBe("Article Mapping copy");
    expect(copy.document.id).toBe(duplicateId);
    expect(copy.document.bindings).toEqual(source.document.bindings);
    expect(copy.document.mode).toEqual(source.document.mode);
    expect(copy.document.contentModel).toEqual(source.document.contentModel);
    expect(copy.document.composition).toEqual(source.document.composition);
    expect(h.records.get(source.id)!.document.name).toBe("Article Mapping");
    expect(h.controller.state.mappings.map((summary) => summary.id).sort()).toEqual([duplicateId, source.id].sort());
  });

  it("clears every stored Mapping and refreshes the library summaries", async () => {
    const h = harness([mappingRecord([], "mapping-1", "First"), mappingRecord([], "mapping-2", "Second")]);
    const clear = vi.spyOn(h.provider.store, "clear");
    await h.controller.initialize();

    await h.controller.clear();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(h.records.size).toBe(0);
    expect(h.controller.state.mappings).toEqual([]);
    expect(h.controller.state.libraryDetails).toEqual({});
  });

  it("refuses to create or duplicate onto an id that already exists", async () => {
    const existing = mappingRecord([], "taken", "Already here");
    // An id factory that collides is the whole hazard: `put` overwrites.
    const h = harness([existing], RESOLVED_ENTRIES, { idFactory: () => "taken" });
    await h.controller.initialize();

    await expect(h.controller.create("Colliding", CONTENT_REF, COMPOSITION_REF)).rejects.toThrow(/already exists/);
    await expect(h.controller.duplicate(existing.id)).rejects.toThrow(/already exists/);
    expect(h.records.size).toBe(1);
    expect(h.records.get("taken")!.document.name).toBe("Already here");
  });

  it("fails closed when deleting a Mapping without an attachment snapshot service", async () => {
    const source = mappingRecord();
    const h = harness([source], RESOLVED_ENTRIES, { attachments: undefined });
    await h.controller.initialize();
    await expect(h.controller.delete(source.id)).rejects.toThrow(/could not be verified/);
    expect(h.records.has(source.id)).toBe(true);
  });

  it("fails closed for Mapping clear and start fresh without attachment mutation protection", async () => {
    const source = mappingRecord();
    const h = harness([source], RESOLVED_ENTRIES, { attachments: undefined });
    await h.controller.initialize();
    await expect(h.controller.clear()).rejects.toThrow(/Clearing Mappings/);
    await expect(h.controller.startFresh()).rejects.toThrow(/start fresh/);
    expect(h.records.has(source.id)).toBe(true);
  });

  it("preserves broken references until explicitly repaired", async () => {
    const broken = createMappingRecord({
      id: "mapping-broken",
      name: "Broken",
      contentModel: { providerId: "content-filesystem", recordId: "missing" },
      composition: { providerId: "files", recordId: "missing" },
      createdAt: NOW,
    });
    const h = harness([broken]);
    await h.controller.initialize();
    await h.controller.open(broken.id);
    expect(h.controller.state.definition?.diagnostics.map((item) => item.code))
      .toEqual(expect.arrayContaining(["content-model-not-found", "composition-not-found"]));
    expect(h.controller.state.mapping?.document.contentModel.recordId).toBe("missing");

    await h.controller.selectContentModel(CONTENT_REF);
    await h.controller.selectComposition(COMPOSITION_REF);
    expect(h.controller.state.definition?.status).toBe("ready");
  });

  it("surfaces provider failure and quarantined recovery without overwriting source", async () => {
    const failed = harness();
    failed.provider.initialization.initialize = async () => ({ status: "error", error: new Error("offline") as never });
    await failed.controller.initialize();
    expect(failed.controller.state.phase).toBe("error");
    expect(failed.controller.state.message).toBe("offline");

    const recovery = harness();
    recovery.provider.initialization.initialize = async () => ({
      status: "recovery-required",
      summaries: [],
      recovery: { kind: "quarantined", reason: "invalid", sourcePreserved: true, affectedRecordIds: ["bad"], message: "Malformed source preserved." },
    });
    await recovery.controller.initialize();
    expect(recovery.controller.state.phase).toBe("recovery");
    expect(recovery.controller.state.recoveryMessage).toContain("preserved");
    await recovery.controller.startFresh();
    expect(recovery.controller.state.phase).toBe("ready");
  });

  it("uses the provider-qualified Content source and never falls back across duplicate ids", async () => {
    const selectedEntry = { ...entry, values: { ...entry.values, "field-title": "Selected provider" } };
    const calls: string[] = [];
    const h = harness([], {
      async scan(ref) {
        calls.push(`scan:${ref.providerId}:${ref.recordId}`);
        return ref.providerId === CONTENT_REF.providerId
          ? { status: "resolved", snapshot: { model, count: 1, entries: [selectedEntry], diagnostics: [] } }
          : { status: "provider-error", reason: "wrong provider" };
      },
      async get(ref, id) {
        calls.push(`get:${ref.providerId}:${ref.recordId}:${id}`);
        return ref.providerId === CONTENT_REF.providerId
          ? { status: "resolved", entry: selectedEntry }
          : { status: "provider-error", reason: "wrong provider" };
      },
    });
    await h.controller.initialize();
    await h.controller.open(await h.controller.create("Qualified", CONTENT_REF, COMPOSITION_REF));
    expect(h.controller.state.entry?.values["field-title"]).toBe("Selected provider");
    await h.controller.selectEntry(entry.id);
    expect(calls.every((call) => call.includes(`${CONTENT_REF.providerId}:${model.id}`))).toBe(true);
  });

  it("surfaces an unavailable selected Content provider", async () => {
    const h = harness([], {
      async scan() { return { status: "provider-error", reason: "Provider alpha is unavailable." }; },
      async get() { return { status: "provider-error", reason: "Provider alpha is unavailable." }; },
    });
    await h.controller.initialize();
    await h.controller.open(await h.controller.create("Unavailable", CONTENT_REF, COMPOSITION_REF));
    expect(h.controller.state.entryFailure).toBe("Provider alpha is unavailable.");
    expect(h.controller.state.entries).toEqual([]);
  });

  it("persists a collection query and keeps its effective result deterministic", async () => {
    const source = mappingRecord([READY_BINDING]);
    source.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 1 } };
    const h = harness([source]);
    await h.controller.initialize();
    await h.controller.open(source.id);

    expect(h.controller.state.collectionEvaluation?.entries.map((candidate) => candidate.id)).toEqual([entry.id]);
    await h.controller.setCollectionPublication("published-only");
    expect(h.controller.state.collectionEvaluation?.entries).toEqual([]);
    expect(h.controller.state.collectionEvaluation?.diagnostics.map((diagnostic) => diagnostic.code)).toContain("empty-source");
    await h.controller.setCollectionPublication("include-drafts");
    await h.controller.setCollectionLimit(7);
    await h.controller.flush();

    expect(h.records.get(source.id)?.document.mode).toEqual({ kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 7 } });
  });

  it("keeps provider-qualified ordered pins in the current query", async () => {
    const source = mappingRecord([]);
    source.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 10 } };
    const h = harness([source]);
    await h.controller.initialize();
    await h.controller.open(source.id);
    await h.controller.setCollectionPins([{ providerId: CONTENT_REF.providerId, modelId: CONTENT_REF.recordId, recordId: entry.id }]);

    expect(h.controller.state.mapping?.document.mode).toMatchObject({ kind: "collection", query: { pins: [{ providerId: CONTENT_REF.providerId, modelId: CONTENT_REF.recordId, recordId: entry.id }] } });
    expect(h.controller.state.collectionEvaluation?.entries[0]?.id).toBe(entry.id);
  });

  it("uses aggregate attachment callbacks for named-slot attach, preview and detach", async () => {
    const source = mappingRecord([]);
    source.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 10 } };
    const attachment = {
      id: "feed",
      order: 0,
      composition: { ...COMPOSITION_REF },
      target: { nodeId: HEADING_NODE, slotId: "body" },
      mapping: { providerId: "mapping-filesystem", recordId: source.id },
    } as const;
    const item: MappingAttachmentItem = {
      attachment,
      target: { composition: { ...COMPOSITION_REF }, compositionName: "Article page", nodeId: HEADING_NODE, slotId: "body", slotLabel: "Body", componentId: "ui.section-heading", cardinality: "many" },
      mapping: { providerId: "mapping-filesystem", recordId: source.id },
      mappingName: source.document.name,
      effectiveEntries: [entry],
      staticFallback: composition.document,
      diagnostics: [],
    };
    let snapshot: MappingAttachmentSnapshot = { targets: [item.target], attachments: [] };
    const requests: string[] = [];
    const callbacks: MappingAttachmentCallbacks = {
      async list() { return snapshot; },
      async attach(request) { requests.push(`${request.composition.providerId}/${request.composition.recordId}:${request.target.nodeId}.${request.target.slotId}:${request.mapping.providerId}/${request.mapping.recordId}`); snapshot = { ...snapshot, attachments: [item] }; },
      async detach(received) { requests.push(`detach:${received.id}`); snapshot = { ...snapshot, attachments: [] }; },
      async preview() { return { status: "ready", document: composition.document, staticFallback: composition.document, effectiveEntries: [entry], diagnostics: [] }; },
      async assertMappingDeletable() {},
      async withMappingMutation(mapping, action) {
        if (mapping && snapshot.attachments.some((candidate) => candidate.mapping.providerId === mapping.providerId && candidate.mapping.recordId === mapping.recordId)) throw new Error("attached Mapping cannot change mode");
        return action();
      },
    };
    const h = harness([source], RESOLVED_ENTRIES, { attachments: callbacks });
    await h.controller.initialize();
    await h.controller.open(source.id);
    await h.controller.attachCollection({ composition: { ...COMPOSITION_REF }, target: { nodeId: HEADING_NODE, slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: source.id } });
    expect(requests[0]).toBe(`files/composition-1:${HEADING_NODE}.body:mapping-filesystem/${source.id}`);
    expect(h.controller.state.attachments.snapshot?.attachments).toHaveLength(1);
    await expect(h.controller.setMode("single")).rejects.toThrow(/attached Mapping/);
    expect(h.controller.state.mapping?.document.mode.kind).toBe("collection");
    await h.controller.previewCollectionAttachment(attachment.id);
    expect(h.controller.state.attachments.preview?.status).toBe("ready");
    await h.controller.detachCollection(attachment.id);
    expect(requests.at(-1)).toBe("detach:feed");
    expect(h.controller.state.attachments.snapshot?.attachments).toHaveLength(0);
  });

  it("keeps list and preview request epochs independent while rejecting a late preview after selection refresh", async () => {
    const source = mappingRecord([]);
    source.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 10 } };
    const attachment = { id: "feed", order: 0, composition: { ...COMPOSITION_REF }, target: { nodeId: HEADING_NODE, slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: source.id } } as const;
    const item: MappingAttachmentItem = {
      attachment,
      target: { composition: { ...COMPOSITION_REF }, compositionName: "Article page", nodeId: HEADING_NODE, slotId: "body", slotLabel: "Body", componentId: "ui.section-heading", cardinality: "many" },
      mapping: { providerId: "mapping-filesystem", recordId: source.id },
      mappingName: source.document.name,
      effectiveEntries: [entry],
      staticFallback: composition.document,
      diagnostics: [],
    };
    let listCalls = 0;
    let releaseList!: () => void;
    let listStarted!: () => void;
    const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
    const listStartedGate = new Promise<void>((resolve) => { listStarted = resolve; });
    let releasePreview!: () => void;
    let previewStarted!: () => void;
    const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
    const previewStartedGate = new Promise<void>((resolve) => { previewStarted = resolve; });
    const snapshot: MappingAttachmentSnapshot = { targets: [item.target], attachments: [item] };
    const callbacks: MappingAttachmentCallbacks = {
      async list() {
        listCalls += 1;
        if (listCalls === 1) return snapshot;
        listStarted();
        await listGate;
        return snapshot;
      },
      async attach() {},
      async detach() {},
      async preview() {
        previewStarted();
        await previewGate;
        return { status: "ready", document: composition.document, staticFallback: composition.document, effectiveEntries: [entry], diagnostics: [] };
      },
      async assertMappingDeletable() {},
      async withMappingMutation(_mapping, action) { return action(); },
    };
    const h = harness([source], RESOLVED_ENTRIES, { attachments: callbacks });
    await h.controller.initialize();
    await h.controller.open(source.id);

    const refreshing = h.controller.refreshAttachments();
    await listStartedGate;
    const previewing = h.controller.previewCollectionAttachment(attachment.id);
    await previewStartedGate;
    releasePreview();
    await previewing;
    expect(h.controller.state.attachments.preview?.status).toBe("ready");
    releaseList();
    await refreshing;
    expect(h.controller.state.attachments.preview).toBeNull();
  });
});
