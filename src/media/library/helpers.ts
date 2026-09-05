import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import {
  MEDIA_SCHEMA_VERSION,
  validateMediaRecord,
  mediaVersionUrl,
  mediaAuthoringUrl,
} from "../model";
import type { MediaRecord, MediaType, MediaVersion, MediaFolder } from "../model";
import type { MediaSummary } from "./types";

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
