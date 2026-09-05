import { createSequentialIdFactory } from "../../../shared";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import { describe, expect, it, vi } from "vitest";
import { createContentAuthoringController, CONTENT_ENTRY_PAGE_SIZE } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

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

  it("reports pending published edits only by comparing the activated baseline", async () => {
    const model = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
    const published = { ...createContentEntryRecord("articles", { title: "Activated" }, { id: "published", timestamp: "2026-01-01T00:00:00.000Z" }), lifecycle: "published" as const };
    const provider = createMemoryContentProvider({ models: [model], entries: [published] });
    const controller = createContentAuthoringController(provider, { loadActivatedBaseline: async () => [{ providerId: provider.descriptor.id, mutationToken: 1, models: [model], entries: [published] }] });
    await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("published"); await tick();
    expect(controller.state.publicationState).toBe("published");
    controller.updateEntryValue("title", "Working change");
    expect(controller.state.publicationState).toBe("published-pending");
  });

  it("does not claim whether a published Entry is pending without an activated baseline", async () => {
    const model = createContentModelRecord({ name: "Articles", kind: "collection", fields: [] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
    const published = { ...createContentEntryRecord("articles", {}, { id: "published", timestamp: "2026-01-01T00:00:00.000Z" }), lifecycle: "published" as const };
    const controller = createContentAuthoringController(createMemoryContentProvider({ models: [model], entries: [published] }));
    await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("published");
    expect(controller.state.publicationState).toBe("published-baseline-unavailable");
  });

  it("keeps a model save failure authoritative while a later Entry save succeeds, then retries both queues", async () => {
    const provider = createMemoryContentProvider(); const original = provider.store.putModel; let fail = true;
    vi.spyOn(provider.store, "putModel").mockImplementation(async (record) => { if (fail) { fail = false; throw new Error("model offline"); } await original(record); });
    const controller = createContentAuthoringController(provider); await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("entry-1");
    controller.renameModel("Renamed"); await tick(); expect(controller.state.saveStatus).toBe("error");
    controller.updateEntryValue("title", "Entry saved"); await tick();
    expect(controller.state.saveStatus).toBe("error"); expect(controller.state.message).toContain("model offline");
    controller.retrySave(); await controller.flushSessions(); expect(controller.state.saveStatus).toBe("saved");
  });

  it("ignores stale out-of-order model and Entry reads", async () => {
    const one = createContentModelRecord({ name: "One", kind: "collection", fields: [] }, { id: "one", timestamp: "2026-01-01T00:00:00.000Z" });
    const two = createContentModelRecord({ name: "Two", kind: "collection", fields: [] }, { id: "two", timestamp: "2026-01-01T00:00:00.000Z" });
    const first = createContentEntryRecord("two", {}, { id: "first", timestamp: "2026-01-01T00:00:00.000Z" });
    const second = createContentEntryRecord("two", {}, { id: "second", timestamp: "2026-01-01T00:00:00.000Z" });
    const provider = createMemoryContentProvider({ models: [one, two], entries: [first, second] });
    const controller = createContentAuthoringController(provider); await controller.initialize();
    const getModel = provider.store.getModel; const oneRead = deferred<Awaited<ReturnType<typeof getModel>>>(), twoRead = deferred<Awaited<ReturnType<typeof getModel>>>();
    const modelSpy = vi.spyOn(provider.store, "getModel").mockImplementation((id) => id === "one" ? oneRead.promise : id === "two" ? twoRead.promise : getModel(id));
    const openOne = controller.openModel("one"); await tick(); const openTwo = controller.openModel("two"); await tick();
    twoRead.resolve({ status: "loaded", record: two }); await openTwo; oneRead.resolve({ status: "loaded", record: one }); await openOne;
    expect(controller.state.model?.id).toBe("two");
    const lateModel = deferred<Awaited<ReturnType<typeof getModel>>>(); modelSpy.mockImplementation((id) => id === "one" ? lateModel.promise : getModel(id));
    const openLateModel = controller.openModel("one"); await tick(); await controller.openModel("two"); lateModel.resolve({ status: "loaded", record: one }); await openLateModel;
    expect(controller.state.model?.id).toBe("two");
    vi.restoreAllMocks();
    const getEntry = provider.store.getEntry; const firstRead = deferred<Awaited<ReturnType<typeof getEntry>>>(), secondRead = deferred<Awaited<ReturnType<typeof getEntry>>>();
    const entrySpy = vi.spyOn(provider.store, "getEntry").mockImplementation((id) => id === "first" ? firstRead.promise : id === "second" ? secondRead.promise : getEntry(id));
    const openFirst = controller.openEntry("first"); await tick(); const openSecond = controller.openEntry("second"); await tick();
    secondRead.resolve({ status: "loaded", record: second }); await openSecond; firstRead.resolve({ status: "loaded", record: first }); await openFirst;
    expect(controller.state.entry?.id).toBe("second");
    const lateEntry = deferred<Awaited<ReturnType<typeof getEntry>>>(); entrySpy.mockImplementation((id) => id === "first" ? lateEntry.promise : getEntry(id));
    const openLateEntry = controller.openEntry("first"); await tick(); await controller.openEntry("second"); lateEntry.resolve({ status: "loaded", record: first }); await openLateEntry;
    expect(controller.state.entry?.id).toBe("second");
  });

  it("fails closed before deleting an Entry referenced by another provider", async () => {
    const people = createContentModelRecord({ name: "People", kind: "collection", fields: [] }, { id: "people", timestamp: "2026-01-01T00:00:00.000Z" });
    const person = createContentEntryRecord("people", {}, { id: "person", timestamp: "2026-01-01T00:00:00.000Z" });
    const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "author", key: "author", label: "Author", required: false, kind: "reference", target: { providerId: "content-indexeddb", recordId: "people" } }] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
    const article = createContentEntryRecord("articles", { author: { providerId: "content-indexeddb", modelId: "people", recordId: "person" } }, { id: "article", timestamp: "2026-01-01T00:00:00.000Z" });
    const primary = createMemoryContentProvider({ models: [people], entries: [person] });
    const secondary = createMemoryContentProvider({ models: [articles], entries: [article], providerId: "editorial", providerLabel: "Editorial" });
    const controller = createContentAuthoringController(primary, { providers: [primary, secondary] }); await controller.initialize(); await controller.openModel("people"); await controller.openEntry("person");
    await expect(controller.deleteEntry("person")).rejects.toThrow(/editorial\/article references this entry.*not attempted/);
    expect((await primary.store.getEntry("person")).status).toBe("loaded");
    vi.spyOn(secondary.store, "readAll").mockRejectedValueOnce(new Error("offline"));
    await expect(controller.deleteEntry("person")).rejects.toThrow(/provider could not be read.*not attempted/i);
  });

  it("blocks cross-provider model targets, inverse-owning fields, and every destructive action on a dangling graph", async () => {
    const people = createContentModelRecord({ name: "People", kind: "collection", fields: [], presentation: { groups: [], views: [], inverses: [{ id: "articles", label: "Articles", source: { providerId: "editorial", recordId: "articles" }, fieldId: "author" }] } }, { id: "people", timestamp: "2026-01-01T00:00:00.000Z" });
    const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "author", key: "author", label: "Author", required: false, kind: "reference", target: { providerId: "content-indexeddb", recordId: "people" } }] }, { id: "articles", timestamp: "2026-01-01T00:00:00.000Z" });
    const primary = createMemoryContentProvider({ models: [people], entries: [] });
    const secondary = createMemoryContentProvider({ models: [articles], entries: [], providerId: "editorial", providerLabel: "Editorial" });
    const primaryController = createContentAuthoringController(primary, { providers: [primary, secondary] }); await primaryController.initialize(); await primaryController.openModel("people");
    await expect(primaryController.deleteModel("people")).rejects.toThrow(/targets this model.*not attempted/i);
    const secondaryController = createContentAuthoringController(secondary, { providers: [primary, secondary] }); await secondaryController.initialize(); await secondaryController.openModel("articles");
    await expect(secondaryController.removeField("author")).rejects.toThrow(/Inverse articles.*depends on this field.*not attempted/i);

    const dangling = createContentEntryRecord("articles", { author: { providerId: "content-indexeddb", modelId: "people", recordId: "missing" } }, { id: "dangling", timestamp: "2026-01-01T00:00:00.000Z" });
    await secondary.store.putEntry(dangling); await secondaryController.reloadEntries(); await secondaryController.openEntry("dangling");
    await expect(secondaryController.deleteEntry("dangling")).rejects.toThrow(/unresolved providers or records.*not attempted/i);
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
