import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import {
  ASSET_SCHEMA_VERSION,
  validateAssetAssetRef,
  validateAssetSnapshot,
  validateAssetVersionPin,
  validateAssetRecord,
  assetVersionUrl,
  assetAuthoringUrl,
} from "../model";
import type { AssetAssetRef, AssetRecord, AssetSnapshot, AssetType, AssetVersion, AssetVersionPin, AssetVersionRef, AssetFolder } from "../model";
import { AssetPersistenceError } from "./types";
import type { AssetSummary, VersionedAssetStore } from "./types";

const defaultAssetIdFactory = createUuidIdFactory();

export interface CreateAssetRecordInput {
  fileName: string;
  mimeType: AssetType;
  byteLength: number;
  checksum: string;
  folderId?: string | null;
  note?: string;
}

export interface CreateAssetRecordOptions {
  id?: string;
  timestamp?: string;
  idFactory?: IdFactory;
  now?: () => string;
}

/** Build a detached canonical metadata record from upload metadata. */
export function createAssetRecord(
  input: CreateAssetRecordInput,
  options: CreateAssetRecordOptions = {},
): AssetRecord {
  const id = options.id ?? (options.idFactory ?? defaultAssetIdFactory)("assets");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  const version: AssetVersion = { id: input.checksum, checksum: input.checksum, mimeType: input.mimeType,
    byteLength: input.byteLength, url: assetVersionUrl(input.checksum, input.mimeType), createdAt: timestamp };
  const document: AssetRecord["document"] = {
    schemaVersion: ASSET_SCHEMA_VERSION,
    id,
    fileName: input.fileName,
    folderId: input.folderId ?? null,
    note: input.note ?? "",
    state: "active",
    currentVersionId: version.id,
    versions: [version],
  };
  const record = { id, revision: 1, createdAt: timestamp, updatedAt: timestamp, document };
  const validation = validateAssetRecord(record);
  if (!validation.ok) throw new TypeError(validation.issue.message);
  return validation.value;
}

export function summarizeAsset(record: AssetRecord): AssetSummary {
  const version = currentAssetVersion(record);
  return {
    id: record.id,
    fileName: record.document.fileName,
    mimeType: version.mimeType,
    byteLength: version.byteLength,
    checksum: version.checksum,
    versionId: version.id,
    url: version.url,
    authoringUrl: assetAuthoringUrl(record.id),
    folderId: record.document.folderId,
    note: record.document.note,
    state: record.document.state,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function currentAssetVersion(record: AssetRecord): AssetVersion {
  const version = record.document.versions.find(({ id }) => id === record.document.currentVersionId);
  if (!version) throw new TypeError("Assets current version is missing.");
  return version;
}

/**
 * Resolve a stable authoring asset against one captured Assets snapshot.
 *
 * This only selects the current immutable version identity. It does not read
 * bytes or pin working Content. AssetSnapshot is provider-neutral, so this
 * helper carries (but cannot authenticate) asset.providerId; callers must
 * pass the returned ref to a VersionedAssetStore's resolveVersion during
 * release to verify the retained bytes and provider-qualified pin.
 */
export function resolveCurrentAssetVersionRef(snapshot: AssetSnapshot, asset: AssetAssetRef): AssetVersionRef {
  if (!validateAssetSnapshot(snapshot)) throw new TypeError("Assets snapshot is invalid.");
  if (!validateAssetAssetRef(asset)) throw new TypeError("Assets asset reference must include a providerId and assetId.");
  const record = snapshot.records.find((candidate) => candidate.id === asset.assetId);
  if (!record) throw new TypeError(`Assets asset "${asset.assetId}" was not found in the captured snapshot.`);
  if (record.document.state !== "active") throw new TypeError(`Assets asset "${asset.assetId}" is not active in the captured snapshot.`);
  return { providerId: asset.providerId, assetId: record.id, versionId: currentAssetVersion(record).id };
}

/**
 * Capture one active head, resolve and verify its exact retained pin, then
 * reject if the provider token changed during that operation. Release code
 * can use this for a single asset, or capture one snapshot and call
 * resolveCurrentAssetVersionRef for a deduplicated pinManifest batch.
 */
export async function resolveCurrentAssetVersionPin(
  store: Pick<VersionedAssetStore, "provider" | "snapshot" | "mutationToken" | "resolveVersion">,
  asset: AssetAssetRef,
): Promise<AssetVersionPin> {
  if (!validateAssetAssetRef(asset)) throw new AssetPersistenceError("pin", "validation", "Assets asset reference must include a providerId and assetId.", false);
  if (store.provider.id !== asset.providerId) throw new AssetPersistenceError("pin", "validation", "Assets asset belongs to another provider.", false);
  const before = await store.snapshot();
  const ref = resolveCurrentAssetVersionRef(before, asset);
  const pin = await store.resolveVersion(ref);
  if (!validateAssetVersionPin(pin, ref)) throw new AssetPersistenceError("pin", "validation", "Assets provider returned a pin for the wrong exact version.", false);
  if (await store.mutationToken() !== before.mutationToken) throw new AssetPersistenceError("pin", "conflict", "Assets changed while resolving the current version; recapture before release.", true);
  return pin;
}

/** Display segments only; providers never accept or use this as a disk path. */
export function assetFolderPath(folders: readonly AssetFolder[], folderId: string | null): readonly string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  while (folderId !== null) {
    const folder = folders.find(({ id }) => id === folderId);
    if (!folder || visited.has(folderId)) throw new TypeError("Assets folder path is missing or cyclic.");
    visited.add(folderId); result.unshift(folder.name); folderId = folder.parentId;
  }
  return result;
}

export const summarizeAssetRecord = summarizeAsset;

/** Newest updated Assets first; equal timestamps use ascending id order. */
export function compareAssetSummariesNewestFirst(
  a: Pick<AssetSummary, "id" | "updatedAt">,
  b: Pick<AssetSummary, "id" | "updatedAt">,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export const compareAssetNewestFirst = compareAssetSummariesNewestFirst;

export const compareAssetRecordsNewestFirst = compareAssetSummariesNewestFirst;
