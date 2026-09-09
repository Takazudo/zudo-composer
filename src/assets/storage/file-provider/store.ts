import { fileProviderConfig } from "virtual:composer-file-provider-config";
import { notifyPersistenceChange } from "../../../shared/persistence-generation";
import {
  ASSET_PROVIDERS,
  ASSET_VERSIONED_CAPABILITIES,
  AssetPersistenceError,
  type AssetInitializationOutcome,
  type AssetLoadOutcome,
  type AssetPersistenceErrorCode,
  type AssetPersistenceOperation,
  type AssetRecord,
  type AssetSummary,
  type AssetMutationPrecondition, type AssetMetadataPatch, type AssetFolderPatch, type AssetListOptions,
} from "../../library";
import { loadAssetRecord, validateAssetSnapshot, validateAssetFolder, validateAssetVersionRef, validateAssetVersionPin, validateAssetPinManifest, type AssetSnapshot, type AssetFolder, type AssetVersionRef, type AssetVersionPin, type AssetPinManifest } from "../../model";
import type { AssetFileProvider, AssetFileProviderConfig, AssetFileProviderStore } from "./types";

type WireOperation = "initialize" | "list" | "get" | "upload" | "delete" | "clear" | "snapshot" | "replace" | "metadata" | "trash" | "restore" | "create-folder" | "update-folder" | "trash-folder" | "restore-folder" | "resolve-version" | "pin-manifest";
type ProtocolResponse<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string; operation?: string } };

function operationFor(value: WireOperation): AssetPersistenceOperation {
  if (value.endsWith("folder")) return "folder";
  if (value === "resolve-version" || value === "pin-manifest") return "pin";
  return value === "upload" ? "put" : value as AssetPersistenceOperation;
}
function normalizeErrorCode(value: string): AssetPersistenceErrorCode {
  if (value === "body-too-large") return "validation";
  return ["unavailable", "blocked", "unsupported-version", "validation", "not-found", "bytes-missing", "read-failed", "write-failed", "transaction-failed", "conflict", "recovery-required", "commit-uncertain"].includes(value)
    ? value as AssetPersistenceErrorCode
    : "unknown";
}
function retryable(code: AssetPersistenceErrorCode): boolean {
  return ["unavailable", "read-failed", "write-failed", "transaction-failed", "unknown"].includes(code);
}
function persistenceError(operation: AssetPersistenceOperation, code: AssetPersistenceErrorCode, message: string, cause?: unknown) {
  return new AssetPersistenceError(operation, code, message, retryable(code), cause === undefined ? undefined : { cause });
}
function isProtocolResponse<T>(value: unknown): value is ProtocolResponse<T> {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  if (value.ok === true) return "result" in value;
  if (value.ok !== false || !("error" in value)) return false;
  const error = value.error;
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && "message" in error && typeof error.message === "string";
}

class BrowserFileProviderAssetStore implements AssetFileProviderStore {
  readonly provider = ASSET_PROVIDERS.files;
  readonly capabilities = ASSET_VERSIONED_CAPABILITIES;
  constructor(private readonly config: AssetFileProviderConfig, private readonly fetchImpl: typeof fetch) {}
  initialize() { return this.request<AssetInitializationOutcome>("initialize"); }
  list(options: AssetListOptions = {}) { return this.json<readonly AssetSummary[]>("list", options); }
  async snapshot(): Promise<AssetSnapshot> {
    const value = await this.request<AssetSnapshot>("snapshot");
    if (!validateAssetSnapshot(value)) throw persistenceError("snapshot", "validation", "Assets snapshot is invalid.");
    return value;
  }
  async mutationToken() { return (await this.snapshot()).mutationToken; }
  updateMetadata(id: string, patch: AssetMetadataPatch, precondition: AssetMutationPrecondition) { return this.json<AssetRecord>("metadata", { patch, precondition }, id); }
  trash(id: string, precondition: AssetMutationPrecondition) { return this.json<AssetRecord>("trash", { precondition }, id); }
  restore(id: string, precondition: AssetMutationPrecondition) { return this.json<AssetRecord>("restore", { precondition }, id); }
  createFolder(input: { name: string; parentId: string | null; index?: number }, expectedMutationToken: string) { return this.json<AssetFolder>("create-folder", { input, expectedMutationToken }); }
  updateFolder(id: string, patch: AssetFolderPatch, precondition: AssetMutationPrecondition) { return this.json<AssetFolder>("update-folder", { patch, precondition }, id); }
  trashFolder(id: string, precondition: AssetMutationPrecondition) { return this.json<AssetFolder>("trash-folder", { precondition }, id); }
  restoreFolder(id: string, precondition: AssetMutationPrecondition) { return this.json<AssetFolder>("restore-folder", { precondition }, id); }
  async resolveVersion(ref: AssetVersionRef): Promise<AssetVersionPin> {
    if (!validateAssetVersionRef(ref) || ref.providerId !== this.provider.id) throw persistenceError("pin", "validation", "An exact version reference for this Assets provider is required.");
    ref = structuredClone(ref);
    const pin = await this.json<unknown>("resolve-version", { ref });
    if (!validateAssetVersionPin(pin, ref)) throw persistenceError("pin", "validation", "Assets pin does not match the exact requested version.");
    return pin;
  }
  async pinManifest(refs: readonly AssetVersionRef[]): Promise<AssetPinManifest> {
    if (!Array.isArray(refs) || !refs.every((ref) => validateAssetVersionRef(ref) && ref.providerId === this.provider.id)) throw persistenceError("pin", "validation", "Exact version references for this Assets provider are required.");
    refs = structuredClone(refs);
    const manifest = await this.json<unknown>("pin-manifest", { refs });
    if (!validateAssetPinManifest(manifest, refs)) throw persistenceError("pin", "validation", "Assets pin manifest is malformed, incomplete, duplicated or unsorted.");
    return manifest;
  }
  private json<T>(operation: WireOperation, value: unknown, id?: string): Promise<T> { return this.request(operation, id, JSON.stringify(value)); }
  async get(id: string): Promise<AssetLoadOutcome> {
    const result = await this.request<AssetLoadOutcome>("get", id);
    if (result.status !== "loaded") return result;
    const decoded = loadAssetRecord(result.record);
    if (decoded.status !== "loaded" || decoded.record.id !== id) return decoded.status === "loaded" ? { status: "invalid", issue: { code: "invalid-record", message: "Assets record id does not match the request." }, raw: result.record } : decoded;
    return decoded;
  }
  put(): Promise<void> { return Promise.reject(persistenceError("put", "blocked", "The development assets provider accepts new files through upload().")); }
  delete(id: string, precondition?: AssetMutationPrecondition) { return this.json<boolean>("delete", { precondition }, id); }
  clear(): Promise<void> { return Promise.reject(persistenceError("clear", "blocked", "Permanent purge and automatic reset are unavailable. Retained Assets versions require explicit recovery.")); }
  upload(file: Blob & { name: string }, options: { folderId?: string | null; note?: string; expectedMutationToken?: string } = {}) {
    if (file.size > this.config.assetMaxBodyBytes) return Promise.reject(persistenceError("put", "validation", `Upload exceeds the ${this.config.assetMaxBodyBytes}-byte limit. Choose a smaller file.`));
    return this.request<AssetRecord>("upload", undefined, file, file.type || "application/octet-stream", file.name, options).then((record) => {
      const decoded = loadAssetRecord(record);
      if (decoded.status !== "loaded") throw persistenceError("put", "validation", "The development assets provider returned an invalid uploaded record.");
      return decoded.record;
    });
  }
  replace(id: string, file: Blob, precondition: AssetMutationPrecondition): Promise<AssetRecord> {
    if (file.size > this.config.assetMaxBodyBytes) return Promise.reject(persistenceError("replace", "validation", "Replacement exceeds the 25 MiB limit."));
    return this.request<AssetRecord>("replace", id, file, file.type || "application/octet-stream", undefined, { precondition });
  }
  private async request<T>(operation: WireOperation, id?: string, body: BodyInit = "", contentType = "application/json", fileName?: string, metadata?: unknown): Promise<T> {
    let response: Response;
    const encodedMetadata = metadata === undefined ? undefined : encodeURIComponent(JSON.stringify(metadata));
    if (encodedMetadata !== undefined && encodedMetadata.length > 8192) throw persistenceError(operationFor(operation), "validation", "Upload metadata header exceeds 8 KiB. Add a longer note with updateMetadata after uploading.");
    try {
      const headers: Record<string, string> = {
        "content-type": contentType,
        [this.config.capabilityHeader]: this.config.capability,
        [this.config.assetOperationHeader]: operation,
      };
      if (id !== undefined) headers[this.config.assetRecordIdHeader] = id;
      if (fileName !== undefined) headers[this.config.assetFileNameHeader] = encodeURIComponent(fileName);
      if (encodedMetadata !== undefined) headers[this.config.assetMetadataHeader] = encodedMetadata;
      response = await this.fetchImpl(this.config.assetEndpoint, { method: "POST", headers, body, cache: "no-store", credentials: "same-origin" });
    } catch (cause) {
      throw persistenceError(operationFor(operation), "unavailable", "The development assets provider is unavailable. Confirm `pnpm dev` is running and retry.", cause);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch (cause) { throw persistenceError(operationFor(operation), "unknown", "The development assets provider returned malformed JSON.", cause); }
    if (!isProtocolResponse<T>(payload)) throw persistenceError(operationFor(operation), "unknown", "The development assets provider returned an invalid response.");
    if (!payload.ok) {
      const code = normalizeErrorCode(payload.error.code);
      throw persistenceError(operationFor(operation), code, payload.error.message);
    }
    if (!response.ok) throw persistenceError(operationFor(operation), "unknown", "The Assets provider returned an unsuccessful HTTP status with a success envelope.");
    if (["replace", "metadata", "trash", "restore"].includes(operation)) {
      const result = loadAssetRecord(payload.result);
      if (result.status !== "loaded" || result.record.id !== id) throw persistenceError(operationFor(operation), "validation", "Assets mutation returned an invalid record.");
    }
    if (operation.endsWith("folder") && (!validateAssetFolder(payload.result) || (id !== undefined && payload.result.id !== id))) throw persistenceError("folder", "validation", "Assets mutation returned an invalid folder.");
    if ((operation === "delete" && payload.result === true) || ["upload", "replace", "metadata", "trash", "restore", "create-folder", "update-folder", "trash-folder", "restore-folder"].includes(operation)) notifyPersistenceChange("assets");
    return payload.result;
  }
}

export interface CreateFileProviderAssetStoreOptions { fetch?: typeof fetch }
export function createFileProviderAssetStore(options: CreateFileProviderAssetStoreOptions = {}): AssetFileProviderStore | undefined {
  if (fileProviderConfig === undefined) return undefined;
  const config = fileProviderConfig as AssetFileProviderConfig;
  if (typeof config.assetEndpoint !== "string") return undefined;
  return new BrowserFileProviderAssetStore(config, options.fetch ?? globalThis.fetch.bind(globalThis));
}

export function createFileProviderAssetProvider(options: CreateFileProviderAssetStoreOptions = {}): AssetFileProvider | undefined {
  const store = createFileProviderAssetStore(options);
  if (store === undefined) return undefined;
  const initialize = async (): Promise<AssetInitializationOutcome> => {
    try { return await store.initialize(); }
    catch (error) { return { status: "error", error: error instanceof AssetPersistenceError ? error : persistenceError("initialize", "unknown", "Assets storage initialization failed.", error) }; }
  };
  return { descriptor: ASSET_PROVIDERS.files, store, initialization: { initialize, retry: initialize,
    startFresh: async () => ({ status: "error", error: persistenceError("clear", "blocked", "Automatic reset is unavailable. Assets source and all versions are preserved for recovery.") }),
  } };
}
