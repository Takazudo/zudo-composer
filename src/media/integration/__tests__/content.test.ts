import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createContentModelRecord, createContentEntryRecord, createIndexedDbContentProvider } from "../../../content";
import { createMediaContentServices, type MediaUse } from "../content";

async function content() {
  const model = createContentModelRecord({ name: "Resources", kind: "collection", fields: [
    { id: "hero", key: "hero", label: "Hero", kind: "media-use", use: "image", required: false },
    { id: "links", key: "links", label: "Links", kind: "list", item: { kind: "media-use", use: "link" }, required: false },
    { id: "nested", key: "nested", label: "Nested", kind: "object", required: false, fields: [{ id: "card", key: "card", label: "Card", required: false, kind: "media-use", use: "card" }] },
  ] }, { id: "resources" });
  const entries = Array.from({ length: 40 }, (_, index) => createContentEntryRecord(model.id, { nested: {} }, { id: `entry-${index}` }));
  const provider = createIndexedDbContentProvider({ idbFactory: new IDBFactory(), keyRangeFactory: IDBKeyRange, seed: { models: [model], entries } });
  await provider.initialization.initialize();
  return provider;
}
describe("injected complete Media / Content integration", () => {
  it("coalesces inspector and dialog scans for an asset/event while execution can force a fresh check", async () => {
    const provider = await content(); const read = vi.spyOn(provider.store, "readAll");
    let emit!: () => void; const flush = vi.fn(async () => undefined);
    const service = createMediaContentServices([provider], flush, (listener) => { emit = listener; return () => undefined; });
    const stopInspector = service.subscribeChanges(() => undefined), stopDialog = service.subscribeChanges(() => undefined);
    const asset = { providerId: "media-files", assetId: "hero" };
    try {
      const inspector = service.scan(asset), dialog = service.scan(asset);
      expect(inspector).toBe(dialog); await inspector;
      // One graph capture reads a snapshot and verifies its token with a second read.
      expect(service.scan(asset)).toBe(inspector); expect(read).toHaveBeenCalledTimes(2); expect(flush).toHaveBeenCalledTimes(1);
      emit(); const next = service.scan(asset); expect(service.scan(asset)).toBe(next); await next;
      expect(read).toHaveBeenCalledTimes(4); expect(flush).toHaveBeenCalledTimes(2); await service.scan(asset, true);
      expect(read).toHaveBeenCalledTimes(6); expect(flush).toHaveBeenCalledTimes(3);
    } finally { stopInspector(); stopDialog(); }
  });
  it("shares one lazy event subscription without reading Content and releases it at zero consumers", async () => {
    const provider = await content(); const read = vi.spyOn(provider.store, "readAll");
    let emit!: () => void; const detach = vi.fn();
    const subscribe = vi.fn((listener: () => void) => { emit = listener; return detach; });
    const service = createMediaContentServices([provider], async () => undefined, subscribe);
    expect(subscribe).not.toHaveBeenCalled();
    const inspector = vi.fn(), dialog = vi.fn();
    const stopInspector = service.subscribeChanges(inspector), stopDialog = service.subscribeChanges(dialog);
    expect(subscribe).toHaveBeenCalledTimes(1); emit();
    expect(inspector).toHaveBeenCalledTimes(1); expect(dialog).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    stopInspector(); expect(detach).not.toHaveBeenCalled(); emit();
    expect(inspector).toHaveBeenCalledTimes(1); expect(dialog).toHaveBeenCalledTimes(2);
    stopDialog(); stopDialog(); expect(detach).toHaveBeenCalledTimes(1);
    const stopAgain = service.subscribeChanges(inspector); expect(subscribe).toHaveBeenCalledTimes(2);
    stopAgain(); expect(detach).toHaveBeenCalledTimes(2); expect(read).not.toHaveBeenCalled();
  });
  it("persists image/link/card text through Content CAS without storing Media notes", async () => {
    const provider = await content(); const service = createMediaContentServices([provider], async () => ({ status: "ready" }));
    const asset = { providerId: "media-files", assetId: "hero" };
    const values: MediaUse[] = [{ kind: "image", asset, alt: "Contextual image", decorative: false, caption: "A caption" }, { kind: "link", asset, label: "Download guide" }, { kind: "card", asset, title: "Resource card", description: "Per-use card description" }];
    for (const value of values) {
      const target = (await service.targets()).find((item) => item.entryId === "entry-39" && item.kind === value.kind)!;
      expect(target).toBeDefined(); await service.insert(target, value);
    }
    const scan = await service.scan(asset);
    expect(scan.status).toBe("complete"); expect(scan.locations).toHaveLength(3);
    expect(scan.locations.find((location) => location.use.kind === "card")).toMatchObject({ fieldId: "nested", valuePath: ["card"], entryId: "entry-39" });
    expect(scan.locations.find((location) => location.use.kind === "link")).toMatchObject({ fieldId: "links", valuePath: [0] });
    expect(await service.isCurrent(scan)).toBe(true);
    const target = (await service.targets()).find((item) => item.entryId === "entry-39" && item.kind === "image")!;
    await service.insert(target, values[0]!);
    expect(await service.isCurrent(scan)).toBe(false);
    await expect(service.insert(target, values[0]!)).rejects.toThrow("Content changed");
  });
  it("does not claim authoritative absence with missing providers or pending save failures", async () => {
    const asset = { providerId: "media-files", assetId: "hero" };
    expect((await createMediaContentServices([], async () => undefined).scan(asset)).status).toBe("unavailable");
    const provider = await content();
    expect((await createMediaContentServices([provider], async () => ({ status: "failed" })).scan(asset)).status).toBe("unavailable");
  });
  it("rejects forged paths and presentation schemas without changing Content", async () => {
    const provider = await content();
    const service = createMediaContentServices([provider], async () => ({ status: "ready" }));
    const target = (await service.targets()).find((item) => item.kind === "image")!;
    const value: MediaUse = { kind: "image", asset: { providerId: "media-files", assetId: "hero" }, alt: "Context", decorative: false, caption: "" };
    const before = await provider.store.readAll();
    await expect(service.insert({ ...target, valuePath: ["__proto__"] }, value)).rejects.toThrow("Invalid nested");
    await expect(service.insert({ ...target, fieldId: "nested" }, value)).rejects.toThrow("destination schema");
    expect(await provider.store.readAll()).toEqual(before);
  });
});
