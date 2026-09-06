import { describe, expect, it, vi } from "vitest";
import {
  applyContentInverseMutation,
  buildContentGraphIndex,
  createContentEntryRecord,
  createContentModelRecord,
  getContentDeletionBlockers,
  readContentGraph,
} from "../library";
import type { ContentEntryRef, ContentFieldDefinition, ContentMediaUse, ContentValueSchema } from "../model";
import { CONTENT_ENTRY_SCHEMA_VERSION, loadContentEntryRecord } from "../model";
import { applyMappingTransform, isMappingCompatible } from "../../mapping/resolver";
import { createMediaRecord, resolveCurrentMediaVersionPin, resolveCurrentMediaVersionRef } from "../../media/library";
import {
  MEDIA_SCHEMA_VERSION,
  mediaVersionUrl,
  validateMediaVersionPin,
  type MediaAssetRef,
  type MediaRecord,
  type MediaSnapshot,
  type MediaType,
  type MediaVersionPin,
  type MediaVersionRef,
} from "../../media/model";
import { loadMediaRecord } from "../../media/model";
import type { ContentSnapshot, ContentStore } from "../library";

const timestamp = "2026-09-01T00:00:00.000Z";
const nextTimestamp = "2026-09-02T00:00:00.000Z";
const contentProviderId = "content-filesystem";
const mediaProviderId = "media-files";
const contentModelRef = { providerId: contentProviderId, recordId: "article" };
const targetEntryRef: ContentEntryRef = { providerId: contentProviderId, modelId: "article", recordId: "target" };

function field(id: string, schema: ContentValueSchema, required = false): ContentFieldDefinition {
  return { id, key: id, label: id, required, ...schema } as ContentFieldDefinition;
}

function mediaUse(kind: ContentMediaUse["kind"], assetId: string): ContentMediaUse {
  const asset = { providerId: mediaProviderId, assetId };
  if (kind === "image") return { kind, asset, alt: "Alt", decorative: false, caption: "Caption" };
  if (kind === "link") return { kind, asset, label: "Download" };
  return { kind, asset, title: "Card", description: "Description" };
}

function mediaRecord(id: string, mediaType: MediaType, checksumCharacter: string, createdAt = timestamp): MediaRecord {
  return createMediaRecord({
    fileName: `${id}.${mediaType === "application/pdf" ? "pdf" : "png"}`,
    mediaType,
    byteLength: 4,
    checksum: checksumCharacter.repeat(64),
  }, { id, timestamp: createdAt });
}

function fixture() {
  const model = createContentModelRecord({
    name: "Article",
    kind: "collection",
    fields: [
      field("media", { kind: "object", fields: [
        field("image", { kind: "media-use", use: "image" }),
        field("link", { kind: "media-use", use: "link" }),
        field("card", { kind: "media-use", use: "card" }),
      ] }),
      field("related", { kind: "reference", target: contentModelRef }),
    ],
  }, { id: "article", timestamp });
  const entry = createContentEntryRecord("article", {
    media: {
      image: mediaUse("image", "hero"),
      link: mediaUse("link", "document"),
      card: mediaUse("card", "card"),
    },
    related: { ...targetEntryRef },
  }, { id: "entry", timestamp });
  const target = createContentEntryRecord("article", {}, { id: "target", timestamp });
  const contentSnapshot: ContentSnapshot = { providerId: contentProviderId, mutationToken: 7, models: [model], entries: [entry, target] };

  const hero = mediaRecord("hero", "image/png", "a");
  const document = mediaRecord("document", "application/pdf", "b");
  const card = mediaRecord("card", "image/png", "c");
  const mediaSnapshot: MediaSnapshot = { schemaVersion: MEDIA_SCHEMA_VERSION, mutationToken: "1".repeat(64), records: [hero, document, card], folders: [] };
  const heroReplacement = mediaRecord("hero", "image/png", "d", nextTimestamp);
  const replacedHero: MediaRecord = {
    ...hero,
    revision: 2,
    updatedAt: nextTimestamp,
    document: {
      ...hero.document,
      currentVersionId: heroReplacement.document.currentVersionId,
      versions: [...hero.document.versions, ...heroReplacement.document.versions],
    },
  };
  const replacedMediaSnapshot: MediaSnapshot = {
    ...mediaSnapshot,
    mutationToken: "2".repeat(64),
    records: [replacedHero, document, card],
  };
  return { contentSnapshot, entry, mediaSnapshot, replacedMediaSnapshot };
}

function pinFor(snapshot: MediaSnapshot, ref: MediaVersionRef): MediaVersionPin {
  const record = snapshot.records.find((candidate) => candidate.id === ref.assetId)!;
  const version = record.document.versions.find((candidate) => candidate.id === ref.versionId)!;
  return { ...ref, checksum: version.checksum, byteLength: version.byteLength, mediaType: version.mediaType, url: mediaVersionUrl(version.checksum, version.mediaType) };
}

describe("headless Content/Media/Mapping workspace contracts", () => {
  it("keeps image/link/card authoring refs stable and resolves exact current pins at release", async () => {
    const { contentSnapshot, entry, mediaSnapshot, replacedMediaSnapshot } = fixture();
    const graph = buildContentGraphIndex([contentSnapshot]);
    expect(graph.complete).toBe(true);
    expect(graph.mediaUses.map(({ location }) => location.path)).toEqual([
      ["media", "image"], ["media", "link"], ["media", "card"],
    ]);
    expect(graph.relations).toMatchObject([{ owner: { entry: { recordId: "entry" }, path: ["related"] }, target: targetEntryRef }]);

    const uses = graph.mediaUses.map(({ use }) => use);
    for (const use of uses) {
      expect(Object.keys(use.asset).sort()).toEqual(["assetId", "providerId"]);
      const asset: MediaAssetRef = use.asset;
      const ref = resolveCurrentMediaVersionRef(mediaSnapshot, asset);
      expect(ref).toMatchObject({ providerId: mediaProviderId, assetId: asset.assetId });
      expect(ref.versionId).toBe(mediaSnapshot.records.find(({ id }) => id === asset.assetId)!.document.currentVersionId);
      expect(validateMediaVersionPin(pinFor(mediaSnapshot, ref), ref)).toBe(true);
    }

    const image = uses.find((use) => use.kind === "image")!;
    const oldRef = resolveCurrentMediaVersionRef(mediaSnapshot, image.asset);
    const oldPin = pinFor(mediaSnapshot, oldRef);
    const stableStore = {
      provider: { id: mediaProviderId, label: "Project files" },
      snapshot: vi.fn(async () => mediaSnapshot),
      mutationToken: vi.fn(async () => mediaSnapshot.mutationToken),
      resolveVersion: vi.fn(async (ref: MediaVersionRef) => pinFor(mediaSnapshot, ref)),
    };
    await expect(resolveCurrentMediaVersionPin(stableStore, image.asset)).resolves.toEqual(oldPin);
    expect(stableStore.resolveVersion).toHaveBeenCalledWith(oldRef);
    stableStore.snapshot.mockClear();
    const foreignStore = { ...stableStore, provider: { id: "other-media", label: "Other files" } };
    await expect(resolveCurrentMediaVersionPin(foreignStore, image.asset)).rejects.toMatchObject({ code: "validation" });
    expect(foreignStore.snapshot).not.toHaveBeenCalled();

    const newRef = resolveCurrentMediaVersionRef(replacedMediaSnapshot, image.asset);
    expect(newRef.versionId).not.toBe(oldRef.versionId);
    expect(validateMediaVersionPin(oldPin, oldRef)).toBe(true);
    expect(entry.values.media).not.toHaveProperty("versionId");

    const changedStore = {
      ...stableStore,
      mutationToken: vi.fn(async () => replacedMediaSnapshot.mutationToken),
    };
    await expect(resolveCurrentMediaVersionPin(changedStore, image.asset)).rejects.toMatchObject({ code: "conflict" });
    const trashed = structuredClone(mediaSnapshot);
    trashed.records[0]!.document.state = "trash";
    expect(() => resolveCurrentMediaVersionRef(trashed, image.asset)).toThrow("not active");
  });

  it("never treats incomplete reference/media scans as proof of unused data", async () => {
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
    const { contentSnapshot, entry, mediaSnapshot } = fixture();
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

    for (const kind of ["choice", "reference", "reference-list", "object", "list", "media-use"] as const) {
      expect(isMappingCompatible(kind, "text", { kind: "identity" })).toBe(false);
    }
    expect(() => applyMappingTransform({ kind: "image" } as never, { kind: "identity" })).toThrow("structured Content");

    const oldEntry = { ...entry, schemaVersion: 0 as never };
    expect(loadContentEntryRecord(oldEntry)).toMatchObject({ status: "invalid", raw: oldEntry });
    const futureEntry = { ...entry, schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION + 1 };
    expect(loadContentEntryRecord(futureEntry)).toMatchObject({ status: "future-schema", raw: futureEntry });
    const record = mediaSnapshot.records[0]!;
    const oldMedia = { ...record, document: { ...record.document, schemaVersion: 1 as never } };
    expect(loadMediaRecord(oldMedia)).toMatchObject({ status: "invalid", raw: oldMedia });
    const futureMedia = { ...record, document: { ...record.document, schemaVersion: MEDIA_SCHEMA_VERSION + 1 } };
    expect(loadMediaRecord(futureMedia)).toMatchObject({ status: "future-schema", raw: futureMedia });
  });
});
