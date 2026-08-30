import { fileProviderConfig } from "virtual:composer-file-provider-config";
import {
  MEDIA_PROVIDERS,
  MediaPersistenceError,
  type MediaInitializationOutcome,
  type MediaLoadOutcome,
  type MediaPersistenceErrorCode,
  type MediaPersistenceOperation,
  type MediaRecord,
  type MediaSummary,
} from "../../library";
import { loadMediaRecord } from "../../model";
import type { MediaFileProvider, MediaFileProviderConfig, MediaFileProviderStore } from "./types";

type WireOperation = "initialize" | "list" | "get" | "upload" | "delete" | "clear";
type ProtocolResponse<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string; operation?: string } };

function operationFor(value: WireOperation): MediaPersistenceOperation { return value === "upload" ? "put" : value; }
function normalizeErrorCode(value: string): MediaPersistenceErrorCode {
  if (value === "body-too-large") return "validation";
  return ["unavailable", "blocked", "unsupported-version", "validation", "not-found", "bytes-missing", "read-failed", "write-failed", "transaction-failed"].includes(value)
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
  constructor(private readonly config: MediaFileProviderConfig, private readonly fetchImpl: typeof fetch) {}
  list() { return this.request<readonly MediaSummary[]>("list"); }
  async get(id: string): Promise<MediaLoadOutcome> {
    const result = await this.request<MediaLoadOutcome>("get", id);
    if (result.status !== "loaded") return result;
    const decoded = loadMediaRecord(result.record);
    if (decoded.status !== "loaded" || decoded.record.id !== id) return decoded.status === "loaded" ? { status: "invalid", issue: { code: "invalid-record", message: "Media record id does not match the request." }, raw: result.record } : decoded;
    return decoded;
  }
  put(): Promise<void> { return Promise.reject(persistenceError("put", "blocked", "The development media provider accepts new files through upload().")); }
  delete(id: string) { return this.request<boolean>("delete", id); }
  async clear() { await this.request<null>("clear"); }
  upload(file: Blob & { name: string }) {
    if (file.size > this.config.mediaMaxBodyBytes) return Promise.reject(persistenceError("put", "validation", `Upload exceeds the ${this.config.mediaMaxBodyBytes}-byte limit. Choose a smaller file.`));
    return this.request<MediaRecord>("upload", undefined, file, file.type || "application/octet-stream", file.name).then((record) => {
      const decoded = loadMediaRecord(record);
      if (decoded.status !== "loaded") throw persistenceError("put", "validation", "The development media provider returned an invalid uploaded record.");
      return decoded.record;
    });
  }
  private async request<T>(operation: WireOperation, id?: string, body: BodyInit = "", contentType = "application/json", fileName?: string): Promise<T> {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "content-type": contentType,
        [this.config.capabilityHeader]: this.config.capability,
        [this.config.mediaOperationHeader]: operation,
      };
      if (id !== undefined) headers[this.config.mediaRecordIdHeader] = id;
      if (fileName !== undefined) headers[this.config.mediaFileNameHeader] = encodeURIComponent(fileName);
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
    try { return { status: "ready", summaries: await store.list() }; }
    catch (error) { return { status: "error", error: error instanceof MediaPersistenceError ? error : persistenceError("initialize", "unknown", "Media storage initialization failed.", error) }; }
  };
  return { descriptor: MEDIA_PROVIDERS.files, store, initialization: { initialize, retry: initialize, startFresh: async () => { await store.clear(); return initialize(); } } };
}
