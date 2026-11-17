import { describe, expect, it, vi } from "vitest";
import { componentCatalog, composition, entry, mapping, model, page, project } from "../../compiler/__tests__/fixtures";
import { compileSiteProject } from "../../compiler";
import { captureAuthoringProjectAssetLock, captureSiteProjectAssetLock, inspectSiteProjectAsset } from "../capture";
import { compileWithCapturedAsset } from "../compile";
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

function assetStore(ids = ["hero"]): VersionedAssetStore {
  const record = createAssetRecord({ fileName: "hero.png", checksum: assetChecksum, byteLength: 12, mimeType: "image/png" }, { id: "hero", timestamp: "2026-08-31T00:00:00.000Z" });
  const snapshot = { schemaVersion: 1 as const, mutationToken: "b".repeat(64), folders: [], records: ids.map(id => ({ ...structuredClone(record), id, document: { ...structuredClone(record.document), id } })) };
  const pin = { providerId: "asset-files", assetId: "hero", versionId: assetChecksum, checksum: assetChecksum, byteLength: 12, mimeType: "image/png" as const, url: assetVersionUrl(assetChecksum, "image/png") };
  return {
    provider: { id: "asset-files" },
    snapshot: async () => structuredClone(snapshot),
    mutationToken: async () => snapshot.mutationToken,
    resolveVersion: async (ref: { assetId: string }) => ({ ...pin, assetId: ref.assetId }),
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

  it("carries the blocked compile's root cause on the capture result, ahead of the asset-capture-blocked wrapper", async () => {
    const value = project({ root: page("home", undefined, { kind: "unassigned" }) });
    const captured = await captureSiteProjectAssetLock(value, componentCatalog, undefined);
    expect(captured.status).toBe("blocked");
    if (captured.status !== "blocked") return;
    // Not folded into `diagnostics`: `review.ts` maps capture diagnostics to
    // `asset-${code}` release checks and pushes compile diagnostics separately,
    // so putting causes there too would duplicate them.
    expect(captured.diagnostics).toEqual([{ code: "unrecognized", message: "Assets impact inspection is incomplete; exact release capture is blocked." }]);
    expect(captured.causes).toEqual([expect.objectContaining({ code: "unassigned-page", message: "The Sitemap page has no assigned source." })]);

    const compiled = await compileWithCapturedAsset(value, { catalog: componentCatalog });
    expect(compiled.status).toBe("blocked");
    if (compiled.status !== "blocked") return;
    expect(compiled.diagnostics).toHaveLength(2);
    expect(compiled.diagnostics[0]).toMatchObject({ code: "unassigned-page", message: "The Sitemap page has no assigned source." });
    expect(compiled.diagnostics[1]).toMatchObject({ code: "asset-capture-blocked" });
  });
});


describe("authoring-only unassigned page capture", () => {
  const withDraft = (value = assetProject()) => {
    value.providers.sitemaps[0]!.records[0]!.document.root[0]!.children.push(page("draft", "draft", { kind: "unassigned" }));
    return value;
  };

  it("captures detached Content, unused Composition/defaults and materialized sibling assets without certifying release or trash", async () => {
    const value = withDraft();
    const detachedModel = model(); detachedModel.id = "detached-assets"; detachedModel.document.id = detachedModel.id;
    detachedModel.document.fields = [{ id: "image", key: "image", label: "Image", required: true, kind: "asset-use", use: "image" }];
    const detachedEntry = entry("content-only-entry"); detachedEntry.modelId = detachedModel.id; detachedEntry.lifecycle = "draft";
    detachedEntry.values = { image: { kind: "image", asset: { providerId: "asset-files", assetId: "content-only" }, alt: "Unused", decorative: false, caption: "" } };
    value.providers.content[0]!.models.push(detachedModel); value.providers.content[0]!.entries.push(detachedEntry);
    const unused = composition("unused"); unused.document.root[0]!.props.src = "/uploaded-assets/asset-detached";
    value.providers.compositions[0]!.records.push(unused);
    const declaration = structuredClone(assetCatalog.get("leaf")!);
    declaration.defaults.src = "/uploaded-assets/asset-default";
    const catalog = createComponentCatalog({ kind: "zudo-composer/component-pack", contractVersion: 2, packId: "compiler-fixture", packVersion: "1.0.0", components: [declaration] });
    const store = assetStore(["hero", "detached", "default", "content-only"]);
    const captured = await captureAuthoringProjectAssetLock(value, catalog, store);
    expect(captured.status).toBe("ready");
    if (captured.status !== "ready" || !captured.lock) return;
    expect(captured.lock.pins.map(pin => pin.assetId).sort()).toEqual(["content-only", "default", "detached", "hero"]);
    expect(captured.index.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: expect.objectContaining({ assetId: "content-only" }), location: expect.objectContaining({ domain: "content", recordId: "content-only-entry" }) }),
      expect.objectContaining({ ref: expect.objectContaining({ assetId: "hero" }), location: expect.objectContaining({ domain: "content" }) }),
      expect.objectContaining({ ref: expect.objectContaining({ assetId: "hero" }), location: expect.objectContaining({ domain: "materialization" }) }),
      expect.objectContaining({ ref: expect.objectContaining({ assetId: "detached" }), location: expect.objectContaining({ domain: "compositions", recordId: "unused" }) }),
      expect.objectContaining({ ref: expect.objectContaining({ assetId: "default" }), location: expect.objectContaining({ domain: "compositions" }) }),
    ]));
    expect(await captureSiteProjectAssetLock(value, catalog, store)).toMatchObject({ status: "blocked", causes: [expect.objectContaining({ code: "unassigned-page" })] });
    expect((await inspectSiteProjectAsset(value, catalog, await store.snapshot(), store.provider.id)).complete).toBe(false);
    expect(await compileSiteProject(value, { componentCatalog: catalog, assetLock: captured.lock })).toMatchObject({ status: "blocked", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unassigned-page" })]) });
  });

  it("does not excuse another materialization error alongside an unassigned page", async () => {
    const value = withDraft();
    value.providers.sitemaps[0]!.records[0]!.document.root[0]!.children.push(page("missing", "missing", { kind: "composition", ref: { providerId: "files", recordId: "absent" } }));
    const result = await captureAuthoringProjectAssetLock(value, assetCatalog, assetStore());
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.causes.some(diagnostic => diagnostic.code !== "unassigned-page")).toBe(true);
  });

  it.each(["missing", "unknown", "materialized", "version", "changed"])("still refuses %s Assets with an unassigned page", async kind => {
    const value = withDraft(assetProject(kind === "materialized" ? "title" : "src"));
    const store = assetStore();
    if (kind === "missing") value.providers.compositions[0]!.records[0]!.document.root[0]!.props.src = "/uploaded-assets/asset-missing";
    if (kind === "unknown") value.providers.compositions[0]!.records[0]!.document.root[0]!.props.title = "Unparsed /uploaded-assets/asset-hero";
    if (kind === "version") store.resolveVersion = async () => { throw new Error("Missing exact bytes"); };
    if (kind === "changed") store.mutationToken = async () => "c".repeat(64);
    const result = await captureAuthoringProjectAssetLock(value, assetCatalog, store);
    expect(result.status).toBe("blocked");
    if (kind === "changed") expect(result).toMatchObject({ diagnostics: [expect.objectContaining({ code: "changed" })] });
  });
});
