import { describe, expect, it, vi } from "vitest";
import { componentCatalog, composition, entry, mapping, model, page, project } from "../../compiler/__tests__/fixtures";
import { compileSiteProject } from "../../compiler";
import { captureSiteProjectAssetLock } from "../capture";
import { createProjectAssetUsageInspection } from "../usage";
import type { VersionedAssetStore } from "../../../assets/library";
import { createAssetRecord, assetVersionUrl } from "../../../assets";
import { createComponentCatalog } from "../../../composer/model/types";

const assetChecksum = "a".repeat(64);
const assetCatalog = createComponentCatalog({
  kind: "zudo-composer/component-pack",
  contractVersion: 2,
  packId: "capture-asset-test",
  packVersion: "1",
  components: [{
    ...componentCatalog.get("leaf")!,
    fields: [
      { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
      { prop: "src", label: "Source", schema: { type: "string" }, editor: { kind: "text" } },
    ],
  }],
});

function assetProject(targetProp = "src") {
  const contentModel = model("single");
  contentModel.document.fields = [{ id: "hero", key: "hero", label: "Hero", required: true, kind: "asset-use", use: "image" }];
  const contentEntry = entry("hero-entry");
  contentEntry.values = { hero: { kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "Hero", decorative: false, caption: "" } };
  const assetMapping = mapping();
  assetMapping.document.bindings = [{ id: "hero-binding", sourceFieldId: "hero", projection: { kind: "asset-url" }, target: { nodeId: "landing-leaf", prop: targetProp }, transform: { kind: "identity" } }];
  return project({
    root: page("home", undefined, { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: assetMapping.id }, route: { kind: "single" } }),
    compositions: [composition("landing")],
    contentModel,
    entries: [contentEntry],
    mappings: [assetMapping],
  });
}

function assetStore(): VersionedAssetStore {
  const record = createAssetRecord({ fileName: "hero.png", checksum: assetChecksum, byteLength: 12, mimeType: "image/png" }, { id: "hero", timestamp: "2026-08-31T00:00:00.000Z" });
  const snapshot = { schemaVersion: 1 as const, mutationToken: "b".repeat(64), folders: [], records: [record] };
  const pin = { providerId: "asset-files", assetId: "hero", versionId: assetChecksum, checksum: assetChecksum, byteLength: 12, mimeType: "image/png" as const, url: assetVersionUrl(assetChecksum, "image/png") };
  return {
    provider: { id: "asset-files" },
    snapshot: async () => structuredClone(snapshot),
    mutationToken: async () => snapshot.mutationToken,
    resolveVersion: async () => ({ ...pin }),
  } as unknown as VersionedAssetStore;
}

describe("coherent project assets inspection", () => {
  it("coalesces reads and detects a changed exact project revision", async () => {
    const value = project();
    const readProject = vi.fn(async () => structuredClone(value));
    const inspection = createProjectAssetUsageInspection({ readProject, catalog: componentCatalog });
    const first = inspection.read(), second = inspection.read();
    expect(first).toBe(second);
    const result = await first;
    expect(result.index.complete).toBe(true);
    expect(readProject).toHaveBeenCalledTimes(2);
    expect(await inspection.isCurrent(result.revision)).toBe(true);
    value.providers.compositions[0]!.records[0]!.document.root[0]!.props.title = "Changed";
    expect(await inspection.isCurrent(result.revision)).toBe(false);
  });
  it("captures asset-free projects without a provider and returns typed provider failure", async () => {
    expect(await captureSiteProjectAssetLock(project(), componentCatalog, undefined)).toMatchObject({ status: "ready", lock: undefined });
    const unavailable = { snapshot: async () => { throw new Error("Offline"); } } as unknown as VersionedAssetStore;
    expect(await captureSiteProjectAssetLock(project(), componentCatalog, unavailable)).toMatchObject({ status: "blocked", index: { complete: false }, diagnostics: [{ code: "unavailable", message: "Offline" }] });
  });

  it("captures mapped asset URLs, pins them for release, and blocks unsupported mapped props", async () => {
    const store = assetStore();
    const captured = await captureSiteProjectAssetLock(assetProject(), assetCatalog, store);
    expect(captured.status).toBe("ready");
    if (captured.status !== "ready" || !captured.lock) return;

    const released = await compileSiteProject(assetProject(), { componentCatalog: assetCatalog, assetLock: captured.lock });
    expect(released.status).toBe("ready");
    if (released.status === "ready") expect(released.build.routes[0]!.composition.document.root[0]!.props.src).toBe(assetVersionUrl(assetChecksum, "image/png"));

    const unsupported = await compileSiteProject(assetProject("title"), { componentCatalog: assetCatalog, assetLock: captured.lock });
    expect(unsupported).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "asset-lock-required" })] });
  });
});
