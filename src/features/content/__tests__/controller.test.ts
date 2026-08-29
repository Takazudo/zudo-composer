import { createSequentialIdFactory } from "../../../shared";
import { describe, expect, it, vi } from "vitest";
import { createContentAuthoringController, CONTENT_ENTRY_PAGE_SIZE } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ContentAuthoringController", () => {
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
});
