import { createSequentialIdFactory } from "../../../shared";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import { describe, expect, it, vi } from "vitest";
import { createContentAuthoringController, CONTENT_ENTRY_PAGE_SIZE } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ContentAuthoringController", () => {
  it("starts clean as pristine and resets that state for another Entry and model", async () => {
    const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
    const settings = createContentModelRecord({ name: "Settings", kind: "single", fields: [] }, { id: "settings", timestamp: "2026-01-01T00:00:00.000Z" });
    const secondEntry = createContentEntryRecord(articles.id, { title: "Second" }, { id: "entry-2", timestamp: "2026-01-01T00:00:00.000Z" });
    const provider = createMemoryContentProvider({ models: [articles, settings], entries: [secondEntry] });
    const controller = createContentAuthoringController(provider);

    expect(controller.state.saveStatus).toBe("pristine");
    await controller.initialize();
    expect(controller.state.saveStatus).toBe("pristine");
    await controller.openModel(articles.id);
    expect(controller.state.saveStatus).toBe("pristine");
    await controller.openEntry("entry-2");
    expect(controller.state.saveStatus).toBe("pristine");
    await controller.inspectSchema();
    expect(controller.state.saveStatus).toBe("pristine");
    await controller.openModel(settings.id);
    expect(controller.state.saveStatus).toBe("pristine");
  });

  it("transitions the first Entry edit through saving to saved", async () => {
    const controller = createContentAuthoringController(createMemoryContentProvider());
    await controller.initialize();
    await controller.openModel("articles");
    await controller.openEntry("entry-1");
    expect(controller.state.saveStatus).toBe("pristine");

    controller.updateEntryValue("title", "First edit");
    expect(controller.state.saveStatus).toBe("saving");
    await controller.flushSessions();
    expect(controller.state.saveStatus).toBe("saved");
  });

  it("creates Collection and Single models and enforces Single cardinality", async () => {
    const provider = createMemoryContentProvider();
    const controller = createContentAuthoringController(provider, { idFactory: createSequentialIdFactory("id"), now: () => "2026-02-01T00:00:00.000Z" });
    await controller.initialize();
    await controller.createModel("Posts", "collection");
    expect(controller.state.model?.document.kind).toBe("collection");
    await controller.createModel("Homepage", "single");
    await controller.createEntry();
    await expect(controller.createEntry()).rejects.toThrow("exactly one");
  });

  it("guards used field kinds, scrubs removed values, and saves incomplete drafts", async () => {
    const provider = createMemoryContentProvider();
    const controller = createContentAuthoringController(provider, { now: () => "2026-02-01T00:00:00.000Z" });
    await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("entry-1");
    expect(() => controller.updateField("title", { kind: "number" })).toThrow("cannot change");
    controller.updateEntryValue("title", ""); await controller.flushSessions();
    expect(controller.completeness()).toHaveLength(1);
    const saved = await provider.store.getEntry("entry-1");
    expect(saved.status === "loaded" && saved.record.values.title).toBeUndefined();
    await controller.removeField("title");
    const reloaded = await provider.store.getEntry("entry-1");
    expect(reloaded.status === "loaded" && reloaded.record.values.title).toBeUndefined();
  });

  it("locks a field used outside the bounded Entry page", async () => {
    const provider = createMemoryContentProvider();
    vi.spyOn(provider.store, "pageEntries").mockResolvedValue({ entries: [] });
    const controller = createContentAuthoringController(provider);
    await controller.initialize();
    await controller.openModel("articles");
    expect(controller.state.entries).toEqual([]);
    expect(controller.state.usedFieldIds).toContain("title");
    expect(() => controller.updateField("title", { kind: "number" })).toThrow("cannot change");
  });

  it("requests bounded pages, loads the next page, deletes, and reloads", async () => {
    const provider = createMemoryContentProvider(); const original = provider.store.pageEntries;
    const pageEntries = vi.spyOn(provider.store, "pageEntries").mockImplementation(async (id, options) => {
      if (!options?.cursor) { const page = await original(id, options); return { ...page, nextCursor: "1" }; }
      return { entries: [] };
    });
    const controller = createContentAuthoringController(provider); await controller.initialize(); await controller.openModel("articles");
    expect(pageEntries).toHaveBeenCalledWith("articles", { limit: CONTENT_ENTRY_PAGE_SIZE });
    await controller.loadMoreEntries(); expect(pageEntries).toHaveBeenLastCalledWith("articles", { limit: CONTENT_ENTRY_PAGE_SIZE, cursor: "1" });
    await controller.deleteEntry("entry-1"); expect(controller.state.entries).toHaveLength(0);
    await controller.deleteModel("articles"); expect(controller.state.models).toHaveLength(0);
  });

  it("keeps the selected model and Entry when deleting another model", async () => {
    const provider = createMemoryContentProvider();
    await provider.store.putModel(createContentModelRecord({ name: "Other", kind: "collection", fields: [] }, { id: "other", timestamp: "2026-01-01T00:00:00.000Z" }));
    const controller = createContentAuthoringController(provider);
    await controller.initialize();
    await controller.openModel("articles");
    await controller.openEntry("entry-1");

    await controller.deleteModel("other");

    expect(controller.state.model?.id).toBe("articles");
    expect(controller.state.entry?.id).toBe("entry-1");
  });

  it("surfaces latest-wins save failure and retries the retained draft", async () => {
    const provider = createMemoryContentProvider(); const original = provider.store.putEntry; let fail = true;
    vi.spyOn(provider.store, "putEntry").mockImplementation(async (record) => { if (fail) { fail = false; throw new Error("offline"); } await original(record); });
    const controller = createContentAuthoringController(provider); await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("entry-1");
    controller.updateEntryValue("title", "Latest"); await tick(); expect(controller.state.saveStatus).toBe("error");
    controller.retrySave(); await controller.flushSessions(); expect(controller.state.saveStatus).toBe("saved");
    const saved = await provider.store.getEntry("entry-1"); expect(saved.status === "loaded" && saved.record.values.title).toBe("Latest");
  });

  it("keeps quarantine explicit and starts fresh only on request", async () => {
    const provider = createMemoryContentProvider({ initialization: { status: "recovery-required", models: [], recovery: { kind: "quarantined", reason: "invalid", sourcePreserved: true, affectedRecordIds: ["broken"], message: "Malformed data preserved." } } });
    const controller = createContentAuthoringController(provider); await controller.initialize();
    expect(controller.state.phase).toBe("recovery"); expect(controller.state.recoveryMessage).toContain("preserved");
    await controller.startFresh(); expect(controller.state.phase).toBe("ready");
  });

  it("returns from an Entry to schema inspection after flushing", async () => {
    const provider = createMemoryContentProvider(); const controller = createContentAuthoringController(provider);
    await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("entry-1");
    controller.updateEntryValue("title", "Saved before schema"); await controller.inspectSchema();
    expect(controller.state.entry).toBeNull(); expect(controller.state.workMode).toBe("model-fields");
    const saved = await provider.store.getEntry("entry-1"); expect(saved.status === "loaded" && saved.record.values.title).toBe("Saved before schema");
  });

  it("transitions count-loading failures into the recoverable error UI state", async () => {
    const provider = createMemoryContentProvider(); vi.spyOn(provider.store, "countEntries").mockRejectedValue(new Error("count failed"));
    const controller = createContentAuthoringController(provider); await controller.initialize();
    expect(controller.state.phase).toBe("error"); expect(controller.state.message).toBe("count failed");
  });
});
