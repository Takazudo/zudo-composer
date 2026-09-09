import { describe, expect, it, vi } from "vitest";
import { summarizeAsset } from "../../../assets";
import { createWorkspaceSaveRegistry } from "../../../app/workspace-sessions";
import { createAssetLibraryController, assetMarkdown } from "../controller";
import { providerFixture, completeServices, PNG, PDF } from "./versioned-fixture";

describe("versioned Asset controller", () => {
  it("blocks trash for injected Composition impacts even without structured Content uses", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const contentServices = completeServices({ scan: async () => ({ status: "complete", locations: [], tokens: {}, message: "Composition uses remain", additionalLocations: [{ location: { domain: "compositions", providerId: "files", recordId: "page", nodeId: "image", property: "src", valuePath: ["src"] } }] }) });
    const controller = createAssetLibraryController(provider, { contentServices }); await controller.initialize();
    await expect(controller.trash(controller.state.records)).rejects.toThrow("project uses");
    expect((await filesystem.list())[0]!.state).toBe("active");
  });
  it("never exposes a retryable upload failure after the write committed", async () => {
    const { provider, filesystem } = await providerFixture();
    const controller = createAssetLibraryController(provider); await controller.initialize();
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
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    controller.draftMetadata(summarizeAsset(record), { note: "First" });
    const flushed = controller.flush(); await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    controller.draftMetadata(summarizeAsset(record), { note: "Newer" }); release(); await flushed;
    expect(update).toHaveBeenCalledTimes(2); expect(controller.hasDraft(record.id)).toBe(false);
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Newer" } } });
  });
  it.each([false, true])("handles a newer draft with a different base revision (external commit: %s)", async (external) => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => {
      const saved = await original(...args);
      const newer = external ? await original(record.id, { fileName: "other-tab.png" }, { expectedRevision: saved.revision }) : saved;
      // Directly exercise the mismatch branch: this draft's base is newer than
      // the in-flight draft's base before persistDraft receives its result.
      controller.draftMetadata(summarizeAsset(newer), { note: "Concurrent edit" });
      return saved;
    });
    controller.draftMetadata(summarizeAsset(record), { fileName: "saved.png", note: "First" });
    await controller.saveDraft(record.id);
    expect(controller.hasDraft(record.id)).toBe(true);
    await controller.flush();
    expect(update.mock.calls[1]![2]).toEqual({ expectedRevision: external ? 3 : 2 });
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { fileName: external ? "other-tab.png" : "saved.png", note: "Concurrent edit" } } });
    expect(controller.hasDraft(record.id)).toBe(false);
  });

  it("preserves unrelated pending fields and their conflict base when newer records arrive", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    controller.draftMetadata(summarizeAsset(record), { note: "Unsaved note" });
    const newer = await filesystem.updateMetadata(record.id, { note: "External note" }, { expectedRevision: record.revision });
    controller.draftMetadata(summarizeAsset(newer), { fileName: "Local name.png" });
    const update = vi.spyOn(filesystem, "updateMetadata");
    await expect(controller.flush()).rejects.toMatchObject({ code: "conflict" });
    expect(update).toHaveBeenCalledWith(record.id, { note: "Unsaved note", fileName: "Local name.png" }, { expectedRevision: 1 });
    expect(controller.hasDraft(record.id)).toBe(true);
  });

  it("retains pending fields if a newer input arrives before the active save conflicts", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => {
      const external = await original(record.id, { note: "External note" }, { expectedRevision: 1 });
      controller.draftMetadata(summarizeAsset(external), { fileName: "Local name.png" });
      return original(...args);
    });
    controller.draftMetadata(summarizeAsset(record), { note: "Unsaved note" });
    await expect(controller.saveDraft(record.id)).rejects.toMatchObject({ code: "conflict" });
    await controller.reload();
    await expect(controller.flush()).rejects.toMatchObject({ code: "conflict" });
    expect(update.mock.calls[1]).toEqual([record.id, { note: "Unsaved note", fileName: "Local name.png" }, { expectedRevision: 1 }]);
    expect(controller.hasDraft(record.id)).toBe(true);
  });

  it("preserves unrelated concurrent fields when an incoming patch uses the saved base", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => {
      const saved = await original(...args);
      controller.draftMetadata(summarizeAsset(record), { note: "Concurrent note" });
      controller.draftMetadata(summarizeAsset(saved), { fileName: "Concurrent name.png" });
      return saved;
    });
    controller.draftMetadata(summarizeAsset(record), { note: "First" });
    await controller.saveDraft(record.id); await controller.flush();
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Concurrent note", fileName: "Concurrent name.png" } } });
  });

  it("does not regress a rebased concurrent draft when an inspector supplies its old base", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => {
      controller.draftMetadata(summarizeAsset(record), { note: "While saving" });
      return original(...args);
    });
    controller.draftMetadata(summarizeAsset(record), { note: "First" });
    await controller.saveDraft(record.id);
    controller.draftMetadata(summarizeAsset(record), { note: "Latest keystroke" });
    await controller.flush();
    expect(update.mock.calls[1]![2]).toEqual({ expectedRevision: 2 });
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Latest keystroke" } } });
  });

  it("refuses external changes after a successful save without losing the unsaved draft", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    controller.draftMetadata(summarizeAsset(record), { note: "Saved" }); await controller.saveDraft(record.id);
    const base = controller.state.records[0]!;
    controller.draftMetadata(base, { note: "Local unsaved" });
    await filesystem.updateMetadata(record.id, { note: "Other tab" }, { expectedRevision: base.revision });
    await expect(controller.flush()).rejects.toMatchObject({ code: "conflict" });
    expect(controller.hasDraft(record.id)).toBe(true);
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "Other tab" } } });
  });

  it("deduplicates an explicit draft save racing the workspace save barrier", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const original = filesystem.updateMetadata.bind(filesystem);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const update = vi.spyOn(filesystem, "updateMetadata").mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    controller.draftMetadata(summarizeAsset(record), { note: "One committed draft" });
    const saving = controller.saveDraft(record.id);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const flushing = controller.flush();
    release();
    await Promise.all([saving, flushing]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(controller.hasDraft(record.id)).toBe(false);
    expect(await filesystem.get(record.id)).toMatchObject({ record: { document: { note: "One committed draft" } } });
  });
  it("recovers uncertain outcomes only after deliberate authoritative inspection", async () => {
    const { provider, filesystem } = await providerFixture();
    const controller = createAssetLibraryController(provider); await controller.initialize();
    vi.spyOn(filesystem, "upload").mockRejectedValueOnce(Object.assign(new Error("Inspect storage"), { code: "commit-uncertain" }));
    await expect(controller.upload(new File([PNG], "uncertain.png", { type: "image/png" }), null)).rejects.toMatchObject({ code: "commit-uncertain" });
    expect(controller.state.uncertain).toBe(true);
    await controller.refresh(); expect(controller.state.uncertain).toBe(true);
    await controller.reload(); expect(controller.state.uncertain).toBe(false);
  });
  it("fails closed for every mutation capability while loading or unreadable", async () => {
    const { provider, filesystem } = await providerFixture(); const controller = createAssetLibraryController(provider);
    expect(controller.capability("trash")).toBe(false); await controller.initialize();
    const snapshot = vi.spyOn(filesystem, "snapshot").mockRejectedValue(new Error("Offline"));
    const refresh = controller.refresh(); expect(controller.capability("replace")).toBe(false);
    await expect(refresh).rejects.toThrow("Offline");
    for (const capability of ["metadata", "trash", "restore", "folders", "replace"] as const) expect(controller.capability(capability)).toBe(false);
    expect(() => controller.restore([])).toThrow("unavailable"); snapshot.mockRestore();
  });
  it("persists metadata drafts through detached workspace-session flush", async () => {
    const { provider, filesystem } = await providerFixture();
    const record = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const registry = createWorkspaceSaveRegistry();
    const session = registry.register({ feature: "Asset", providerId: provider.descriptor.id }, { flush: () => controller.flush() });
    controller.draftMetadata(summarizeAsset(record), { fileName: "renamed.png", note: "Internal note" }); session.changed();
    controller.dispose(); session.detach();
    expect((await registry.flush()).status).toBe("ready");
    expect(await filesystem.get(record.id)).toMatchObject({ status: "loaded", record: { document: { fileName: "renamed.png", note: "Internal note" } } });
  });
  it("preserves identity and old versions through move, replace, guarded trash and restore", async () => {
    const { provider, filesystem } = await providerFixture(); const contentServices = completeServices();
    const original = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider, { contentServices }); await controller.initialize();
    const folder = await controller.createFolder("Assets", null, 0, controller.state.snapshot!.mutationToken);
    await controller.move(controller.state.records, folder.id);
    await controller.replace(controller.state.records[0]!, new File([PDF], "new.pdf", { type: "application/pdf" }));
    expect(controller.state.records[0]!.id).toBe(original.id);
    expect(controller.state.snapshot!.records[0]!.document.versions).toHaveLength(2);
    await controller.trash(controller.state.records); expect(controller.state.records[0]!.state).toBe("trash");
    await controller.restore(controller.state.records); expect(controller.state.records[0]!.state).toBe("active");
    expect(assetMarkdown(controller.state.records[0]!)).toContain(`/uploaded-assets/asset-${original.id}`);
    expect(await filesystem.resolveVersion({ providerId: provider.descriptor.id, assetId: original.id, versionId: original.document.currentVersionId })).toBeDefined();
  });
  it.each(["unavailable", "incomplete", "used", "changed"])("blocks trash when safety is %s", async (condition) => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const services = completeServices({ scan: async () => ({ status: condition === "incomplete" ? "incomplete" : condition === "unavailable" ? "unavailable" : "complete", locations: condition === "used" ? [{} as never] : [], tokens: {}, message: "Guard" }), isCurrent: async () => condition !== "changed" });
    const controller = createAssetLibraryController(provider, { contentServices: services }); await controller.initialize();
    await expect(controller.trash(controller.state.records)).rejects.toThrow();
    expect((await filesystem.list())[0]!.state).toBe("active");
  });
  it("rejects stale metadata and reports the actual state after a partial bulk failure", async () => {
    const { provider, filesystem } = await providerFixture();
    const one = await filesystem.upload({ fileName: "one.png", declaredMimeType: "image/png", bytes: PNG });
    const two = await filesystem.upload({ fileName: "two.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const folder = await filesystem.createFolder({ name: "Destination", parentId: null }, await filesystem.mutationToken());
    await filesystem.updateMetadata(two.id, { note: "Other tab" }, { expectedRevision: 1 });
    await expect(controller.move([summarizeAsset(one), summarizeAsset(two)], folder.id)).rejects.toMatchObject({ code: "conflict" });
    expect(controller.state.records.find(({ id }) => id === one.id)!.folderId).toBe(folder.id);
    expect(controller.state.records.find(({ id }) => id === two.id)!.folderId).toBe(null);
    expect(controller.state.notice?.tone).toBe("err");
  });
  it("does not enable writes based on a method name without capabilities", async () => {
    const { provider } = await providerFixture();
    const readonly = { ...provider, store: { provider: provider.descriptor, list: provider.store.list, get: provider.store.get, put: provider.store.put, delete: provider.store.delete, clear: provider.store.clear, upload: vi.fn() } };
    const controller = createAssetLibraryController(readonly);
    expect(controller.capability("replace")).toBe(false);
    expect(() => controller.upload(new File([PNG], "x.png"), null)).toThrow("unavailable");
  });

  it("saves an edited replacement with the captured MIME, identity and revision precondition", async () => {
    const { provider, filesystem } = await providerFixture();
    const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    const original = await filesystem.upload({ fileName: "hero.jpeg", declaredMimeType: "image/jpeg", bytes: JPEG });
    const replacementCalls: { id: string; file: Blob; expectedRevision: number }[] = [];
    const store = new Proxy(provider.store, { get(target, property, receiver) {
      if (property === "replace") return (id: string, file: Blob, precondition: { expectedRevision: number }) => { replacementCalls.push({ id, file, expectedRevision: precondition.expectedRevision }); return target.replace(id, file, precondition); };
      return Reflect.get(target, property, receiver);
    } });
    const controller = createAssetLibraryController({ ...provider, store: store as typeof provider.store }); await controller.initialize();
    const captured = controller.state.records[0]!;
    const saved = await controller.saveEditedImage(captured, new Blob([JPEG], { type: "image/jpeg" }), { mode: "replace" });
    expect(saved.id).toBe(original.id);
    expect(replacementCalls[0]).toMatchObject({ id: original.id, file: { name: "hero.jpg", type: "image/jpeg" }, expectedRevision: captured.revision });
    expect(controller.state.records[0]).toMatchObject({ id: original.id, revision: captured.revision + 1, mimeType: "image/jpeg" });
  });

  it("saves a copy in the captured folder with one normalized edited extension", async () => {
    const { provider, filesystem } = await providerFixture();
    const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    const original = await filesystem.upload({ fileName: "hero.jpeg", declaredMimeType: "image/jpeg", bytes: JPEG, note: "Keep this note" });
    const folder = await filesystem.createFolder({ name: "Pictures", parentId: null }, await filesystem.mutationToken());
    await filesystem.updateMetadata(original.id, { folderId: folder.id }, { expectedRevision: original.revision });
    const uploadCalls: { file: Blob & { name: string }; folderId?: string | null; note?: string }[] = [];
    const store = new Proxy(provider.store, { get(target, property, receiver) {
      if (property === "upload") return (file: Blob & { name: string }, options: { folderId?: string | null; note?: string }) => { uploadCalls.push({ file, folderId: options.folderId, note: options.note }); return target.upload(file, options); };
      return Reflect.get(target, property, receiver);
    } });
    const controller = createAssetLibraryController({ ...provider, store: store as typeof provider.store }); await controller.initialize();
    const captured = controller.state.records[0]!;
    const saved = await controller.saveEditedImage(captured, new Blob([JPEG], { type: "image/jpeg" }), { mode: "copy" });
    expect(saved.id).not.toBe(captured.id);
    expect(uploadCalls[0]).toMatchObject({ file: { name: "hero (edited).jpg", type: "image/jpeg" }, folderId: folder.id, note: "Keep this note" });
    expect(controller.state.records.find(({ id }) => id === saved.id)).toMatchObject({ fileName: "hero (edited).jpg", folderId: folder.id, note: "Keep this note" });
  });

  it("does not advertise or attempt Save as copy when upload is absent", async () => {
    const { provider, filesystem } = await providerFixture();
    await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const store = new Proxy(provider.store, { get(target, property, receiver) {
      if (property === "upload") return undefined;
      return Reflect.get(target, property, receiver);
    } }) as typeof provider.store;
    const controller = createAssetLibraryController({ ...provider, store }); await controller.initialize();
    const captured = controller.state.records[0]!;
    expect(controller.canSaveEditedImageCopy()).toBe(false);
    await expect(controller.saveEditedImage(captured, new Blob([PNG], { type: "image/png" }), { mode: "copy" })).rejects.toThrow("unavailable");
  });

  it("retains the captured editor revision on conflict and blocks uncertain retry", async () => {
    const { provider, filesystem } = await providerFixture();
    const original = await filesystem.upload({ fileName: "hero.png", declaredMimeType: "image/png", bytes: PNG });
    const controller = createAssetLibraryController(provider); await controller.initialize();
    const captured = controller.state.records[0]!;
    await filesystem.updateMetadata(original.id, { note: "Other tab" }, { expectedRevision: captured.revision });
    const replace = vi.spyOn(provider.store, "replace");
    await expect(controller.saveEditedImage(captured, new Blob([PNG], { type: "image/png" }), { mode: "replace" })).rejects.toMatchObject({ code: "conflict" });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(controller.state.uncertain).toBe(false);
    const uncertain = vi.spyOn(provider.store, "replace").mockRejectedValueOnce(Object.assign(new Error("Unknown acknowledgement"), { code: "commit-uncertain" }));
    const current = controller.state.records[0]!;
    await expect(controller.saveEditedImage(current, new Blob([PNG], { type: "image/png" }), { mode: "replace" })).rejects.toMatchObject({ code: "commit-uncertain" });
    await expect(controller.saveEditedImage(current, new Blob([PNG], { type: "image/png" }), { mode: "replace" })).rejects.toThrow("Reload authoritative");
    expect(uncertain).toHaveBeenCalledTimes(2);
  });
});
