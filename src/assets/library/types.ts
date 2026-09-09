import type {
  AssetBytesMissingReason,
  AssetLoadOutcome,
  AssetRecord,
  AssetSnapshot, AssetFolder, AssetVersionRef, AssetVersionPin, AssetPinManifest,
} from "../model";
import type { AssetType } from "../model";
import type { RecordId } from "../../shared";

/** Provider identities are data, not application-layer implementations. */
export interface AssetProviderDescriptor {
  readonly id: string;
  readonly label: string;
}

export const ASSET_PROVIDERS = {
  files: { id: "asset-files", label: "Project files" },
} as const satisfies Record<string, AssetProviderDescriptor>;

/** The inexpensive representation used by library listings. */
export interface AssetSummary {
  id: RecordId;
  fileName: string;
  mimeType: AssetType;
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

/** Bytes never travel through a persisted AssetRecord. */
export type AssetByteSource =
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export type AssetPersistenceOperation =
  | "initialize"
  | "list"
  | "get"
  | "put"
  | "delete"
  | "seed"
  | "snapshot" | "replace" | "metadata" | "folder" | "trash" | "restore" | "pin"
  | "clear";

export type AssetPersistenceErrorCode =
  | "unavailable"
  | "blocked"
  | "versionchange"
  | "unsupported-version"
  | "validation"
  | "conflict" | "recovery-required" | "commit-uncertain"
  | "not-found"
  | "bytes-missing"
  | "read-failed"
  | "write-failed"
  | "transaction-failed"
  | "unknown";

/** Provider-neutral persistence failure. */
export class AssetPersistenceError extends Error {
  readonly name = "AssetPersistenceError";

  constructor(
    readonly operation: AssetPersistenceOperation,
    readonly code: AssetPersistenceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface AssetStore {
  readonly provider: AssetProviderDescriptor;
  list(): Promise<readonly AssetSummary[]>;
  get(id: string): Promise<AssetLoadOutcome>;
  /** `bytes` is separate from JSON metadata and may be a streaming source. */
  put(record: AssetRecord, bytes: AssetByteSource): Promise<void>;
  /** Soft trash only. Missing preconditions are rejected, never guessed. */
  delete(id: string, precondition?: AssetMutationPrecondition): Promise<boolean>;
  /** Optional fixture convenience; filesystem providers need not implement it. */
  seed?(seed: AssetSeed): Promise<void>;
  clear(): Promise<void>;
}

export interface AssetMutationPrecondition {
  expectedRevision: number;
  /** Optional provider-wide CAS in addition to mandatory record/folder CAS. */
  expectedMutationToken?: string;
}
export interface AssetMetadataPatch { fileName?: string; folderId?: string | null; note?: string }
export interface AssetFolderPatch { name?: string; parentId?: string | null; index?: number }
export interface AssetListOptions { state?: "active" | "trash" | "all"; folderId?: string | null }
export const ASSET_VERSIONED_CAPABILITIES = Object.freeze({ folders: true, metadata: true, replace: true,
  trash: true, restore: true, exactVersions: true, snapshot: true, permanentDelete: false } as const);

export interface VersionedAssetStore extends AssetStore {
  readonly capabilities: typeof ASSET_VERSIONED_CAPABILITIES;
  list(options?: AssetListOptions): Promise<readonly AssetSummary[]>;
  snapshot(): Promise<AssetSnapshot>;
  mutationToken(): Promise<string>;
  updateMetadata(id: string, patch: AssetMetadataPatch, precondition: AssetMutationPrecondition): Promise<AssetRecord>;
  trash(id: string, precondition: AssetMutationPrecondition): Promise<AssetRecord>;
  restore(id: string, precondition: AssetMutationPrecondition): Promise<AssetRecord>;
  createFolder(input: { name: string; parentId: string | null; index?: number }, expectedMutationToken: string): Promise<AssetFolder>;
  updateFolder(id: string, patch: AssetFolderPatch, precondition: AssetMutationPrecondition): Promise<AssetFolder>;
  trashFolder(id: string, precondition: AssetMutationPrecondition): Promise<AssetFolder>;
  restoreFolder(id: string, precondition: AssetMutationPrecondition): Promise<AssetFolder>;
  /** Reads and verifies retained bytes even when the asset is in trash. */
  resolveVersion(ref: AssetVersionRef): Promise<AssetVersionPin>;
  pinManifest(refs: readonly AssetVersionRef[]): Promise<AssetPinManifest>;
}

export interface AssetSeed {
  readonly records: readonly AssetRecord[];
  /** Optional fixture/provider byte payloads keyed by record id. */
  readonly bytes?: Readonly<Record<string, AssetByteSource>>;
}

export type AssetRecoveryReason = "invalid" | "future-schema";

export interface AssetRecoveryOutcome {
  kind: "quarantined";
  reason: AssetRecoveryReason;
  sourcePreserved: true;
  affectedRecordIds: readonly string[];
  foundSchemaVersion?: number;
  message: string;
}

export type AssetInitializationOutcome =
  | { status: "ready"; summaries: readonly AssetSummary[] }
  | { status: "recovery-required"; summaries: readonly AssetSummary[]; recovery: AssetRecoveryOutcome }
  | { status: "error"; error: AssetPersistenceError };

export interface AssetProvider {
  /** Optional realm-local display URL for embedded previews; records keep canonical URLs. */
  previewUrl?(versionUrl: string): string;
  readonly descriptor: AssetProviderDescriptor;
  readonly store: AssetStore;
  readonly initialization: {
    initialize(): Promise<AssetInitializationOutcome>;
    retry(): Promise<AssetInitializationOutcome>;
    startFresh(): Promise<AssetInitializationOutcome>;
  };
}

/** Re-exporting this alias keeps consumers from importing model internals. */
export type { AssetBytesMissingReason };
