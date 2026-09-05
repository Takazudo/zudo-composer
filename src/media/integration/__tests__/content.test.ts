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
  it("observes provider token changes outside the Media insertion service", async () => {
    const provider = await content(); const service = createMediaContentServices([provider], async () => undefined);
    const listener = vi.fn(); const stop = service.subscribeChanges(listener);
    try {
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
      await provider.store.deleteEntry("entry-39");
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2), { timeout: 2000 });
    } finally { stop(); }
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
