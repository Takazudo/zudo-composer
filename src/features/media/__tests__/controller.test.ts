import { describe, expect, it, vi } from "vitest";
import { summarizeMedia } from "../../../media";
import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";
import { createMediaLibraryController, mediaMarkdown } from "../controller";
import { providerFixture, completeServices, PNG, PDF } from "./versioned-fixture";

describe("versioned Media controller", () => {
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
