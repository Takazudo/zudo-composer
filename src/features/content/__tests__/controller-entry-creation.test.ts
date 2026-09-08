import { describe, expect, it, vi } from "vitest";
import { createContentModelRecord, type ContentEntryRecord } from "../../../content";
import { createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const provider = createMemoryContentProvider();
  await provider.store.putModel(createContentModelRecord({ name: "Other", kind: "collection" }, { id: "other" }));
  const controller = createContentAuthoringController(provider);
  await controller.initialize(); await controller.openModel("articles");
  return { provider, controller };
}

describe("Content entry creation across selection", () => {
  it("holds entry insertion until a created model is selected and its row is published", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const page = provider.store.pageEntries.bind(provider.store);
    vi.spyOn(provider.store, "pageEntries").mockImplementation(async (id, options) => {
      if (id !== "articles") { started.resolve(); await release.promise; }
      return page(id, options);
    });
    const put = vi.spyOn(provider.store, "putEntry");
    const creating = controller.createModel("Single", "single");
    await started.promise;
    expect(controller.state.modelSelectionPending).toBe(true);
    expect(controller.state.models.some((model) => model.name === "Single")).toBe(false);
    await expect(controller.createEntry()).rejects.toThrow("selection to finish");
    await expect(controller.duplicateEntry("entry-1")).rejects.toThrow("selection to finish");
    expect(put).not.toHaveBeenCalled();
    release.resolve(); await creating;
    expect(controller.state.modelSelectionPending).toBe(false);
    expect(controller.state.model?.document.name).toBe("Single");
    expect(controller.state.models.some((model) => model.name === "Single")).toBe(true);
    await controller.createEntry();
    expect(controller.state.entry?.modelId).toBe(controller.state.model?.id);
    expect(controller.state.entryCounts[controller.state.model!.id]).toBe(1);
    expect(await provider.store.countEntries("articles")).toBe(1);
  });

  it("lets the latest selection clear pending state without waiting for superseded reads", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const get = provider.store.getModel.bind(provider.store);
    vi.spyOn(provider.store, "getModel").mockImplementation(async (id) => {
      if (id === "other") { started.resolve(); await release.promise; }
      return get(id);
    });
    const old = controller.openModel("other"); await started.promise;
    await controller.openModel("articles");
    expect(controller.state.modelSelectionPending).toBe(false);
    release.resolve(); await old;
    expect(controller.state.model?.id).toBe("articles");
    expect(controller.state.modelSelectionPending).toBe(false);
    await expect(controller.openModel("missing")).rejects.toThrow("not found");
    expect(controller.state.modelSelectionPending).toBe(false);
  });

  it.each([false, true])("keeps a late write in its original model and explicitly reports its location (duplicate: %s)", async (duplicate) => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const put = provider.store.putEntry.bind(provider.store);
    let saved: ContentEntryRecord | undefined;
    vi.spyOn(provider.store, "putEntry").mockImplementationOnce(async (entry) => {
      await put(entry); saved = entry; started.resolve(); await release.promise;
    });
    const creating = duplicate ? controller.duplicateEntry("entry-1") : controller.createEntry();
    const rejected = expect(creating).rejects.toThrow(/was saved in model "Articles".*newer selection was kept/);
    await started.promise;
    await controller.openModel("other");
    release.resolve(); await rejected;
    expect(controller.state.model?.id).toBe("other");
    expect(controller.state.entries).toEqual([]);
    expect(controller.state.entry).toBeNull();
    expect(controller.state.entryCreationPending).toBe(false);
    expect(controller.state.entryCounts.articles).toBe(2);
    expect((await provider.store.getEntry(saved!.id)).status).toBe("loaded");
    await controller.openModel("articles");
    expect(controller.state.entries.some((entry) => entry.id === saved!.id)).toBe(true);
    expect(controller.state.entryCounts.articles).toBe(2);
  });

  it("does not silently lose a committed entry when selection changes during its opening read", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const get = provider.store.getEntry.bind(provider.store);
    vi.spyOn(provider.store, "getEntry").mockImplementationOnce(async (id) => {
      started.resolve(); await release.promise; return get(id);
    });
    const creating = controller.createEntry();
    const rejected = expect(creating).rejects.toThrow('was saved in model "Articles"');
    await started.promise; await controller.openModel("other"); release.resolve(); await rejected;
    expect(controller.state.model?.id).toBe("other");
    expect(controller.state.entry).toBeNull(); expect(controller.state.entries).toEqual([]);
    expect(await provider.store.countEntries("articles")).toBe(2);
  });
  it("holds the public flush barrier until entry creation and opening have completed", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const put = provider.store.putEntry.bind(provider.store);
    vi.spyOn(provider.store, "putEntry").mockImplementationOnce(async (entry) => {
      started.resolve(); await release.promise; return put(entry);
    });
    const creating = controller.createEntry(); await started.promise;
    let flushed = false;
    const flushing = controller.flushSessions().then(() => { flushed = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flushed).toBe(false);
    release.resolve(); await Promise.all([creating, flushing]);
    expect(controller.state.entry?.modelId).toBe("articles");
    expect(flushed).toBe(true);
  });

  it("retains pending ownership across initialization and surfaces the result to the flush barrier", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const put = provider.store.putEntry.bind(provider.store);
    vi.spyOn(provider.store, "putEntry").mockImplementationOnce(async (entry) => {
      started.resolve(); await release.promise; return put(entry);
    });
    const creating = controller.createEntry();
    const rejected = expect(creating).rejects.toThrow('was saved in model "Articles"');
    await started.promise; await controller.initialize();
    expect(controller.state.entryCreationPending).toBe(true);
    await expect(controller.createEntry()).rejects.toThrow("pending Entry creation");
    const flushing = expect(controller.flushSessions()).rejects.toThrow('was saved in model "Articles"');
    release.resolve(); await Promise.all([rejected, flushing]);
    expect(controller.state.entryCreationPending).toBe(false);
    expect(controller.state.model).toBeNull(); expect(controller.state.entries).toEqual([]);
    expect(await provider.store.countEntries("articles")).toBe(2);
  });

  it("does not overwrite a newer model count with a delayed completion count read", async () => {
    const { provider, controller } = await fixture();
    const started = deferred<void>(), release = deferred<void>();
    const countStarted = deferred<void>(), countResult = deferred<number>();
    const put = provider.store.putEntry.bind(provider.store);
    vi.spyOn(provider.store, "putEntry").mockImplementationOnce(async (entry) => {
      await put(entry); started.resolve(); await release.promise;
    });
    const creating = controller.createEntry();
    const rejected = expect(creating).rejects.toThrow('was saved in model "Articles"');
    await started.promise; await controller.openModel("other");
    vi.spyOn(provider.store, "countEntries").mockImplementationOnce(() => { countStarted.resolve(); return countResult.promise; });
    release.resolve(); await countStarted.promise;
    await controller.openModel("articles");
    expect(controller.state.entryCounts.articles).toBe(2);
    countResult.resolve(1); await rejected;
    expect(controller.state.entryCounts.articles).toBe(2);
  });

  it("clears failed creation ownership so a new operation can succeed", async () => {
    const { provider, controller } = await fixture();
    vi.spyOn(provider.store, "putEntry").mockRejectedValueOnce(new Error("Write refused"));
    await expect(controller.createEntry()).rejects.toThrow("Write refused");
    expect(controller.state.entryCreationPending).toBe(false);
    await controller.createEntry(); await controller.flushSessions();
    expect(controller.state.entry?.modelId).toBe("articles");
    expect(await provider.store.countEntries("articles")).toBe(2);
  });

  it("does not let a superseded selection clear a newer pending selection", async () => {
    const { provider, controller } = await fixture();
    const oldStarted = deferred<void>(), oldRelease = deferred<void>();
    const newStarted = deferred<void>(), newRelease = deferred<void>();
    const get = provider.store.getModel.bind(provider.store);
    vi.spyOn(provider.store, "getModel").mockImplementation(async (id) => {
      if (id === "other") { oldStarted.resolve(); await oldRelease.promise; }
      if (id === "missing") { newStarted.resolve(); await newRelease.promise; }
      return get(id);
    });
    const old = controller.openModel("other"); await oldStarted.promise;
    const newer = controller.openModel("missing");
    const rejected = expect(newer).rejects.toThrow("not found");
    await newStarted.promise; oldRelease.resolve(); await old;
    expect(controller.state.modelSelectionPending).toBe(true);
    await expect(controller.createEntry()).rejects.toThrow("selection to finish");
    newRelease.resolve(); await rejected;
    expect(controller.state.modelSelectionPending).toBe(false);
  });

});
