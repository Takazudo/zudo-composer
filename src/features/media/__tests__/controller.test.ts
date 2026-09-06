import { describe, expect, it, vi } from "vitest";
import { summarizeMedia } from "../../../media";
import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";
import { createMediaLibraryController, mediaMarkdown } from "../controller";
import { providerFixture, completeServices, PNG, PDF } from "./versioned-fixture";

describe("versioned Media controller", () => {
  it("blocks trash for injected Composition impacts even without structured Content uses", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    const contentServices = completeServices({ scan: async () => ({ status: "complete", locations: [], tokens: {}, message: "Composition uses remain", additionalLocations: [{ location: { domain: "compositions", providerId: "indexeddb", recordId: "page", nodeId: "image", property: "src", valuePath: ["src"] } }] }) });
    const controller = createMediaLibraryController(provider, { contentServices }); await controller.initialize();
    await expect(controller.trash(controller.state.records)).rejects.toThrow("project uses");
    expect((await filesystem.list())[0]!.state).toBe("active");
  });
  it("never exposes a retryable upload failure after the write committed", async () => {
    const { provider, filesystem } = await providerFixture();
    const controller = createMediaLibraryController(provider); await controller.initialize();
    const snapshot = vi.spyOn(filesystem, "snapshot").mockRejectedValue(new Error("Read failed"));
    await expect(controller.upload(new File([PNG], "committed.png", { type: "image/png" }), null)).rejects.toMatchObject({ code: "committed-stale" });
    expect(controller.state.uncertain).toBe(true); expect(controller.capability("replace")).toBe(false);
    await expect(controller.reload()).rejects.toThrow("Read failed"); expect(controller.state.uncertain).toBe(true);
    snapshot.mockRestore(); await controller.reload();
    expect(controller.state.records).toHaveLength(1); expect(controller.state.uncertain).toBe(false);
    expect(controller.capability("replace")).toBe(true); await expect(controller.flush()).resolves.toBeUndefined();
  });
  it("drains newer same-ID drafts before resolving the save barrier", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    const controller = createMediaLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    controller.draftMetadata(summarizeMedia(record), { note: "First" });
    const flushed = controller.flush(); await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    controller.draftMetadata(summarizeMedia(record), { note: "Newer" }); release(); await flushed;
    expect(update).toHaveBeenCalledTimes(2); expect(controller.hasDraft(record.id)).toBe(false);
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Newer" } } });
  });
  it("recovers uncertain outcomes only after deliberate authoritative inspection", async () => {
    const { provider, filesystem } = await providerFixture();
    const controller = createMediaLibraryController(provider); await controller.initialize();
    vi.spyOn(filesystem, "upload").mockRejectedValueOnce(Object.assign(new Error("Inspect storage"), { code: "commit-uncertain" }));
    await expect(controller.upload(new File([PNG], "uncertain.png", { type: "image/png" }), null)).rejects.toMatchObject({ code: "commit-uncertain" });
    expect(controller.state.uncertain).toBe(true);
    await controller.refresh(); expect(controller.state.uncertain).toBe(true);
    await controller.reload(); expect(controller.state.uncertain).toBe(false);
  });
  it("fails closed for every mutation capability while loading or unreadable", async () => {
    const { provider, filesystem } = await providerFixture(); const controller = createMediaLibraryController(provider);
    expect(controller.capability("trash")).toBe(false); await controller.initialize();
    const snapshot = vi.spyOn(filesystem, "snapshot").mockRejectedValue(new Error("Offline"));
    const refresh = controller.refresh(); expect(controller.capability("replace")).toBe(false);
    await expect(refresh).rejects.toThrow("Offline");
    for (const capability of ["metadata", "trash", "restore", "folders", "replace"] as const) expect(controller.capability(capability)).toBe(false);
    expect(() => controller.restore([])).toThrow("unavailable"); snapshot.mockRestore();
  });
  it("persists metadata drafts through detached workspace-session flush", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    const controller = createMediaLibraryController(provider); await controller.initialize();
    const registry = createWorkspaceSaveRegistry();
    const session = registry.register({ feature: "Media", providerId: provider.descriptor.id }, { flush: () => controller.flush() });
    controller.draftMetadata(summarizeMedia(record), { fileName: "renamed.png", note: "Internal note" }); session.changed();
    controller.dispose(); session.detach();
    expect((await registry.flush()).status).toBe("ready");
    expect(await filesystem.get(record.id)).toMatchObject({ status: "loaded", record: { document: { fileName: "renamed.png", note: "Internal note" } } });
  });
  it("preserves identity and old versions through move, replace, guarded trash and restore", async () => {
    const { provider, filesystem } = await providerFixture(); const contentServices = completeServices();
    const original = await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    const controller = createMediaLibraryController(provider, { contentServices }); await controller.initialize();
    const folder = await controller.createFolder("Assets", null, 0, controller.state.snapshot!.mutationToken);
    await controller.move(controller.state.records, folder.id);
    await controller.replace(controller.state.records[0]!, new File([PDF], "new.pdf", { type: "application/pdf" }));
    expect(controller.state.records[0]!.id).toBe(original.id);
    expect(controller.state.snapshot!.records[0]!.document.versions).toHaveLength(2);
    await controller.trash(controller.state.records); expect(controller.state.records[0]!.state).toBe("trash");
    await controller.restore(controller.state.records); expect(controller.state.records[0]!.state).toBe("active");
    expect(mediaMarkdown(controller.state.records[0]!)).toContain(`/uploaded-media/asset-${original.id}`);
    expect(await filesystem.resolveVersion({ providerId: provider.descriptor.id, assetId: original.id, versionId: original.document.currentVersionId })).toBeDefined();
  });
  it.each(["unavailable", "incomplete", "used", "changed"])("blocks trash when safety is %s", async (condition) => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMediaType: "image/png", bytes: PNG });
    const services = completeServices({ scan: async () => ({ status: condition === "incomplete" ? "incomplete" : condition === "unavailable" ? "unavailable" : "complete", locations: condition === "used" ? [{} as never] : [], tokens: {}, message: "Guard" }), isCurrent: async () => condition !== "changed" });
    const controller = createMediaLibraryController(provider, { contentServices: services }); await controller.initialize();
    await expect(controller.trash(controller.state.records)).rejects.toThrow();
    expect((await filesystem.list())[0]!.state).toBe("active");
  });
  it("rejects stale metadata and reports the actual state after a partial bulk failure", async () => {
    const { provider, filesystem } = await providerFixture();
    const one = await filesystem.upload({ fileName: "one.png", declaredMediaType: "image/png", bytes: PNG });
    const two = await filesystem.upload({ fileName: "two.png", declaredMediaType: "image/png", bytes: PNG });
    const controller = createMediaLibraryController(provider); await controller.initialize();
    const folder = await filesystem.createFolder({ name: "Destination", parentId: null }, await filesystem.mutationToken());
    await filesystem.updateMetadata(two.id, { note: "Other tab" }, { expectedRevision: 1 });
    await expect(controller.move([summarizeMedia(one), summarizeMedia(two)], folder.id)).rejects.toMatchObject({ code: "conflict" });
    expect(controller.state.records.find(({ id }) => id === one.id)!.folderId).toBe(folder.id);
    expect(controller.state.records.find(({ id }) => id === two.id)!.folderId).toBe(null);
    expect(controller.state.notice?.tone).toBe("err");
  });
  it("does not enable writes based on a method name without capabilities", async () => {
    const { provider } = await providerFixture();
    const readonly = { ...provider, store: { provider: provider.descriptor, list: provider.store.list, get: provider.store.get, put: provider.store.put, delete: provider.store.delete, clear: provider.store.clear, upload: vi.fn() } };
    const controller = createMediaLibraryController(readonly);
    expect(controller.capability("replace")).toBe(false);
    expect(() => controller.upload(new File([PNG], "x.png"), null)).toThrow("unavailable");
  });
});
