import { describe, expect, it, vi } from "vitest";
import { createContentEntryRecord, createContentModelRecord, type ContentInitializationOutcome, type ContentSnapshot } from "../../../content";
import { createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const model = (id: string, date = "2026-01-01T00:00:00.000Z") => createContentModelRecord({ name: id, description: `${id} description`, kind: "collection", fields: [{ id: "title", key: "title", label: "Title", kind: "text", required: true }] }, { id, timestamp: date });
const entry = (id: string, modelId: string, values: Record<string, string> = { title: id }) => createContentEntryRecord(modelId, values, { id, timestamp: "2026-01-01T00:00:00.000Z" });

describe("coherent Content library initialization", () => {
  it("uses one snapshot for 25 models and both draft and published entry counts without writes", async () => {
    const models = Array.from({ length: 25 }, (_, i) => model(`model-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`));
    const draft = entry("draft", "model-0"), published = { ...entry("published", "model-0"), lifecycle: "published" as const };
    const provider = createMemoryContentProvider({ models, entries: [draft, published, entry("incomplete", "model-1", {})] });
    const original = await provider.store.readAll();
    const reads = vi.spyOn(provider.store, "readAll"), counts = vi.spyOn(provider.store, "countEntries"), descriptions = vi.spyOn(provider.store, "getModel"), scans = vi.spyOn(provider.store, "scanEntries");
    const writes = ["putEntry", "putModel", "transact", "seed", "clear", "reconcilePublication"] as const;
    const writeSpies = writes.map(key => vi.spyOn(provider.store, key));
    const controller = createContentAuthoringController(provider); await controller.initialize();
    expect(reads).toHaveBeenCalledOnce(); expect(counts).not.toHaveBeenCalled(); expect(descriptions).not.toHaveBeenCalled(); expect(scans).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe("ready");
    expect(controller.state.models.map(item => item.id)).toEqual([...models].reverse().map(item => item.id));
    expect(controller.state.modelDescriptions["model-0"]).toBe("model-0 description");
    expect(controller.state.entryCounts).toMatchObject({ "model-0": 2, "model-1": 1, "model-24": 0 });
    expect(controller.state.incompleteCounts).toMatchObject({ "model-0": 0, "model-1": 1, "model-24": 0 });
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
    expect(await provider.store.readAll()).toEqual(original);
  });
  it("takes models, descriptions and counts from the snapshot rather than older initialization summaries", async () => {
    const provider = createMemoryContentProvider({ models: [model("old")], entries: [] });
    const gate = deferred<ContentInitializationOutcome>();
    vi.spyOn(provider.initialization, "initialize").mockReturnValue(gate.promise);
    const controller = createContentAuthoringController(provider), initializing = controller.initialize();
    await provider.store.putModel(model("new")); await provider.store.putEntry(entry("new-entry", "new"));
    gate.resolve({ status: "ready", models: [] }); await initializing;
    expect(controller.state.models.map(item => item.id).sort()).toEqual(["new", "old"]);
    expect(controller.state.entryCounts).toEqual({ new: 1, old: 0 });
    expect(controller.state.modelDescriptions.new).toBe("new description");
  });
  it("keeps semantic-invalid completeness unknown without losing other model counts", async () => {
    const provider = createMemoryContentProvider({ models: [model("invalid"), model("valid")], entries: [entry("bad", "invalid", { unknownField: "invalid" }), entry("missing", "valid", {})] });
    const controller = createContentAuthoringController(provider); await controller.initialize();
    expect(controller.state.phase).toBe("ready");
    expect(controller.state.entryCounts).toEqual({ invalid: 1, valid: 1 });
    expect(controller.state.incompleteCounts).toEqual({ valid: 1 });
  });
  it("refuses a foreign snapshot without falling back to piecemeal reads", async () => {
    const provider = createMemoryContentProvider(), snapshot = await provider.store.readAll();
    vi.spyOn(provider.store, "readAll").mockResolvedValue({ ...snapshot, providerId: "foreign" });
    const counts = vi.spyOn(provider.store, "countEntries"), controller = createContentAuthoringController(provider);
    await controller.initialize();
    expect(controller.state.phase).toBe("error"); expect(controller.state.message).toContain("another provider"); expect(counts).not.toHaveBeenCalled();
  });
  it("does not read or reseed when initialization requires recovery", async () => {
    const provider = createMemoryContentProvider({ initialization: { status: "recovery-required", models: [], recovery: { kind: "quarantined", reason: "invalid", sourcePreserved: true, affectedRecordIds: ["broken"], message: "Preserved" } } });
    const reads = vi.spyOn(provider.store, "readAll"), fresh = vi.spyOn(provider.initialization, "startFresh");
    const controller = createContentAuthoringController(provider); await controller.initialize();
    expect(controller.state.phase).toBe("recovery"); expect(reads).not.toHaveBeenCalled(); expect(fresh).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"])("ignores late initialization %s after a retry", async result => {
    const provider = createMemoryContentProvider(), gate = deferred<ContentInitializationOutcome>();
    vi.spyOn(provider.initialization, "initialize").mockReturnValueOnce(gate.promise);
    const read = vi.spyOn(provider.store, "readAll"), controller = createContentAuthoringController(provider);
    const first = controller.initialize(); await controller.retryInitialization();
    const current = controller.state;
    if (result === "success") gate.resolve({ status: "ready", models: [] }); else gate.reject(new Error("old error"));
    await first;
    expect(controller.state).toBe(current); expect(read).toHaveBeenCalledOnce();
  });
  it.each(["success", "failure"])("ignores late snapshot %s after a retry", async result => {
    const provider = createMemoryContentProvider(), gate = deferred<ContentSnapshot>();
    const started = deferred<void>();
    vi.spyOn(provider.store, "readAll").mockImplementationOnce(() => { started.resolve(); return gate.promise; });
    const controller = createContentAuthoringController(provider), first = controller.initialize();
    await started.promise; await controller.retryInitialization();
    const current = controller.state;
    if (result === "success") gate.resolve({ providerId: provider.descriptor.id, mutationToken: 0, models: [], entries: [] }); else gate.reject(new Error("old error"));
    await first; expect(controller.state).toBe(current);
  });
  it.each(["success", "failure"])("does not overwrite a newer model selection with late snapshot %s", async result => {
    const provider = createMemoryContentProvider(), gate = deferred<ContentSnapshot>(), started = deferred<void>();
    vi.spyOn(provider.store, "readAll").mockImplementationOnce(() => { started.resolve(); return gate.promise; });
    const controller = createContentAuthoringController(provider), first = controller.initialize();
    await started.promise; await controller.openModel("articles");
    const current = controller.state;
    if (result === "success") gate.resolve({ providerId: provider.descriptor.id, mutationToken: 0, models: [], entries: [] }); else gate.reject(new Error("old error"));
    await first; expect(controller.state).toBe(current); expect(current.model?.id).toBe("articles");
  });
});
