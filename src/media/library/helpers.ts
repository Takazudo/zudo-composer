import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import {
  MEDIA_SCHEMA_VERSION,
  validateMediaRecord,
} from "../model";
import type { MediaDocument, MediaRecord } from "../model";
import type { MediaSummary } from "./types";

const defaultMediaIdFactory = createUuidIdFactory();

export interface CreateMediaRecordInput {
  fileName: string;
  mediaType: MediaDocument["mediaType"];
  byteLength: number;
  checksum: string;
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
  const document: MediaDocument = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    id,
    fileName: input.fileName,
    mediaType: input.mediaType,
    byteLength: input.byteLength,
    checksum: input.checksum,
  };
  const record = { id, createdAt: timestamp, updatedAt: timestamp, document };
  const validation = validateMediaRecord(record);
  if (!validation.ok) throw new TypeError(validation.issue.message);
  return validation.value;
}

export function summarizeMedia(record: MediaRecord): MediaSummary {
  return {
    id: record.id,
    fileName: record.document.fileName,
    mediaType: record.document.mediaType,
    byteLength: record.document.byteLength,
    checksum: record.document.checksum,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
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
