import { describe, expect, it, vi } from "vitest";
import {
  applyContentInverseMutation,
  buildContentGraphIndex,
  createContentEntryRecord,
  createContentModelRecord,
  getContentDeletionBlockers,
  readContentGraph,
} from "../library";
import type { ContentEntryRef, ContentFieldDefinition, ContentAssetUse, ContentValueSchema } from "../model";
import { CONTENT_ENTRY_SCHEMA_VERSION, loadContentEntryRecord } from "../model";
import { applyMappingTransform, isMappingCompatible } from "../../mapping/resolver";
import { createAssetRecord, resolveCurrentAssetVersionPin, resolveCurrentAssetVersionRef } from "../../assets/library";
import {
  ASSET_SCHEMA_VERSION,
  assetVersionUrl,
  validateAssetVersionPin,
  type AssetAssetRef,
  type AssetRecord,
  type AssetSnapshot,
  type AssetType,
  type AssetVersionPin,
  type AssetVersionRef,
} from "../../assets/model";
import { loadAssetRecord } from "../../assets/model";
import type { ContentSnapshot, ContentStore } from "../library";

const timestamp = "2026-09-01T00:00:00.000Z";
const nextTimestamp = "2026-09-02T00:00:00.000Z";
const contentProviderId = "content-filesystem";
const assetProviderId = "asset-files";
const contentModelRef = { providerId: contentProviderId, recordId: "article" };
const targetEntryRef: ContentEntryRef = { providerId: contentProviderId, modelId: "article", recordId: "target" };

function field(id: string, schema: ContentValueSchema, required = false): ContentFieldDefinition {
  return { id, key: id, label: id, required, ...schema } as ContentFieldDefinition;
}

function assetUse(kind: ContentAssetUse["kind"], assetId: string): ContentAssetUse {
  const asset = { providerId: assetProviderId, assetId };
  if (kind === "image") return { kind, asset, alt: "Alt", decorative: false, caption: "Caption" };
  if (kind === "download") return { kind, asset, label: "Download", showSize: true, showType: true };
  if (kind === "link") return { kind, asset, label: "Download" };
  return { kind, asset, title: "Card", description: "Description" };
}

function assetRecord(id: string, mimeType: AssetType, checksumCharacter: string, createdAt = timestamp): AssetRecord {
  return createAssetRecord({
    fileName: `${id}.${mimeType === "application/pdf" ? "pdf" : "png"}`,
    mimeType,
    byteLength: 4,
    checksum: checksumCharacter.repeat(64),
  }, { id, timestamp: createdAt });
}

function fixture() {
  const model = createContentModelRecord({
    name: "Article",
    kind: "collection",
    fields: [
      field("asset", { kind: "object", fields: [
        field("image", { kind: "asset-use", use: "image" }),
        field("link", { kind: "asset-use", use: "link" }),
        field("card", { kind: "asset-use", use: "card" }),
      ] }),
      field("related", { kind: "reference", target: contentModelRef }),
    ],
  }, { id: "article", timestamp });
  const entry = createContentEntryRecord("article", {
    asset: {
      image: assetUse("image", "hero"),
      link: assetUse("link", "document"),
      card: assetUse("card", "card"),
    },
    related: { ...targetEntryRef },
  }, { id: "entry", timestamp });
  const target = createContentEntryRecord("article", {}, { id: "target", timestamp });
  const contentSnapshot: ContentSnapshot = { providerId: contentProviderId, mutationToken: 7, models: [model], entries: [entry, target] };

  const hero = assetRecord("hero", "image/png", "a");
  const document = assetRecord("document", "application/pdf", "b");
  const card = assetRecord("card", "image/png", "c");
  const assetSnapshot: AssetSnapshot = { schemaVersion: ASSET_SCHEMA_VERSION, mutationToken: "1".repeat(64), records: [hero, document, card], folders: [] };
  const heroReplacement = assetRecord("hero", "image/png", "d", nextTimestamp);
  const replacedHero: AssetRecord = {
    ...hero,
    revision: 2,
    updatedAt: nextTimestamp,
    document: {
      ...hero.document,
      currentVersionId: heroReplacement.document.currentVersionId,
      versions: [...hero.document.versions, ...heroReplacement.document.versions],
    },
  };
  const replacedAssetSnapshot: AssetSnapshot = {
    ...assetSnapshot,
    mutationToken: "2".repeat(64),
    records: [replacedHero, document, card],
  };
  return { contentSnapshot, entry, assetSnapshot, replacedAssetSnapshot };
}

function pinFor(snapshot: AssetSnapshot, ref: AssetVersionRef): AssetVersionPin {
  const record = snapshot.records.find((candidate) => candidate.id === ref.assetId)!;
  const version = record.document.versions.find((candidate) => candidate.id === ref.versionId)!;
  return { ...ref, checksum: version.checksum, byteLength: version.byteLength, mimeType: version.mimeType, url: assetVersionUrl(version.checksum, version.mimeType) };
}

describe("headless Content/Asset/Mapping workspace contracts", () => {
  it("keeps image/link/card authoring refs stable and resolves exact current pins at release", async () => {
    const { contentSnapshot, entry, assetSnapshot, replacedAssetSnapshot } = fixture();
    const graph = buildContentGraphIndex([contentSnapshot]);
    expect(graph.complete).toBe(true);
    expect(graph.assetUses.map(({ location }) => location.path)).toEqual([
      ["asset", "image"], ["asset", "link"], ["asset", "card"],
    ]);
    expect(graph.relations).toMatchObject([{ owner: { entry: { recordId: "entry" }, path: ["related"] }, target: targetEntryRef }]);

    const uses = graph.assetUses.map(({ use }) => use);
    for (const use of uses) {
      expect(Object.keys(use.asset).sort()).toEqual(["assetId", "providerId"]);
      const asset: AssetAssetRef = use.asset;
      const ref = resolveCurrentAssetVersionRef(assetSnapshot, asset);
      expect(ref).toMatchObject({ providerId: assetProviderId, assetId: asset.assetId });
      expect(ref.versionId).toBe(assetSnapshot.records.find(({ id }) => id === asset.assetId)!.document.currentVersionId);
      expect(validateAssetVersionPin(pinFor(assetSnapshot, ref), ref)).toBe(true);
    }

    const image = uses.find((use) => use.kind === "image")!;
    const oldRef = resolveCurrentAssetVersionRef(assetSnapshot, image.asset);
    const oldPin = pinFor(assetSnapshot, oldRef);
    const stableStore = {
      provider: { id: assetProviderId, label: "Project files" },
      snapshot: vi.fn(async () => assetSnapshot),
      mutationToken: vi.fn(async () => assetSnapshot.mutationToken),
      resolveVersion: vi.fn(async (ref: AssetVersionRef) => pinFor(assetSnapshot, ref)),
    };
    await expect(resolveCurrentAssetVersionPin(stableStore, image.asset)).resolves.toEqual(oldPin);
    expect(stableStore.resolveVersion).toHaveBeenCalledWith(oldRef);
    stableStore.snapshot.mockClear();
    const foreignStore = { ...stableStore, provider: { id: "other-asset", label: "Other files" } };
    await expect(resolveCurrentAssetVersionPin(foreignStore, image.asset)).rejects.toMatchObject({ code: "validation" });
    expect(foreignStore.snapshot).not.toHaveBeenCalled();

    const newRef = resolveCurrentAssetVersionRef(replacedAssetSnapshot, image.asset);
    expect(newRef.versionId).not.toBe(oldRef.versionId);
    expect(validateAssetVersionPin(oldPin, oldRef)).toBe(true);
    expect(entry.values.asset).not.toHaveProperty("versionId");

    const changedStore = {
      ...stableStore,
      mutationToken: vi.fn(async () => replacedAssetSnapshot.mutationToken),
    };
    await expect(resolveCurrentAssetVersionPin(changedStore, image.asset)).rejects.toMatchObject({ code: "conflict" });
    const trashed = structuredClone(assetSnapshot);
    trashed.records[0]!.document.state = "trash";
    expect(() => resolveCurrentAssetVersionRef(trashed, image.asset)).toThrow("not active");
  });

  it("never treats incomplete reference/asset scans as proof of unused data", async () => {
    const { contentSnapshot, entry } = fixture();
    const missingTarget: ContentSnapshot = { ...contentSnapshot, entries: [entry] };
    const incomplete = buildContentGraphIndex([missingTarget]);
    expect(incomplete.complete).toBe(false);
    expect(getContentDeletionBlockers(incomplete, { kind: "entry", ref: { ...targetEntryRef } })).toMatchObject([{ code: "unknown" }]);

    let reads = 0;
    const changingStore = {
      provider: { id: contentProviderId, label: "Browser storage" },
      readAll: vi.fn(async () => reads++ === 0 ? contentSnapshot : { ...contentSnapshot, mutationToken: 8 }),
    };
    await expect(readContentGraph([changingStore])).resolves.toMatchObject({ status: "changed", providerIds: [contentProviderId] });
    expect(changingStore.readAll).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-provider writes, rich scalar mappings, and old schemas before recovery is guessed", async () => {
    const { contentSnapshot, entry, assetSnapshot } = fixture();
    const transact = vi.fn();
    const store = {
      provider: { id: contentProviderId, label: "Browser storage" },
      transactionScope: "provider",
      transact,
    } as unknown as ContentStore;
    await expect(applyContentInverseMutation(store, [contentSnapshot], [
      { owner: { providerId: contentProviderId, modelId: "article", recordId: entry.id }, fieldId: "related", targets: [] },
      { owner: { providerId: "foreign", modelId: "article", recordId: "other" }, fieldId: "related", targets: [] },
    ])).rejects.toMatchObject({ code: "unsupported-transaction" });
    expect(transact).not.toHaveBeenCalled();

    for (const kind of ["choice", "reference", "reference-list", "object", "list", "asset-use"] as const) {
      expect(isMappingCompatible(kind, "text", { kind: "identity" })).toBe(false);
    }
    expect(() => applyMappingTransform({ kind: "image" } as never, { kind: "identity" })).toThrow("structured Content");

    const oldEntry = { ...entry, schemaVersion: 0 as never };
    expect(loadContentEntryRecord(oldEntry)).toMatchObject({ status: "invalid", raw: oldEntry });
    const futureEntry = { ...entry, schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION + 1 };
    expect(loadContentEntryRecord(futureEntry)).toMatchObject({ status: "future-schema", raw: futureEntry });
    const record = assetSnapshot.records[0]!;
    const oldAsset = { ...record, document: { ...record.document, schemaVersion: 0 as never } };
    expect(loadAssetRecord(oldAsset)).toMatchObject({ status: "invalid", raw: oldAsset });
    const futureAsset = { ...record, document: { ...record.document, schemaVersion: ASSET_SCHEMA_VERSION + 1 } };
    expect(loadAssetRecord(futureAsset)).toMatchObject({ status: "future-schema", raw: futureAsset });
  });
});
