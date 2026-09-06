import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import {
  MEDIA_SCHEMA_VERSION,
  validateMediaAssetRef,
  validateMediaSnapshot,
  validateMediaVersionPin,
  validateMediaRecord,
  mediaVersionUrl,
  mediaAuthoringUrl,
} from "../model";
import type { MediaAssetRef, MediaRecord, MediaSnapshot, MediaType, MediaVersion, MediaVersionPin, MediaVersionRef, MediaFolder } from "../model";
import { MediaPersistenceError } from "./types";
import type { MediaSummary, VersionedMediaStore } from "./types";

const defaultMediaIdFactory = createUuidIdFactory();

export interface CreateMediaRecordInput {
  fileName: string;
  mediaType: MediaType;
  byteLength: number;
  checksum: string;
  folderId?: string | null;
  note?: string;
}

export interface CreateMediaRecordOptions {
  id?: string;
  timestamp?: string;
  idFactory?: IdFactory;
  now?: () => string;
}

/** Build a detached canonical metadata record from upload metadata. */
export function createMediaRecord(
  input: CreateMediaRecordInput,
  options: CreateMediaRecordOptions = {},
): MediaRecord {
  const id = options.id ?? (options.idFactory ?? defaultMediaIdFactory)("media");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  const version: MediaVersion = { id: input.checksum, checksum: input.checksum, mediaType: input.mediaType,
    byteLength: input.byteLength, url: mediaVersionUrl(input.checksum, input.mediaType), createdAt: timestamp };
  const document: MediaRecord["document"] = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    id,
    fileName: input.fileName,
    folderId: input.folderId ?? null,
    note: input.note ?? "",
    state: "active",
    currentVersionId: version.id,
    versions: [version],
  };
  const record = { id, revision: 1, createdAt: timestamp, updatedAt: timestamp, document };
  const validation = validateMediaRecord(record);
  if (!validation.ok) throw new TypeError(validation.issue.message);
  return validation.value;
}

export function summarizeMedia(record: MediaRecord): MediaSummary {
  const version = currentMediaVersion(record);
  return {
    id: record.id,
    fileName: record.document.fileName,
    mediaType: version.mediaType,
    byteLength: version.byteLength,
    checksum: version.checksum,
    versionId: version.id,
    url: version.url,
    authoringUrl: mediaAuthoringUrl(record.id),
    folderId: record.document.folderId,
    note: record.document.note,
    state: record.document.state,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function currentMediaVersion(record: MediaRecord): MediaVersion {
  const version = record.document.versions.find(({ id }) => id === record.document.currentVersionId);
  if (!version) throw new TypeError("Media current version is missing.");
  return version;
}

/**
 * Resolve a stable authoring asset against one captured Media snapshot.
 *
 * This only selects the current immutable version identity. It does not read
 * bytes or pin working Content. MediaSnapshot is provider-neutral, so this
 * helper carries (but cannot authenticate) asset.providerId; callers must
 * pass the returned ref to a VersionedMediaStore's resolveVersion during
 * release to verify the retained bytes and provider-qualified pin.
 */
export function resolveCurrentMediaVersionRef(snapshot: MediaSnapshot, asset: MediaAssetRef): MediaVersionRef {
  if (!validateMediaSnapshot(snapshot)) throw new TypeError("Media snapshot is invalid.");
  if (!validateMediaAssetRef(asset)) throw new TypeError("Media asset reference must include a providerId and assetId.");
  const record = snapshot.records.find((candidate) => candidate.id === asset.assetId);
  if (!record) throw new TypeError(`Media asset "${asset.assetId}" was not found in the captured snapshot.`);
  if (record.document.state !== "active") throw new TypeError(`Media asset "${asset.assetId}" is not active in the captured snapshot.`);
  return { providerId: asset.providerId, assetId: record.id, versionId: currentMediaVersion(record).id };
}

/**
 * Capture one active head, resolve and verify its exact retained pin, then
 * reject if the provider token changed during that operation. Release code
 * can use this for a single asset, or capture one snapshot and call
 * resolveCurrentMediaVersionRef for a deduplicated pinManifest batch.
 */
export async function resolveCurrentMediaVersionPin(
  store: Pick<VersionedMediaStore, "provider" | "snapshot" | "mutationToken" | "resolveVersion">,
  asset: MediaAssetRef,
): Promise<MediaVersionPin> {
  if (!validateMediaAssetRef(asset)) throw new MediaPersistenceError("pin", "validation", "Media asset reference must include a providerId and assetId.", false);
  if (store.provider.id !== asset.providerId) throw new MediaPersistenceError("pin", "validation", "Media asset belongs to another provider.", false);
  const before = await store.snapshot();
  const ref = resolveCurrentMediaVersionRef(before, asset);
  const pin = await store.resolveVersion(ref);
  if (!validateMediaVersionPin(pin, ref)) throw new MediaPersistenceError("pin", "validation", "Media provider returned a pin for the wrong exact version.", false);
  if (await store.mutationToken() !== before.mutationToken) throw new MediaPersistenceError("pin", "conflict", "Media changed while resolving the current version; recapture before release.", true);
  return pin;
}

/** Display segments only; providers never accept or use this as a disk path. */
export function mediaFolderPath(folders: readonly MediaFolder[], folderId: string | null): readonly string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  while (folderId !== null) {
    const folder = folders.find(({ id }) => id === folderId);
    if (!folder || visited.has(folderId)) throw new TypeError("Media folder path is missing or cyclic.");
    visited.add(folderId); result.unshift(folder.name); folderId = folder.parentId;
  }
  return result;
}

export const summarizeMediaRecord = summarizeMedia;

/** Newest updated Media first; equal timestamps use ascending id order. */
export function compareMediaSummariesNewestFirst(
  a: Pick<MediaSummary, "id" | "updatedAt">,
  b: Pick<MediaSummary, "id" | "updatedAt">,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export const compareMediaNewestFirst = compareMediaSummariesNewestFirst;

export const compareMediaRecordsNewestFirst = compareMediaSummariesNewestFirst;
