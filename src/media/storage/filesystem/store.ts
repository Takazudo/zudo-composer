import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link } from "node:fs/promises";
import { MediaPersistenceError, compareMediaSummariesNewestFirst, createMediaRecord, currentMediaVersion,
  summarizeMedia, MEDIA_VERSIONED_CAPABILITIES,
  type MediaPersistenceErrorCode, type MediaPersistenceOperation, type MediaByteSource, type MediaRecord,
  type MediaInitializationOutcome, type MediaLoadOutcome, type MediaSummary, type VersionedMediaStore,
  type MediaMutationPrecondition, type MediaMetadataPatch, type MediaFolderPatch, type MediaListOptions,
} from "../../library";
import { MEDIA_MAX_BYTE_LENGTH, MEDIA_SCHEMA_VERSION, isValidMediaFileName, isMediaRevision,
  validateMediaRecord, validateMediaSnapshot, mediaVersionUrl, isValidMediaChecksum,
  type MediaSnapshot, type MediaFolder, type MediaVersionRef, type MediaVersionPin, type MediaPinManifest,
} from "../../model";
import { isSafeRecordId, isPlainObject } from "../../../shared";
import { createUuidIdFactory } from "../../../shared/id-factory";
import { SafeRootFilesystem, streamingAtomicReplace, type StreamingAtomicWriteResult } from "../../../shared/node-fs";
import type { FilesystemMediaStoreOptions, MediaUploadInput, SniffedMedia, MediaReplaceInput } from "./types";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const BYTES_DIRECTORY = "versions";
const EMPTY_TOKEN = "0".repeat(64);

class MediaCatalogRecoveryError extends MediaPersistenceError {
  constructor(readonly foundSchemaVersion?: number) {
    super("snapshot", "recovery-required", "Media catalog is malformed or uses an unsupported schema. Source and all bytes are preserved; inspect catalog.json. Automatic reset is unavailable.", false);
  }
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function operationError(
  operation: MediaPersistenceOperation,
  code: MediaPersistenceErrorCode,
  message: string,
  cause?: unknown,
): MediaPersistenceError {
  return new MediaPersistenceError(
    operation,
    code,
    message,
    code === "read-failed" || code === "write-failed",
    cause === undefined ? undefined : { cause },
  );
}

function rethrow(
  operation: MediaPersistenceOperation,
  code: "read-failed" | "write-failed",
  message: string,
  cause: unknown,
): never {
  if (cause instanceof MediaPersistenceError) throw cause;
  throw operationError(operation, code, message, cause);
}

function asAsyncBytes(source: MediaByteSource): AsyncIterable<Uint8Array> {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return (async function* () { yield Uint8Array.from(bytes); })();
  }
  if (source instanceof ArrayBuffer) return (async function* () { yield new Uint8Array(source.slice(0)); })();
  if (typeof ReadableStream !== "undefined" && source instanceof ReadableStream) {
    return (async function* () {
      const reader = source.getReader();
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) return;
          yield item.value;
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }
  return source;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function sniffMedia(bytes: Uint8Array): SniffedMedia | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mediaType: "image/png", extension: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", extension: "jpg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return { mediaType: "image/gif", extension: "gif" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return { mediaType: "image/webp", extension: "webp" };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mediaType: "application/pdf", extension: "pdf" };
  return undefined;
}

async function nextWithAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal | undefined): Promise<IteratorResult<T>> {
  signal?.throwIfAborted();
  if (signal === undefined) return iterator.next();
  let rejectAbort!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function peekBytes(source: MediaByteSource, signal?: AbortSignal): Promise<{
  head: Uint8Array;
  stream: AsyncIterable<Uint8Array>;
  cancel(): Promise<void>;
}> {
  const iterator = asAsyncBytes(source)[Symbol.asyncIterator]();
  const buffered: Uint8Array[] = [];
  let length = 0;
  let done = false;
  try {
    while (length < 12) {
      const item = await nextWithAbort(iterator, signal);
      if (item.done) {
        done = true;
        break;
      }
      const bytes = Uint8Array.from(item.value);
      buffered.push(bytes);
      length += bytes.byteLength;
    }
  } catch (cause) {
    void iterator.return?.().catch(() => undefined);
    throw cause;
  }
  const head = new Uint8Array(length);
  let offset = 0;
  for (const bytes of buffered) {
    head.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return {
    head,
    cancel: async () => { await iterator.return?.(); },
    stream: (async function* () {
      for (const bytes of buffered) yield bytes;
      if (done) return;
      try {
        while (true) {
          const item = await nextWithAbort(iterator, signal);
          if (item.done) return;
          yield item.value;
        }
      } finally {
        await iterator.return?.();
      }
    })(),
  };
}


interface GuardedDirectory { path: string; realPath: string; stats: Stats }

export class FilesystemMediaStore implements VersionedMediaStore {
  readonly provider = { id: "media-files", label: "Project files" } as const;
  readonly capabilities = MEDIA_VERSIONED_CAPABILITIES;
  private constructor(
    private readonly filesystem: SafeRootFilesystem<MediaPersistenceOperation>,
    private readonly publicDirectory: GuardedDirectory,
    private readonly bytesDirectory: GuardedDirectory,
    private readonly idFactory: (hint?: string) => string,
    private readonly now: () => string,
    private readonly publishVersion: typeof link,
  ) {}

  static async create(options: FilesystemMediaStoreOptions): Promise<FilesystemMediaStore> {
    const filesystem = await SafeRootFilesystem.create({
      root: options.mediaStoreRoot,
      operations: options.operations,
      randomToken: options.randomToken,
      errors: {
        isError: (value): value is MediaPersistenceError => value instanceof MediaPersistenceError,
        create: operationError,
        rethrow,
      },
      rootLabel: "Media store root",
      ownerLabel: "Media",
      recordLabel: "media record",
      initializeOperation: "initialize",
    });
    const prepareDirectory = async (relativePath: string): Promise<GuardedDirectory> => {
      const path = filesystem.ownedPath(relativePath);
      await filesystem.operations.mkdir(path, { recursive: true });
      const stats = await filesystem.operations.lstat(path);
      const realPath = await filesystem.operations.realpath(path);
      if (stats.isSymbolicLink() || !stats.isDirectory() || realPath !== path) {
        throw operationError("initialize", "blocked", `Media directory is not a real owned directory: ${relativePath}`);
      }
      const realStats = await filesystem.operations.lstat(realPath);
      if (!sameFile(stats, realStats)) throw operationError("initialize", "blocked", `Media directory failed realpath verification: ${relativePath}`);
      return { path, realPath, stats };
    };
    try {
      const publicDirectory = await prepareDirectory("public");
      const bytesDirectory = await prepareDirectory(BYTES_DIRECTORY);
      return new FilesystemMediaStore(
        filesystem,
        publicDirectory,
        bytesDirectory,
        options.idFactory ?? createUuidIdFactory(),
        options.now ?? (() => new Date().toISOString()),
        options.operations?.link ?? link,
      );
    } catch (cause) {
      rethrow("initialize", "read-failed", "Could not initialize Media storage directories.", cause);
    }
  }


  async initialize(): Promise<MediaInitializationOutcome> {
    try { return { status: "ready", summaries: await this.list() }; }
    catch (cause) {
      if (cause instanceof MediaPersistenceError && cause.code === "recovery-required") {
        const foundSchemaVersion = cause instanceof MediaCatalogRecoveryError ? cause.foundSchemaVersion : undefined;
        return { status: "recovery-required", summaries: [], recovery: {
          kind: "quarantined", reason: foundSchemaVersion === undefined ? "invalid" : "future-schema", sourcePreserved: true,
          affectedRecordIds: [], message: cause.message, ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }),
        } };
      }
      throw cause;
    }
  }
  snapshot(): Promise<MediaSnapshot> { return this.filesystem.run("snapshot", () => this.readCatalog()); }
  async mutationToken(): Promise<string> { return (await this.snapshot()).mutationToken; }
  async list(options: MediaListOptions = {}): Promise<readonly MediaSummary[]> {
    if (!isPlainObject(options) || Object.keys(options).some((key) => !["state", "folderId"].includes(key))
      || (options.state !== undefined && (typeof options.state !== "string" || !["active", "trash", "all"].includes(options.state)))
      || (options.folderId !== undefined && options.folderId !== null && !isSafeRecordId(options.folderId))) throw operationError("list", "validation", "Invalid Media list options.");
    options = { ...options };
    return (await this.snapshot()).records.filter(({ document }) =>
      (options.state === "all" || document.state === (options.state ?? "active"))
      && (options.folderId === undefined || document.folderId === options.folderId))
      .map(summarizeMedia).sort(compareMediaSummariesNewestFirst);
  }
  async get(id: string): Promise<MediaLoadOutcome> {
    this.assertSafeId("get", id);
    const record = (await this.snapshot()).records.find((record) => record.id === id);
    if (!record) return { status: "not-found", id };
    const version = currentMediaVersion(record);
    const integrity = await this.verifyBytes("get", this.versionPath(version.url), version.byteLength, version.checksum);
    return integrity ? { status: "bytes-missing", record, reason: integrity } : { status: "loaded", record };
  }
  async upload(input: MediaUploadInput): Promise<MediaRecord> {
    input = { ...input };
    if (!isValidMediaFileName(input.fileName)) throw operationError("put", "validation", "Media filename must be bounded safe display metadata.");
    if (typeof input.declaredMediaType !== "string" || input.declaredMediaType.length === 0) throw operationError("put", "validation", "Declared MIME type is required.");
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 10000)) throw operationError("put", "validation", "Media note must be a string of at most 10,000 characters.");
    const staged = await this.stageBytes(input);
    try {
      return await this.mutate("put", input.expectedMutationToken, async (snapshot) => {
        input.signal?.throwIfAborted();
        const record = createMediaRecord({ fileName: input.fileName, folderId: input.folderId, note: input.note,
          mediaType: staged.sniffed.mediaType, ...staged.result }, { id: this.mintId(snapshot), timestamp: this.now() });
        snapshot.records.push(record);
        this.assertCatalog(snapshot);
        await this.commitBytes(staged, currentMediaVersion(record).url);
        input.signal?.throwIfAborted();
        return record;
      }, input.signal);
    } finally { await this.removeStage(staged.path); }
  }
  async replace(id: string, input: MediaReplaceInput, precondition: MediaMutationPrecondition): Promise<MediaRecord> {
    this.assertSafeId("replace", id);
    this.assertPrecondition(precondition);
    precondition = structuredClone(precondition);
    input = { ...input };
    this.requireRecord(await this.snapshot(), id, precondition);
    const staged = await this.stageBytes(input);
    try {
      return await this.mutate("replace", precondition.expectedMutationToken, async (snapshot) => {
        const record = this.requireRecord(snapshot, id, precondition);
        if (record.document.state !== "active") throw operationError("replace", "validation", "Restore the asset before replacing it.");
        input.signal?.throwIfAborted();
        const version = { id: staged.result.checksum, ...staged.result, mediaType: staged.sniffed.mediaType,
          url: mediaVersionUrl(staged.result.checksum, staged.sniffed.mediaType), createdAt: this.timestamp(record.updatedAt) };
        if (!record.document.versions.some(({ id }) => id === version.id)) record.document.versions.push(version);
        record.document.currentVersionId = version.id;
        this.bump(record);
        this.assertCatalog(snapshot);
        await this.commitBytes(staged, version.url);
        input.signal?.throwIfAborted();
        return record;
      }, input.signal);
    } finally { await this.removeStage(staged.path); }
  }
  /** Import is create-only, never a replacement bypass. */
  async put(record: MediaRecord, bytes: MediaByteSource): Promise<void> {
    const validation = validateMediaRecord(record);
    if (!validation.ok) throw operationError("put", "validation", validation.issue.message);
    const copy = structuredClone(record);
    if (copy.revision !== 1 || copy.document.versions.length !== 1 || copy.document.state !== "active")
      throw operationError("put", "validation", "Import accepts only a new single-version active asset.");
    const version = currentMediaVersion(copy);
    const staged = await this.stageBytes({ bytes }, { byteLength: version.byteLength, checksum: version.checksum }, version.mediaType);
    try {
      await this.mutate("put", undefined, async (snapshot) => {
        if (snapshot.records.some(({ id }) => id === copy.id)) throw operationError("put", "conflict", "Asset already exists; use replace with its revision.");
        snapshot.records.push(copy);
        this.assertCatalog(snapshot);
        await this.commitBytes(staged, version.url);
      });
    } finally { await this.removeStage(staged.path); }
  }
  updateMetadata(id: string, patch: MediaMetadataPatch, precondition: MediaMutationPrecondition): Promise<MediaRecord> {
    if (!patch || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !["fileName", "folderId", "note"].includes(key)))
      return Promise.reject(operationError("metadata", "validation", "Unsupported or empty metadata patch."));
    patch = structuredClone(patch);
    return this.editRecord("metadata", id, precondition, (record) => {
      if (record.document.state !== "active") throw operationError("metadata", "validation", "Restore the asset before editing it.");
      Object.assign(record.document, structuredClone(patch));
    });
  }
  trash(id: string, precondition: MediaMutationPrecondition): Promise<MediaRecord> {
    return this.editRecord("trash", id, precondition, (record) => { record.document.state = "trash"; });
  }
  restore(id: string, precondition: MediaMutationPrecondition): Promise<MediaRecord> {
    return this.editRecord("restore", id, precondition, (record) => { record.document.state = "active"; });
  }
  async delete(id: string, precondition?: MediaMutationPrecondition): Promise<boolean> {
    this.assertSafeId("delete", id);
    this.assertPrecondition(precondition);
    await this.trash(id, precondition);
    return true;
  }
  clear(): Promise<void> {
    return Promise.reject(operationError("clear", "blocked", "Permanent purge is unavailable. Trash individual assets with metadata preconditions."));
  }
  createFolder(input: { name: string; parentId: string | null; index?: number }, expectedMutationToken: string): Promise<MediaFolder> {
    if (!isPlainObject(input) || Object.keys(input).some((key) => !["name", "parentId", "index"].includes(key)) || !("name" in input) || !("parentId" in input)) return Promise.reject(operationError("folder", "validation", "Folder input requires name and parentId."));
    if (typeof expectedMutationToken !== "string") return Promise.reject(operationError("folder", "validation", "Folder creation requires a snapshot mutation token."));
    input = structuredClone(input);
    return this.mutate("folder", expectedMutationToken, async (snapshot) => {
      const timestamp = this.now();
      const folder: MediaFolder = { id: this.mintId(snapshot), name: input.name, parentId: input.parentId,
        state: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp };
      snapshot.folders.push(folder);
      if (input.index !== undefined) this.placeFolder(snapshot, folder, input.index);
      return folder;
    });
  }
  updateFolder(id: string, patch: MediaFolderPatch, precondition: MediaMutationPrecondition): Promise<MediaFolder> {
    if (!patch || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !["name", "parentId", "index"].includes(key)))
      return Promise.reject(operationError("folder", "validation", "Unsupported or empty folder patch."));
    patch = structuredClone(patch);
    if (patch.index !== undefined && precondition?.expectedMutationToken === undefined) return Promise.reject(operationError("folder", "validation", "Indexed folder moves require the snapshot token."));
    return this.editFolder(id, precondition, (folder, snapshot) => {
      if (folder.state !== "active") throw operationError("folder", "validation", "Restore the folder before editing it.");
      const { index, ...metadata } = patch;
      Object.assign(folder, metadata);
      if (index !== undefined) this.placeFolder(snapshot, folder, index);
    });
  }
  private placeFolder(snapshot: MediaSnapshot, folder: MediaFolder, index: number): void {
    const remaining = snapshot.folders.filter(({ id }) => id !== folder.id);
    const siblings = remaining.filter((item) => item.parentId === folder.parentId && item.state === "active");
    if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw operationError("folder", "validation", "Folder insertion index is outside the current sibling list.");
    const before = siblings[index];
    remaining.splice(before ? remaining.indexOf(before) : remaining.length, 0, folder);
    snapshot.folders = remaining;
  }
  trashFolder(id: string, precondition: MediaMutationPrecondition): Promise<MediaFolder> {
    return this.editFolder(id, precondition, (folder, snapshot) => {
      if (snapshot.folders.some((child) => child.parentId === id && child.state === "active")
        || snapshot.records.some(({ document }) => document.folderId === id && document.state === "active"))
        throw operationError("folder", "validation", "Move or trash active children before trashing a folder.");
      folder.state = "trash";
    });
  }
  restoreFolder(id: string, precondition: MediaMutationPrecondition): Promise<MediaFolder> {
    return this.editFolder(id, precondition, (folder) => { folder.state = "active"; });
  }
  async resolveVersion(ref: MediaVersionRef): Promise<MediaVersionPin> {
    ref = structuredClone(ref);
    return this.resolveFromSnapshot(await this.snapshot(), ref);
  }
  async pinManifest(refs: readonly MediaVersionRef[]): Promise<MediaPinManifest> {
    if (!Array.isArray(refs)) throw operationError("pin", "validation", "Media manifest requires an array of exact-version references.");
    refs = structuredClone(refs);
    const snapshot = await this.snapshot();
    const pins = new Map<string, MediaVersionPin>();
    for (const ref of refs) {
      const pin = await this.resolveFromSnapshot(snapshot, ref);
      pins.set(JSON.stringify([pin.providerId, pin.assetId, pin.versionId]), pin);
    }
    return { schemaVersion: 1, pins: [...pins.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, pin]) => pin) };
  }
  private async resolveFromSnapshot(snapshot: MediaSnapshot, ref: MediaVersionRef): Promise<MediaVersionPin> {
    if (!ref || ref.providerId !== this.provider.id || !isSafeRecordId(ref.assetId) || !/^[a-f0-9]{64}$/.test(ref.versionId)) throw operationError("pin", "validation", "Invalid provider-qualified Media version reference.");
    const record = snapshot.records.find(({ id }) => id === ref.assetId);
    const version = record?.document.versions.find(({ id }) => id === ref.versionId);
    if (!version) throw operationError("pin", "not-found", "Exact Media version is not retained.");
    const integrity = await this.verifyBytes("pin", this.versionPath(version.url), version.byteLength, version.checksum);
    if (integrity) throw operationError("pin", "bytes-missing", "Exact Media version bytes are missing or corrupted.");
    return { providerId: this.provider.id, assetId: record!.id, versionId: version.id, checksum: version.checksum,
      byteLength: version.byteLength, mediaType: version.mediaType, url: version.url };
  }
  private editRecord(operation: MediaPersistenceOperation, id: string, precondition: MediaMutationPrecondition, edit: (record: MediaRecord) => void): Promise<MediaRecord> {
    this.assertSafeId(operation, id);
    this.assertPrecondition(precondition);
    precondition = structuredClone(precondition);
    return this.mutate(operation, precondition.expectedMutationToken, async (snapshot) => {
      const record = this.requireRecord(snapshot, id, precondition);
      edit(record); this.bump(record); return record;
    });
  }
  private editFolder(id: string, precondition: MediaMutationPrecondition, edit: (folder: MediaFolder, snapshot: MediaSnapshot) => void): Promise<MediaFolder> {
    this.assertSafeId("folder", id);
    this.assertPrecondition(precondition);
    precondition = structuredClone(precondition);
    return this.mutate("folder", precondition.expectedMutationToken, async (snapshot) => {
      const folder = snapshot.folders.find((folder) => folder.id === id);
      if (!folder) throw operationError("folder", "not-found", "Media folder does not exist.");
      if (folder.revision !== precondition.expectedRevision) throw operationError("folder", "conflict", "Media folder changed; reload before retrying.");
      edit(folder, snapshot); this.bump(folder); return folder;
    });
  }
  private assertPrecondition(value: MediaMutationPrecondition | undefined): asserts value is MediaMutationPrecondition {
    if (!isPlainObject(value) || !isMediaRevision(value.expectedRevision)
      || Object.keys(value).some((key) => !["expectedRevision", "expectedMutationToken"].includes(key))
      || (value.expectedMutationToken !== undefined && !isValidMediaChecksum(value.expectedMutationToken)))
      throw operationError("metadata", "validation", "An explicit expected metadata revision and valid optional snapshot token are required.");
  }
  private requireRecord(snapshot: MediaSnapshot, id: string, precondition: MediaMutationPrecondition): MediaRecord {
    const record = snapshot.records.find((record) => record.id === id);
    if (!record) throw operationError("metadata", "not-found", "Media asset does not exist.");
    if (record.revision !== precondition.expectedRevision || (precondition.expectedMutationToken !== undefined && precondition.expectedMutationToken !== snapshot.mutationToken))
      throw operationError("metadata", "conflict", "Media changed; reload before retrying.");
    return record;
  }
  private timestamp(previous: string): string { const now = this.now(); return now > previous ? now : previous; }
  private bump(value: { revision: number; updatedAt: string }): void { value.revision += 1; value.updatedAt = this.timestamp(value.updatedAt); }
  private mintId(snapshot: MediaSnapshot): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = this.idFactory("media");
      this.assertSafeId("put", id);
      if (!snapshot.records.some((record) => record.id === id) && !snapshot.folders.some((folder) => folder.id === id)) return id;
    }
    throw operationError("put", "write-failed", "Could not mint an unused Media id.");
  }
  private catalogPath(): string { return this.filesystem.ownedPath("catalog.json"); }
  private versionPath(url: string): string {
    if (!/^\/uploaded-media\/sha256-[a-f0-9]{64}\.(png|jpg|gif|webp|pdf)$/.test(url))
      throw operationError("get", "validation", "Invalid immutable Media URL.");
    return this.filesystem.ownedPath(BYTES_DIRECTORY + "/" + url.slice("/uploaded-media/".length));
  }
  private assertCatalog(snapshot: MediaSnapshot): void {
    if (!validateMediaSnapshot(snapshot)) throw operationError("metadata", "validation", "Invalid Media metadata graph: check names, revisions, versions, folder parents, cycles, collisions and trash state.");
  }
  private async readCatalog(): Promise<MediaSnapshot> {
    await this.assertDirectories("snapshot");
    const file = await this.filesystem.readFileNoFollow("snapshot", this.catalogPath());
    if (!file) return { schemaVersion: MEDIA_SCHEMA_VERSION, mutationToken: EMPTY_TOKEN, records: [], folders: [] };
    let raw: unknown;
    try { raw = JSON.parse(file.text); } catch { /* Preserved for manual recovery. */ }
    if (!validateMediaSnapshot(raw)) throw new MediaCatalogRecoveryError(isPlainObject(raw) && typeof raw.schemaVersion === "number" && raw.schemaVersion > MEDIA_SCHEMA_VERSION ? raw.schemaVersion : undefined);
    await this.assertDirectories("snapshot");
    return raw;
  }
  /** Kernel O_EXCL serializes cooperating writers across processes. Never steal
   * an existing lock: after a crash verify no writer is running before manual
   * .mutation.lock removal. Reads remain available during lock recovery. */
  private mutate<T>(operation: MediaPersistenceOperation, expectedToken: string | undefined, edit: (snapshot: MediaSnapshot) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (expectedToken !== undefined && !isValidMediaChecksum(expectedToken)) return Promise.reject(operationError(operation, "validation", "Expected Media snapshot token must be a valid token."));
    return this.filesystem.run(operation, async () => {
      await this.assertDirectories(operation);
      const lockPath = this.filesystem.ownedPath(".mutation.lock");
      let lock;
      try { lock = await this.filesystem.operations.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW, 0o600); }
      catch (cause) {
        if (errorCode(cause) === "EEXIST") throw operationError(operation, "conflict", "Another Media writer holds .mutation.lock. Retry after it finishes; after a crash verify no writer is running before manual lock recovery.");
        rethrow(operation, "write-failed", "Could not acquire Media mutation lock.", cause);
      }
      let lockStats: Stats | undefined;
      let uncertain = false;
      try {
        lockStats = await lock.stat();
        await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: this.now() }));
        await lock.sync();
        await this.syncDirectory(operation, this.filesystem.realRoot);
        await this.syncDirectory(operation, this.bytesDirectory.path);
        const snapshot = await this.readCatalog();
        signal?.throwIfAborted();
        if (expectedToken !== undefined && expectedToken !== snapshot.mutationToken) throw operationError(operation, "conflict", "Media snapshot changed; reload before retrying.");
        const result = await edit(snapshot);
        snapshot.mutationToken = randomBytes(32).toString("hex");
        this.assertCatalog(snapshot);
        await this.assertDirectories(operation);
        await this.commitCatalog(operation, snapshot, signal);
        return structuredClone(result);
      } catch (cause) {
        uncertain = cause instanceof MediaPersistenceError && cause.code === "commit-uncertain";
        rethrow(operation, "write-failed", "Could not commit Media mutation.", cause);
      }
      finally {
        await lock.close().catch(() => undefined);
        // Cleanup failure must not report a committed mutation as failed.
        try {
          await this.filesystem.assertRoot(operation);
          const current = await this.filesystem.operations.lstat(lockPath);
          if (!uncertain && lockStats && current.isFile() && !current.isSymbolicLink() && sameFile(current, lockStats)) await this.filesystem.operations.unlink(lockPath);
        } catch { /* Retained lock fails closed on next mutation. */ }
      }
    });
  }
  /** Post-rename durability failures are explicitly uncertain, never reported
   * as ordinary failed/unchanged mutations. The retained lock blocks retries. */
  private async commitCatalog(operation: MediaPersistenceOperation, snapshot: MediaSnapshot, signal?: AbortSignal): Promise<void> {
    const path = this.catalogPath();
    const temporary = await this.filesystem.openTemporaryFile(operation, path);
    let committed = false;
    try {
      await temporary.handle.writeFile(JSON.stringify(snapshot, null, 2) + "\n");
      await temporary.handle.sync();
      await temporary.handle.close();
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
      await this.filesystem.assertReplaceablePath(operation, path);
      signal?.throwIfAborted();
      await this.filesystem.operations.rename(temporary.path, path);
      committed = true;
      try { await this.syncDirectory(operation, this.filesystem.realRoot); }
      catch (cause) { throw operationError(operation, "commit-uncertain", "Catalog rename completed but directory durability is uncertain. Inspect the exact catalog/token and retained lock before recovery; do not retry blindly.", cause); }
    } finally {
      await temporary.handle.close().catch(() => undefined);
      if (!committed) await this.filesystem.operations.unlink(temporary.path).catch(() => undefined);
    }
  }
  private async syncDirectory(operation: MediaPersistenceOperation, path: string): Promise<void> {
    let handle;
    try {
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
      handle = await this.filesystem.operations.open(path, constants.O_RDONLY | NO_FOLLOW | (constants.O_DIRECTORY ?? 0));
      const opened = await handle.stat();
      const current = await this.filesystem.operations.lstat(path);
      if (!opened.isDirectory() || current.isSymbolicLink() || !sameFile(opened, current)) throw operationError(operation, "blocked", "Media directory changed before durability sync.");
      await handle.sync();
    } catch (cause) { rethrow(operation, "write-failed", "Media directory fsync is required but failed or is unsupported.", cause); }
    finally { await handle?.close().catch(() => undefined); }
  }
  private async stageBytes(input: MediaReplaceInput, expected?: StreamingAtomicWriteResult, expectedType?: string): Promise<StagedMedia> {
    await this.assertDirectories("put");
    input.signal?.throwIfAborted();
    const peeked = await peekBytes(input.bytes, input.signal);
    const sniffed = sniffMedia(peeked.head);
    if (!sniffed || (expectedType !== undefined && sniffed.mediaType !== expectedType)) {
      void peeked.cancel().catch(() => undefined);
      throw operationError("put", "validation", "Media signature is not allowed or does not match its metadata.");
    }
    const path = this.filesystem.ownedPath(".upload-" + randomBytes(24).toString("hex") + ".stage");
    try {
      const result = await streamingAtomicReplace(this.filesystem, "put", path, peeked.stream, {
        byteCap: MEDIA_MAX_BYTE_LENGTH, signal: input.signal,
        validateResult: (result) => {
          if (expected && (expected.byteLength !== result.byteLength || expected.checksum !== result.checksum))
            throw operationError("put", "validation", "Media length or checksum differs from its metadata.");
        },
      });
      return { path, result, sniffed };
    } catch (cause) { void peeked.cancel().catch(() => undefined); throw cause; }
  }
  private async commitBytes(staged: StagedMedia, url: string): Promise<void> {
    await this.assertDirectories("put");
    const path = this.versionPath(url);
    const integrity = await this.verifyBytes("put", path, staged.result.byteLength, staged.result.checksum);
    if (integrity === undefined) { await this.syncDirectory("put", this.bytesDirectory.path); return; }
    if (integrity !== "missing") throw operationError("put", "bytes-missing", "Existing immutable bytes are corrupted; replacement cannot overwrite them.");
    // link is an atomic create-if-absent; even a racing uncooperative creator
    // cannot have its bytes overwritten by our publication.
    await this.filesystem.assertRoot("put");
    await this.assertDirectories("put");
    try { await this.publishVersion(staged.path, path); }
    catch (cause) {
      if (errorCode(cause) === "EEXIST") throw operationError("put", "conflict", "Immutable Media byte path appeared during publication; retry.");
      rethrow("put", "write-failed", "Could not publish immutable Media bytes.", cause);
    }
    await this.syncDirectory("put", this.bytesDirectory.path);
  }
  private async removeStage(path: string): Promise<void> {
    try {
      await this.filesystem.assertRoot("put");
      const stats = await this.filesystem.operations.lstat(path);
      if (stats.isFile() && !stats.isSymbolicLink()) await this.filesystem.operations.unlink(path);
    } catch { /* Orphan stages never enter the catalog or delivery. */ }
  }
  private async assertDirectories(operation: MediaPersistenceOperation): Promise<void> {
    for (const directory of [this.publicDirectory, this.bytesDirectory]) {
      try {
        const stats = await this.filesystem.operations.lstat(directory.path);
        const realPath = await this.filesystem.operations.realpath(directory.path);
        if (stats.isSymbolicLink() || !stats.isDirectory() || !sameFile(stats, directory.stats) || realPath !== directory.realPath) {
          throw operationError(operation, "blocked", `Media storage directory was replaced: ${directory.path}`);
        }
      } catch (cause) {
        if (cause instanceof MediaPersistenceError) throw cause;
        throw operationError(operation, "blocked", `Could not verify Media storage directory: ${directory.path}`, cause);
      }
    }
  }

  private assertSafeId(operation: MediaPersistenceOperation, id: string): void {
    if (!isSafeRecordId(id)) throw operationError(operation, "validation", `Media id is not a stable path-safe id: ${JSON.stringify(id)}`);
  }


  private async verifyBytes(operation: MediaPersistenceOperation, path: string, byteLength: number, checksum: string): Promise<"missing" | "checksum-mismatch" | undefined> {
    let before: Stats;
    try {
      before = await this.filesystem.operations.lstat(path);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return "missing";
      rethrow(operation, "read-failed", "Could not inspect Media bytes.", cause);
    }
    if (before.isSymbolicLink() || !before.isFile()) throw operationError(operation, "blocked", "Refusing to follow a non-regular Media byte path.");
    let handle;
    try {
      handle = await this.filesystem.operations.open(path, constants.O_RDONLY | NO_FOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(before, opened)) throw operationError(operation, "blocked", "Media bytes changed while being opened.");
      const hash = createHash("sha256");
      let length = 0;
      for await (const chunk of handle.readableWebStream() as ReadableStream<Uint8Array>) {
        length += chunk.byteLength;
        hash.update(chunk);
      }
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
      const current = await this.filesystem.operations.lstat(path).catch((cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return undefined;
        throw cause;
      });
      if (current === undefined) return "missing";
      if (current.isSymbolicLink() || !current.isFile() || !sameFile(opened, current)) {
        throw operationError(operation, "blocked", "Media byte path changed during checksum verification.");
      }
      return length === byteLength && hash.digest("hex") === checksum ? undefined : "checksum-mismatch";
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return "missing";
      rethrow(operation, "read-failed", "Could not read Media bytes.", cause);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }


}
interface StagedMedia { path: string; result: StreamingAtomicWriteResult; sniffed: SniffedMedia }
export function createFilesystemMediaStore(options: FilesystemMediaStoreOptions): Promise<FilesystemMediaStore> {
  return FilesystemMediaStore.create(options);
}
