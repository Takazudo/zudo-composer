import type {
  MediaBytesMissingReason,
  MediaLoadOutcome,
  MediaRecord,
  MediaSnapshot, MediaFolder, MediaVersionRef, MediaVersionPin, MediaPinManifest,
} from "../model";
import type { MediaType } from "../model";
import type { RecordId } from "../../shared";

/** Provider identities are data, not application-layer implementations. */
export interface MediaProviderDescriptor {
  readonly id: string;
  readonly label: string;
}

export const MEDIA_PROVIDERS = {
  files: { id: "media-files", label: "Project files" },
} as const satisfies Record<string, MediaProviderDescriptor>;

/** The inexpensive representation used by library listings. */
export interface MediaSummary {
  id: RecordId;
  fileName: string;
  mediaType: MediaType;
  byteLength: number;
  checksum: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  folderId: string | null;
  note: string;
  state: "active" | "trash";
  versionId: string;
  url: string;
  authoringUrl: string;
}

/** Bytes never travel through a persisted MediaRecord. */
export type MediaByteSource =
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export type MediaPersistenceOperation =
  | "initialize"
  | "list"
  | "get"
  | "put"
  | "delete"
  | "seed"
  | "snapshot" | "replace" | "metadata" | "folder" | "trash" | "restore" | "pin"
  | "clear";

export type MediaPersistenceErrorCode =
  | "unavailable"
  | "blocked"
  | "versionchange"
  | "unsupported-version"
  | "validation"
  | "conflict" | "recovery-required"
  | "not-found"
  | "bytes-missing"
  | "read-failed"
  | "write-failed"
  | "transaction-failed"
  | "unknown";

/** Provider-neutral persistence failure. */
export class MediaPersistenceError extends Error {
  readonly name = "MediaPersistenceError";

  constructor(
    readonly operation: MediaPersistenceOperation,
    readonly code: MediaPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface MediaStore {
  readonly provider: MediaProviderDescriptor;
  list(): Promise<readonly MediaSummary[]>;
  get(id: string): Promise<MediaLoadOutcome>;
  /** `bytes` is separate from JSON metadata and may be a streaming source. */
  put(record: MediaRecord, bytes: MediaByteSource): Promise<void>;
  /** Soft trash only. Missing preconditions are rejected, never guessed. */
  delete(id: string, precondition?: MediaMutationPrecondition): Promise<boolean>;
  /** Optional fixture convenience; filesystem providers need not implement it. */
  seed?(seed: MediaSeed): Promise<void>;
  clear(): Promise<void>;
}

export interface MediaMutationPrecondition {
  expectedRevision: number;
  /** Optional provider-wide CAS in addition to mandatory record/folder CAS. */
  expectedMutationToken?: string;
}
export interface MediaMetadataPatch { fileName?: string; folderId?: string | null; note?: string }
export interface MediaFolderPatch { name?: string; parentId?: string | null }
export interface MediaListOptions { state?: "active" | "trash" | "all"; folderId?: string | null }
export const MEDIA_VERSIONED_CAPABILITIES = Object.freeze({ folders: true, metadata: true, replace: true,
  trash: true, restore: true, exactVersions: true, snapshot: true, permanentDelete: false } as const);

export interface VersionedMediaStore extends MediaStore {
  readonly capabilities: typeof MEDIA_VERSIONED_CAPABILITIES;
  list(options?: MediaListOptions): Promise<readonly MediaSummary[]>;
  snapshot(): Promise<MediaSnapshot>;
  mutationToken(): Promise<string>;
  updateMetadata(id: string, patch: MediaMetadataPatch, precondition: MediaMutationPrecondition): Promise<MediaRecord>;
  trash(id: string, precondition: MediaMutationPrecondition): Promise<MediaRecord>;
  restore(id: string, precondition: MediaMutationPrecondition): Promise<MediaRecord>;
  createFolder(input: { name: string; parentId: string | null }, expectedMutationToken: string): Promise<MediaFolder>;
  updateFolder(id: string, patch: MediaFolderPatch, precondition: MediaMutationPrecondition): Promise<MediaFolder>;
  trashFolder(id: string, precondition: MediaMutationPrecondition): Promise<MediaFolder>;
  restoreFolder(id: string, precondition: MediaMutationPrecondition): Promise<MediaFolder>;
  /** Reads and verifies retained bytes even when the asset is in trash. */
  resolveVersion(ref: MediaVersionRef): Promise<MediaVersionPin>;
  pinManifest(refs: readonly MediaVersionRef[]): Promise<MediaPinManifest>;
}

export interface MediaSeed {
  readonly records: readonly MediaRecord[];
  /** Optional fixture/provider byte payloads keyed by record id. */
  readonly bytes?: Readonly<Record<string, MediaByteSource>>;
}

export type MediaRecoveryReason = "invalid" | "future-schema";

export interface MediaRecoveryOutcome {
  kind: "quarantined";
  reason: MediaRecoveryReason;
  sourcePreserved: true;
  affectedRecordIds: readonly string[];
  foundSchemaVersion?: number;
  message: string;
}

export type MediaInitializationOutcome =
  | { status: "ready"; summaries: readonly MediaSummary[] }
  | { status: "recovery-required"; summaries: readonly MediaSummary[]; recovery: MediaRecoveryOutcome }
  | { status: "error"; error: MediaPersistenceError };

export interface MediaProvider {
  readonly descriptor: MediaProviderDescriptor;
  readonly store: MediaStore;
  readonly initialization: {
    initialize(): Promise<MediaInitializationOutcome>;
    retry(): Promise<MediaInitializationOutcome>;
    startFresh(): Promise<MediaInitializationOutcome>;
  };
}

/** Re-exporting this alias keeps consumers from importing model internals. */
export type { MediaBytesMissingReason };
