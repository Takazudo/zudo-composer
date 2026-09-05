import { fileProviderConfig } from "virtual:composer-file-provider-config";
import {
  MEDIA_PROVIDERS,
  MEDIA_VERSIONED_CAPABILITIES,
  MediaPersistenceError,
  type MediaInitializationOutcome,
  type MediaLoadOutcome,
  type MediaPersistenceErrorCode,
  type MediaPersistenceOperation,
  type MediaRecord,
  type MediaSummary,
  type MediaMutationPrecondition, type MediaMetadataPatch, type MediaFolderPatch, type MediaListOptions,
} from "../../library";
import { loadMediaRecord, validateMediaSnapshot, validateMediaFolder, type MediaSnapshot, type MediaFolder, type MediaVersionRef, type MediaVersionPin, type MediaPinManifest } from "../../model";
import type { MediaFileProvider, MediaFileProviderConfig, MediaFileProviderStore } from "./types";

type WireOperation = "initialize" | "list" | "get" | "upload" | "delete" | "clear" | "snapshot" | "replace" | "metadata" | "trash" | "restore" | "create-folder" | "update-folder" | "trash-folder" | "restore-folder" | "resolve-version" | "pin-manifest";
type ProtocolResponse<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string; operation?: string } };

function operationFor(value: WireOperation): MediaPersistenceOperation {
  if (value.endsWith("folder")) return "folder";
  if (value === "resolve-version" || value === "pin-manifest") return "pin";
  return value === "upload" ? "put" : value as MediaPersistenceOperation;
}
function normalizeErrorCode(value: string): MediaPersistenceErrorCode {
  if (value === "body-too-large") return "validation";
  return ["unavailable", "blocked", "unsupported-version", "validation", "not-found", "bytes-missing", "read-failed", "write-failed", "transaction-failed", "conflict", "recovery-required"].includes(value)
    ? value as MediaPersistenceErrorCode
    : "unknown";
}
function retryable(code: MediaPersistenceErrorCode): boolean {
  return ["unavailable", "read-failed", "write-failed", "transaction-failed", "unknown"].includes(code);
}
function persistenceError(operation: MediaPersistenceOperation, code: MediaPersistenceErrorCode, message: string, cause?: unknown) {
  return new MediaPersistenceError(operation, code, message, retryable(code), cause === undefined ? undefined : { cause });
}
function isProtocolResponse<T>(value: unknown): value is ProtocolResponse<T> {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === true) return "result" in value;
  if (value.ok !== false || !("error" in value)) return false;
  const error = value.error;
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && "message" in error && typeof error.message === "string";
}

class BrowserFileProviderMediaStore implements MediaFileProviderStore {
  readonly provider = MEDIA_PROVIDERS.files;
  readonly capabilities = MEDIA_VERSIONED_CAPABILITIES;
  constructor(private readonly config: MediaFileProviderConfig, private readonly fetchImpl: typeof fetch) {}
  initialize() { return this.request<MediaInitializationOutcome>("initialize"); }
  list(options: MediaListOptions = {}) { return this.json<readonly MediaSummary[]>("list", options); }
  async snapshot(): Promise<MediaSnapshot> {
    const value = await this.request<MediaSnapshot>("snapshot");
    if (!validateMediaSnapshot(value)) throw persistenceError("snapshot", "validation", "Media snapshot is invalid.");
    return value;
  }
  async mutationToken() { return (await this.snapshot()).mutationToken; }
  updateMetadata(id: string, patch: MediaMetadataPatch, precondition: MediaMutationPrecondition) { return this.json<MediaRecord>("metadata", { patch, precondition }, id); }
  trash(id: string, precondition: MediaMutationPrecondition) { return this.json<MediaRecord>("trash", { precondition }, id); }
  restore(id: string, precondition: MediaMutationPrecondition) { return this.json<MediaRecord>("restore", { precondition }, id); }
  createFolder(input: { name: string; parentId: string | null }, expectedMutationToken: string) { return this.json<MediaFolder>("create-folder", { input, expectedMutationToken }); }
  updateFolder(id: string, patch: MediaFolderPatch, precondition: MediaMutationPrecondition) { return this.json<MediaFolder>("update-folder", { patch, precondition }, id); }
  trashFolder(id: string, precondition: MediaMutationPrecondition) { return this.json<MediaFolder>("trash-folder", { precondition }, id); }
  restoreFolder(id: string, precondition: MediaMutationPrecondition) { return this.json<MediaFolder>("restore-folder", { precondition }, id); }
  resolveVersion(ref: MediaVersionRef) { return this.json<MediaVersionPin>("resolve-version", { ref }); }
  pinManifest(refs: readonly MediaVersionRef[]) { return this.json<MediaPinManifest>("pin-manifest", { refs }); }
  private json<T>(operation: WireOperation, value: unknown, id?: string): Promise<T> { return this.request(operation, id, JSON.stringify(value)); }
  async get(id: string): Promise<MediaLoadOutcome> {
    const result = await this.request<MediaLoadOutcome>("get", id);
    if (result.status !== "loaded") return result;
    const decoded = loadMediaRecord(result.record);
    if (decoded.status !== "loaded" || decoded.record.id !== id) return decoded.status === "loaded" ? { status: "invalid", issue: { code: "invalid-record", message: "Media record id does not match the request." }, raw: result.record } : decoded;
    return decoded;
  }
  put(): Promise<void> { return Promise.reject(persistenceError("put", "blocked", "The development media provider accepts new files through upload().")); }
  delete(id: string, precondition?: MediaMutationPrecondition) { return this.json<boolean>("delete", { precondition }, id); }
  clear(): Promise<void> { return Promise.reject(persistenceError("clear", "blocked", "Permanent purge and automatic reset are unavailable. Retained Media versions require explicit recovery.")); }
  upload(file: Blob & { name: string }, options: { folderId?: string | null; note?: string; expectedMutationToken?: string } = {}) {
    if (file.size > this.config.mediaMaxBodyBytes) return Promise.reject(persistenceError("put", "validation", `Upload exceeds the ${this.config.mediaMaxBodyBytes}-byte limit. Choose a smaller file.`));
    return this.request<MediaRecord>("upload", undefined, file, file.type || "application/octet-stream", file.name, options).then((record) => {
      const decoded = loadMediaRecord(record);
      if (decoded.status !== "loaded") throw persistenceError("put", "validation", "The development media provider returned an invalid uploaded record.");
      return decoded.record;
    });
  }
  replace(id: string, file: Blob, precondition: MediaMutationPrecondition): Promise<MediaRecord> {
    if (file.size > this.config.mediaMaxBodyBytes) return Promise.reject(persistenceError("replace", "validation", "Replacement exceeds the 25 MiB limit."));
    return this.request<MediaRecord>("replace", id, file, file.type || "application/octet-stream", undefined, { precondition });
  }
  private async request<T>(operation: WireOperation, id?: string, body: BodyInit = "", contentType = "application/json", fileName?: string, metadata?: unknown): Promise<T> {
    let response: Response;
    const encodedMetadata = metadata === undefined ? undefined : encodeURIComponent(JSON.stringify(metadata));
    if (encodedMetadata !== undefined && encodedMetadata.length > 8192) throw persistenceError(operationFor(operation), "validation", "Upload metadata header exceeds 8 KiB. Add a longer note with updateMetadata after uploading.");
    try {
      const headers: Record<string, string> = {
        "content-type": contentType,
        [this.config.capabilityHeader]: this.config.capability,
        [this.config.mediaOperationHeader]: operation,
      };
      if (id !== undefined) headers[this.config.mediaRecordIdHeader] = id;
      if (fileName !== undefined) headers[this.config.mediaFileNameHeader] = encodeURIComponent(fileName);
      if (encodedMetadata !== undefined) headers[this.config.mediaMetadataHeader] = encodedMetadata;
      response = await this.fetchImpl(this.config.mediaEndpoint, { method: "POST", headers, body, cache: "no-store", credentials: "same-origin" });
    } catch (cause) {
      throw persistenceError(operationFor(operation), "unavailable", "The development media provider is unavailable. Confirm `pnpm dev` is running and retry.", cause);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch (cause) { throw persistenceError(operationFor(operation), "unknown", "The development media provider returned malformed JSON.", cause); }
    if (!isProtocolResponse<T>(payload)) throw persistenceError(operationFor(operation), "unknown", "The development media provider returned an invalid response.");
    if (!payload.ok) {
      const code = normalizeErrorCode(payload.error.code);
      throw persistenceError(operationFor(operation), code, payload.error.message);
    }
    if (!response.ok) throw persistenceError(operationFor(operation), "unknown", "The Media provider returned an unsuccessful HTTP status with a success envelope.");
    if (["replace", "metadata", "trash", "restore"].includes(operation)) {
      const result = loadMediaRecord(payload.result);
      if (result.status !== "loaded" || result.record.id !== id) throw persistenceError(operationFor(operation), "validation", "Media mutation returned an invalid record.");
    }
    if (operation.endsWith("folder") && (!validateMediaFolder(payload.result) || (id !== undefined && payload.result.id !== id))) throw persistenceError("folder", "validation", "Media mutation returned an invalid folder.");
    return payload.result;
  }
}

export interface CreateFileProviderMediaStoreOptions { fetch?: typeof fetch }
export function createFileProviderMediaStore(options: CreateFileProviderMediaStoreOptions = {}): MediaFileProviderStore | undefined {
  if (fileProviderConfig === undefined) return undefined;
  const config = fileProviderConfig as MediaFileProviderConfig;
  if (typeof config.mediaEndpoint !== "string") return undefined;
  return new BrowserFileProviderMediaStore(config, options.fetch ?? globalThis.fetch.bind(globalThis));
}

export function createFileProviderMediaProvider(options: CreateFileProviderMediaStoreOptions = {}): MediaFileProvider | undefined {
  const store = createFileProviderMediaStore(options);
  if (store === undefined) return undefined;
  const initialize = async (): Promise<MediaInitializationOutcome> => {
    try { return await store.initialize(); }
    catch (error) { return { status: "error", error: error instanceof MediaPersistenceError ? error : persistenceError("initialize", "unknown", "Media storage initialization failed.", error) }; }
  };
  return { descriptor: MEDIA_PROVIDERS.files, store, initialization: { initialize, retry: initialize,
    startFresh: async () => ({ status: "error", error: persistenceError("clear", "blocked", "Automatic reset is unavailable. Media source and all versions are preserved for recovery.") }),
  } };
}
