import { describe, expect, it } from "vitest";
import { createMappingRecord } from "../../../mapping";
import {
  COMPOSITION_REF,
  CONTENT_REF,
  entry,
  HEADING_TARGET,
  NOW,
  READY_BINDING,
  harness,
  mappingRecord,
  model,
} from "./harness";

describe("MappingEditorController", () => {
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
    const h = harness([source]);
    await h.controller.initialize();
    const duplicateId = await h.controller.duplicate(source.id);

    expect(duplicateId).not.toBe(source.id);
    const copy = h.records.get(duplicateId)!;
    expect(copy.document.name).toBe("Article Mapping copy");
    expect(copy.document.id).toBe(duplicateId);
    expect(copy.document.bindings).toEqual(source.document.bindings);
    expect(h.records.get(source.id)!.document.name).toBe("Article Mapping");
    expect(h.controller.state.mappings.map((summary) => summary.id).sort()).toEqual([duplicateId, source.id].sort());
  });

  it("preserves broken references until explicitly repaired", async () => {
    const broken = createMappingRecord({
      id: "mapping-broken",
      name: "Broken",
      contentModel: { providerId: "content-indexeddb", recordId: "missing" },
      composition: { providerId: "indexeddb", recordId: "missing" },
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
});
