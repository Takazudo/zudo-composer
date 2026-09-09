import { sniffAsset } from "../../model/sniff";
export { sniffAsset } from "../../model/sniff";
import { createHash, randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link } from "node:fs/promises";
import { AssetPersistenceError, compareAssetSummariesNewestFirst, createAssetRecord, currentAssetVersion,
  summarizeAsset, ASSET_VERSIONED_CAPABILITIES,
  type AssetPersistenceErrorCode, type AssetPersistenceOperation, type AssetByteSource, type AssetRecord,
  type AssetInitializationOutcome, type AssetLoadOutcome, type AssetSummary, type VersionedAssetStore,
  type AssetMutationPrecondition, type AssetMetadataPatch, type AssetFolderPatch, type AssetListOptions,
} from "../../library";
import { ASSET_MAX_BYTE_LENGTH, ASSET_SCHEMA_VERSION, isValidAssetFileName, isAssetRevision,
  validateAssetRecord, validateAssetSnapshot, assetVersionUrl, isValidAssetChecksum,
  type AssetSnapshot, type AssetFolder, type AssetVersionRef, type AssetVersionPin, type AssetPinManifest,
} from "../../model";
import { isSafeRecordId, isPlainObject } from "../../../shared";
import { createUuidIdFactory } from "../../../shared/id-factory";
import { SafeRootFilesystem, commitDocument, type DurableExtraErrorCode, streamingAtomicReplace, syncDirectory, withMutationLock, type StreamingAtomicWriteResult } from "../../../shared/node-fs";
import type { FilesystemAssetStoreOptions, AssetUploadInput, SniffedAsset, AssetReplaceInput } from "./types";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const BYTES_DIRECTORY = "versions";
const EMPTY_TOKEN = "0".repeat(64);

class AssetCatalogRecoveryError extends AssetPersistenceError {
  constructor(readonly foundSchemaVersion?: number) {
    super("snapshot", "recovery-required", "Assets catalog is malformed or uses an unsupported schema. Source and all bytes are preserved; inspect catalog.json. Automatic reset is unavailable.", false);
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
  operation: AssetPersistenceOperation,
  code: AssetPersistenceErrorCode,
  message: string,
  cause?: unknown,
): AssetPersistenceError {
  return new AssetPersistenceError(
    operation,
    code,
    message,
    code === "read-failed" || code === "write-failed",
    cause === undefined ? undefined : { cause },
  );
}

function rethrow(
  operation: AssetPersistenceOperation,
  code: "read-failed" | "write-failed",
  message: string,
  cause: unknown,
): never {
  if (cause instanceof AssetPersistenceError) throw cause;
  throw operationError(operation, code, message, cause);
}

function asAsyncBytes(source: AssetByteSource): AsyncIterable<Uint8Array> {
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

async function peekBytes(source: AssetByteSource, signal?: AbortSignal): Promise<{
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

export class FilesystemAssetStore implements VersionedAssetStore {
  readonly provider = { id: "asset-files", label: "Project files" } as const;
  readonly capabilities = ASSET_VERSIONED_CAPABILITIES;
  private constructor(
    private readonly filesystem: SafeRootFilesystem<AssetPersistenceOperation, DurableExtraErrorCode>,
    private readonly bytesDirectory: GuardedDirectory,
    private readonly idFactory: (hint?: string) => string,
    private readonly now: () => string,
    private readonly publishVersion: typeof link,
  ) {}

  static async create(options: FilesystemAssetStoreOptions): Promise<FilesystemAssetStore> {
    const filesystem = await SafeRootFilesystem.create<AssetPersistenceOperation, DurableExtraErrorCode>({
      root: options.assetsStoreRoot,
      operations: options.operations,
      randomToken: options.randomToken,
      errors: {
        isError: (value): value is AssetPersistenceError => value instanceof AssetPersistenceError,
        create: operationError,
        rethrow,
      },
      rootLabel: "Assets store root",
      ownerLabel: "Assets",
      recordLabel: "assets record",
      initializeOperation: "initialize",
    });
    const prepareDirectory = async (relativePath: string): Promise<GuardedDirectory> => {
      const path = filesystem.ownedPath(relativePath);
      await filesystem.operations.mkdir(path, { recursive: true });
      const stats = await filesystem.operations.lstat(path);
      const realPath = await filesystem.operations.realpath(path);
      if (stats.isSymbolicLink() || !stats.isDirectory() || realPath !== path) {
        throw operationError("initialize", "blocked", `Assets directory is not a real owned directory: ${relativePath}`);
      }
      const realStats = await filesystem.operations.lstat(realPath);
      if (!sameFile(stats, realStats)) throw operationError("initialize", "blocked", `Assets directory failed realpath verification: ${relativePath}`);
      return { path, realPath, stats };
    };
    try {
      const bytesDirectory = await prepareDirectory(BYTES_DIRECTORY);
      return new FilesystemAssetStore(
        filesystem,
        bytesDirectory,
        options.idFactory ?? createUuidIdFactory(),
        options.now ?? (() => new Date().toISOString()),
        options.operations?.link ?? link,
      );
    } catch (cause) {
      rethrow("initialize", "read-failed", "Could not initialize Assets storage directories.", cause);
    }
  }


  async initialize(): Promise<AssetInitializationOutcome> {
    try { return { status: "ready", summaries: await this.list() }; }
    catch (cause) {
      if (cause instanceof AssetPersistenceError && cause.code === "recovery-required") {
        const foundSchemaVersion = cause instanceof AssetCatalogRecoveryError ? cause.foundSchemaVersion : undefined;
        return { status: "recovery-required", summaries: [], recovery: {
          kind: "quarantined", reason: foundSchemaVersion === undefined ? "invalid" : "future-schema", sourcePreserved: true,
          affectedRecordIds: [], message: cause.message, ...(foundSchemaVersion === undefined ? {} : { foundSchemaVersion }),
        } };
      }
      throw cause;
    }
  }
  snapshot(): Promise<AssetSnapshot> { return this.filesystem.run("snapshot", () => this.readCatalog()); }
  async mutationToken(): Promise<string> { return (await this.snapshot()).mutationToken; }
  async list(options: AssetListOptions = {}): Promise<readonly AssetSummary[]> {
    if (!isPlainObject(options) || Object.keys(options).some((key) => !["state", "folderId"].includes(key))
      || (options.state !== undefined && (typeof options.state !== "string" || !["active", "trash", "all"].includes(options.state)))
      || (options.folderId !== undefined && options.folderId !== null && !isSafeRecordId(options.folderId))) throw operationError("list", "validation", "Invalid Assets list options.");
    options = { ...options };
    return (await this.snapshot()).records.filter(({ document }) =>
      (options.state === "all" || document.state === (options.state ?? "active"))
      && (options.folderId === undefined || document.folderId === options.folderId))
      .map(summarizeAsset).sort(compareAssetSummariesNewestFirst);
  }
  async get(id: string): Promise<AssetLoadOutcome> {
    this.assertSafeId("get", id);
    const record = (await this.snapshot()).records.find((record) => record.id === id);
    if (!record) return { status: "not-found", id };
    const version = currentAssetVersion(record);
    const integrity = await this.verifyBytes("get", this.versionPath(version.url), version.byteLength, version.checksum);
    return integrity ? { status: "bytes-missing", record, reason: integrity } : { status: "loaded", record };
  }
  async upload(input: AssetUploadInput): Promise<AssetRecord> {
    input = { ...input };
    if (!isValidAssetFileName(input.fileName)) throw operationError("put", "validation", "Assets filename must be bounded safe display metadata.");
    if (typeof input.declaredMimeType !== "string" || input.declaredMimeType.length === 0) throw operationError("put", "validation", "Declared MIME type is required.");
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 10000)) throw operationError("put", "validation", "Assets note must be a string of at most 10,000 characters.");
    const staged = await this.stageBytes(input);
    try {
      return await this.mutate("put", input.expectedMutationToken, async (snapshot) => {
        input.signal?.throwIfAborted();
        const record = createAssetRecord({ fileName: input.fileName, folderId: input.folderId, note: input.note,
          mimeType: staged.sniffed.mimeType, ...staged.result }, { id: this.mintId(snapshot), timestamp: this.now() });
        snapshot.records.push(record);
        this.assertCatalog(snapshot);
        await this.commitBytes(staged, currentAssetVersion(record).url);
        input.signal?.throwIfAborted();
        return record;
      }, input.signal);
    } finally { await this.removeStage(staged.path); }
  }
  async replace(id: string, input: AssetReplaceInput, precondition: AssetMutationPrecondition): Promise<AssetRecord> {
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
        const version = { id: staged.result.checksum, ...staged.result, mimeType: staged.sniffed.mimeType,
          url: assetVersionUrl(staged.result.checksum, staged.sniffed.mimeType), createdAt: this.timestamp(record.updatedAt) };
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
  async put(record: AssetRecord, bytes: AssetByteSource): Promise<void> {
    const validation = validateAssetRecord(record);
    if (!validation.ok) throw operationError("put", "validation", validation.issue.message);
    const copy = structuredClone(record);
    if (copy.revision !== 1 || copy.document.versions.length !== 1 || copy.document.state !== "active")
      throw operationError("put", "validation", "Import accepts only a new single-version active asset.");
    const version = currentAssetVersion(copy);
    const staged = await this.stageBytes({ bytes }, { byteLength: version.byteLength, checksum: version.checksum }, version.mimeType);
    try {
      await this.mutate("put", undefined, async (snapshot) => {
        if (snapshot.records.some(({ id }) => id === copy.id)) throw operationError("put", "conflict", "Asset already exists; use replace with its revision.");
        snapshot.records.push(copy);
        this.assertCatalog(snapshot);
        await this.commitBytes(staged, version.url);
      });
    } finally { await this.removeStage(staged.path); }
  }
  updateMetadata(id: string, patch: AssetMetadataPatch, precondition: AssetMutationPrecondition): Promise<AssetRecord> {
    if (!patch || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !["fileName", "folderId", "note"].includes(key)))
      return Promise.reject(operationError("metadata", "validation", "Unsupported or empty metadata patch."));
    patch = structuredClone(patch);
    return this.editRecord("metadata", id, precondition, (record) => {
      if (record.document.state !== "active") throw operationError("metadata", "validation", "Restore the asset before editing it.");
      Object.assign(record.document, structuredClone(patch));
    });
  }
  trash(id: string, precondition: AssetMutationPrecondition): Promise<AssetRecord> {
    return this.editRecord("trash", id, precondition, (record) => { record.document.state = "trash"; });
  }
  restore(id: string, precondition: AssetMutationPrecondition): Promise<AssetRecord> {
    return this.editRecord("restore", id, precondition, (record) => { record.document.state = "active"; });
  }
  async delete(id: string, precondition?: AssetMutationPrecondition): Promise<boolean> {
    this.assertSafeId("delete", id);
    this.assertPrecondition(precondition);
    await this.trash(id, precondition);
    return true;
  }
  clear(): Promise<void> {
    return Promise.reject(operationError("clear", "blocked", "Permanent purge is unavailable. Trash individual assets with metadata preconditions."));
  }
  createFolder(input: { name: string; parentId: string | null; index?: number }, expectedMutationToken: string): Promise<AssetFolder> {
    if (!isPlainObject(input) || Object.keys(input).some((key) => !["name", "parentId", "index"].includes(key)) || !("name" in input) || !("parentId" in input)) return Promise.reject(operationError("folder", "validation", "Folder input requires name and parentId."));
    if (typeof expectedMutationToken !== "string") return Promise.reject(operationError("folder", "validation", "Folder creation requires a snapshot mutation token."));
    input = structuredClone(input);
    return this.mutate("folder", expectedMutationToken, async (snapshot) => {
      const timestamp = this.now();
      const folder: AssetFolder = { id: this.mintId(snapshot), name: input.name, parentId: input.parentId,
        state: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp };
      snapshot.folders.push(folder);
      if (input.index !== undefined) this.placeFolder(snapshot, folder, input.index);
      return folder;
    });
  }
  updateFolder(id: string, patch: AssetFolderPatch, precondition: AssetMutationPrecondition): Promise<AssetFolder> {
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
  private placeFolder(snapshot: AssetSnapshot, folder: AssetFolder, index: number): void {
    const remaining = snapshot.folders.filter(({ id }) => id !== folder.id);
    const siblings = remaining.filter((item) => item.parentId === folder.parentId && item.state === "active");
    if (!Number.isSafeInteger(index) || index < 0 || index > siblings.length) throw operationError("folder", "validation", "Folder insertion index is outside the current sibling list.");
    const before = siblings[index];
    remaining.splice(before ? remaining.indexOf(before) : remaining.length, 0, folder);
    snapshot.folders = remaining;
  }
  trashFolder(id: string, precondition: AssetMutationPrecondition): Promise<AssetFolder> {
    return this.editFolder(id, precondition, (folder, snapshot) => {
      if (snapshot.folders.some((child) => child.parentId === id && child.state === "active")
        || snapshot.records.some(({ document }) => document.folderId === id && document.state === "active"))
        throw operationError("folder", "validation", "Move or trash active children before trashing a folder.");
      folder.state = "trash";
    });
  }
  restoreFolder(id: string, precondition: AssetMutationPrecondition): Promise<AssetFolder> {
    return this.editFolder(id, precondition, (folder) => { folder.state = "active"; });
  }
  async resolveVersion(ref: AssetVersionRef): Promise<AssetVersionPin> {
    ref = structuredClone(ref);
    return this.resolveFromSnapshot(await this.snapshot(), ref);
  }
  async pinManifest(refs: readonly AssetVersionRef[]): Promise<AssetPinManifest> {
    if (!Array.isArray(refs)) throw operationError("pin", "validation", "Assets manifest requires an array of exact-version references.");
    refs = structuredClone(refs);
    const snapshot = await this.snapshot();
    const pins = new Map<string, AssetVersionPin>();
    for (const ref of refs) {
      const pin = await this.resolveFromSnapshot(snapshot, ref);
      pins.set(JSON.stringify([pin.providerId, pin.assetId, pin.versionId]), pin);
    }
    return { schemaVersion: 1, pins: [...pins.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, pin]) => pin) };
  }
  private async resolveFromSnapshot(snapshot: AssetSnapshot, ref: AssetVersionRef): Promise<AssetVersionPin> {
    if (!ref || ref.providerId !== this.provider.id || !isSafeRecordId(ref.assetId) || !/^[a-f0-9]{64}$/.test(ref.versionId)) throw operationError("pin", "validation", "Invalid provider-qualified Assets version reference.");
    const record = snapshot.records.find(({ id }) => id === ref.assetId);
    const version = record?.document.versions.find(({ id }) => id === ref.versionId);
    if (!version) throw operationError("pin", "not-found", "Exact Assets version is not retained.");
    const integrity = await this.verifyBytes("pin", this.versionPath(version.url), version.byteLength, version.checksum);
    if (integrity) throw operationError("pin", "bytes-missing", "Exact Assets version bytes are missing or corrupted.");
    return { providerId: this.provider.id, assetId: record!.id, versionId: version.id, checksum: version.checksum,
      byteLength: version.byteLength, mimeType: version.mimeType, url: version.url };
  }
  private editRecord(operation: AssetPersistenceOperation, id: string, precondition: AssetMutationPrecondition, edit: (record: AssetRecord) => void): Promise<AssetRecord> {
    this.assertSafeId(operation, id);
    this.assertPrecondition(precondition);
    precondition = structuredClone(precondition);
    return this.mutate(operation, precondition.expectedMutationToken, async (snapshot) => {
      const record = this.requireRecord(snapshot, id, precondition);
      edit(record); this.bump(record); return record;
    });
  }
  private editFolder(id: string, precondition: AssetMutationPrecondition, edit: (folder: AssetFolder, snapshot: AssetSnapshot) => void): Promise<AssetFolder> {
    this.assertSafeId("folder", id);
    this.assertPrecondition(precondition);
    precondition = structuredClone(precondition);
    return this.mutate("folder", precondition.expectedMutationToken, async (snapshot) => {
      const folder = snapshot.folders.find((folder) => folder.id === id);
      if (!folder) throw operationError("folder", "not-found", "Assets folder does not exist.");
      if (folder.revision !== precondition.expectedRevision) throw operationError("folder", "conflict", "Assets folder changed; reload before retrying.");
      edit(folder, snapshot); this.bump(folder); return folder;
    });
  }
  private assertPrecondition(value: AssetMutationPrecondition | undefined): asserts value is AssetMutationPrecondition {
    if (!isPlainObject(value) || !isAssetRevision(value.expectedRevision)
      || Object.keys(value).some((key) => !["expectedRevision", "expectedMutationToken"].includes(key))
      || (value.expectedMutationToken !== undefined && !isValidAssetChecksum(value.expectedMutationToken)))
      throw operationError("metadata", "validation", "An explicit expected metadata revision and valid optional snapshot token are required.");
  }
  private requireRecord(snapshot: AssetSnapshot, id: string, precondition: AssetMutationPrecondition): AssetRecord {
    const record = snapshot.records.find((record) => record.id === id);
    if (!record) throw operationError("metadata", "not-found", "Assets asset does not exist.");
    if (record.revision !== precondition.expectedRevision || (precondition.expectedMutationToken !== undefined && precondition.expectedMutationToken !== snapshot.mutationToken))
      throw operationError("metadata", "conflict", "Assets changed; reload before retrying.");
    return record;
  }
  private timestamp(previous: string): string { const now = this.now(); return now > previous ? now : previous; }
  private bump(value: { revision: number; updatedAt: string }): void { value.revision += 1; value.updatedAt = this.timestamp(value.updatedAt); }
  private mintId(snapshot: AssetSnapshot): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = this.idFactory("assets");
      this.assertSafeId("put", id);
      if (!snapshot.records.some((record) => record.id === id) && !snapshot.folders.some((folder) => folder.id === id)) return id;
    }
    throw operationError("put", "write-failed", "Could not mint an unused Assets id.");
  }
  private catalogPath(): string { return this.filesystem.ownedPath("catalog.json"); }
  private versionPath(url: string): string {
    if (!/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.(png|jpg|gif|webp|pdf)$/.test(url))
      throw operationError("get", "validation", "Invalid immutable Assets URL.");
    return this.filesystem.ownedPath(BYTES_DIRECTORY + "/" + url.slice("/uploaded-assets/".length));
  }
  private assertCatalog(snapshot: AssetSnapshot): void {
    if (!validateAssetSnapshot(snapshot)) throw operationError("metadata", "validation", "Invalid Assets metadata graph: check names, revisions, versions, folder parents, cycles, collisions and trash state.");
  }
  private async readCatalog(): Promise<AssetSnapshot> {
    await this.assertDirectories("snapshot");
    const file = await this.filesystem.readFileNoFollow("snapshot", this.catalogPath());
    if (!file) return { schemaVersion: ASSET_SCHEMA_VERSION, mutationToken: EMPTY_TOKEN, records: [], folders: [] };
    let raw: unknown;
    try { raw = JSON.parse(file.text); } catch { /* Preserved for manual recovery. */ }
    if (!validateAssetSnapshot(raw)) throw new AssetCatalogRecoveryError(isPlainObject(raw) && typeof raw.schemaVersion === "number" && raw.schemaVersion > ASSET_SCHEMA_VERSION ? raw.schemaVersion : undefined);
    await this.assertDirectories("snapshot");
    return raw;
  }
  /** Kernel O_EXCL serializes cooperating writers across processes. Never steal
   * an existing lock: after a crash verify no writer is running before manual
   * .mutation.lock removal. Reads remain available during lock recovery.
   *
   * The whole catalog is one document, so a mutation touching several records
   * commits with the single rename inside commitDocument or not at all. */
  private mutate<T>(operation: AssetPersistenceOperation, expectedToken: string | undefined, edit: (snapshot: AssetSnapshot) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (expectedToken !== undefined && !isValidAssetChecksum(expectedToken)) return Promise.reject(operationError(operation, "validation", "Expected Assets snapshot token must be a valid token."));
    const verify = (phase: AssetPersistenceOperation) => this.assertDirectories(phase);
    return this.filesystem.run(operation, () => withMutationLock(
      this.filesystem,
      operation,
      {
        now: this.now,
        preflightDirectories: [this.filesystem.realRoot, this.bytesDirectory.path],
        verify,
        onFailure: (cause) => rethrow(operation, "write-failed", "Could not commit Assets mutation.", cause),
      },
      async () => {
        const snapshot = await this.readCatalog();
        signal?.throwIfAborted();
        if (expectedToken !== undefined && expectedToken !== snapshot.mutationToken) throw operationError(operation, "conflict", "Assets snapshot changed; reload before retrying.");
        const result = await edit(snapshot);
        snapshot.mutationToken = randomBytes(32).toString("hex");
        this.assertCatalog(snapshot);
        await this.assertDirectories(operation);
        await commitDocument(this.filesystem, operation, this.catalogPath(), JSON.stringify(snapshot, null, 2) + "\n", {
          signal,
          verify,
          uncertainMessage: "Catalog rename completed but directory durability is uncertain. Inspect the exact catalog/token and retained lock before recovery; do not retry blindly.",
        });
        return structuredClone(result);
      },
    ));
  }
  private syncDirectory(operation: AssetPersistenceOperation, path: string): Promise<void> {
    return syncDirectory(this.filesystem, operation, path, (phase) => this.assertDirectories(phase));
  }
  private async stageBytes(input: AssetReplaceInput, expected?: StreamingAtomicWriteResult, expectedType?: string): Promise<StagedAsset> {
    await this.assertDirectories("put");
    input.signal?.throwIfAborted();
    const peeked = await peekBytes(input.bytes, input.signal);
    const sniffed = sniffAsset(peeked.head);
    if (!sniffed || (expectedType !== undefined && sniffed.mimeType !== expectedType)) {
      void peeked.cancel().catch(() => undefined);
      throw operationError("put", "validation", "Assets signature is not allowed or does not match its metadata.");
    }
    const path = this.filesystem.ownedPath(".upload-" + randomBytes(24).toString("hex") + ".stage");
    try {
      const result = await streamingAtomicReplace(this.filesystem, "put", path, peeked.stream, {
        byteCap: ASSET_MAX_BYTE_LENGTH, signal: input.signal,
        validateResult: (result) => {
          if (expected && (expected.byteLength !== result.byteLength || expected.checksum !== result.checksum))
            throw operationError("put", "validation", "Assets length or checksum differs from its metadata.");
        },
      });
      return { path, result, sniffed };
    } catch (cause) { void peeked.cancel().catch(() => undefined); throw cause; }
  }
  private async commitBytes(staged: StagedAsset, url: string): Promise<void> {
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
      if (errorCode(cause) === "EEXIST") throw operationError("put", "conflict", "Immutable Assets byte path appeared during publication; retry.");
      rethrow("put", "write-failed", "Could not publish immutable Assets bytes.", cause);
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
  private async assertDirectories(operation: AssetPersistenceOperation): Promise<void> {
    const directory = this.bytesDirectory;
    try {
      const stats = await this.filesystem.operations.lstat(directory.path);
      const realPath = await this.filesystem.operations.realpath(directory.path);
      if (stats.isSymbolicLink() || !stats.isDirectory() || !sameFile(stats, directory.stats) || realPath !== directory.realPath) {
        throw operationError(operation, "blocked", `Assets storage directory was replaced: ${directory.path}`);
      }
    } catch (cause) {
      if (cause instanceof AssetPersistenceError) throw cause;
      throw operationError(operation, "blocked", `Could not verify Assets storage directory: ${directory.path}`, cause);
    }
  }

  private assertSafeId(operation: AssetPersistenceOperation, id: string): void {
    if (!isSafeRecordId(id)) throw operationError(operation, "validation", `Assets id is not a stable path-safe id: ${JSON.stringify(id)}`);
  }


  private async verifyBytes(operation: AssetPersistenceOperation, path: string, byteLength: number, checksum: string): Promise<"missing" | "checksum-mismatch" | undefined> {
    let before: Stats;
    try {
      before = await this.filesystem.operations.lstat(path);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return "missing";
      rethrow(operation, "read-failed", "Could not inspect Assets bytes.", cause);
    }
    if (before.isSymbolicLink() || !before.isFile()) throw operationError(operation, "blocked", "Refusing to follow a non-regular Assets byte path.");
    let handle;
    try {
      handle = await this.filesystem.operations.open(path, constants.O_RDONLY | NO_FOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(before, opened)) throw operationError(operation, "blocked", "Assets bytes changed while being opened.");
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
        throw operationError(operation, "blocked", "Assets byte path changed during checksum verification.");
      }
      return length === byteLength && hash.digest("hex") === checksum ? undefined : "checksum-mismatch";
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return "missing";
      rethrow(operation, "read-failed", "Could not read Assets bytes.", cause);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }


}
interface StagedAsset { path: string; result: StreamingAtomicWriteResult; sniffed: SniffedAsset }
export function createFilesystemAssetStore(options: FilesystemAssetStoreOptions): Promise<FilesystemAssetStore> {
  return FilesystemAssetStore.create(options);
}
