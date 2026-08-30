import { createHash } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  MediaPersistenceError,
  compareMediaSummariesNewestFirst,
  createMediaRecord,
  summarizeMedia,
  type MediaByteSource,
  type MediaLoadOutcome,
  type MediaPersistenceOperation,
  type MediaRecord,
  type MediaStore,
  type MediaSummary,
} from "../../library";
import {
  MEDIA_MAX_BYTE_LENGTH,
  isValidMediaFileName,
  loadMediaRecord,
  validateMediaRecord,
} from "../../model";
import { isSafeRecordId } from "../../../shared";
import { createUuidIdFactory } from "../../../shared/id-factory";
import {
  SafeRootFilesystem,
  streamingAtomicReplace,
  type StreamingAtomicWriteResult,
} from "../../../shared/node-fs";
import type { FilesystemMediaStoreOptions, MediaUploadInput, SniffedMedia } from "./types";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const RECORDS_DIRECTORY = "records";
const BYTES_DIRECTORY = "public/uploaded-media";
const RECORD_PATTERN = /^media-([a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?)\.json$/;
const BYTE_PATTERN = /^media-[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?\.(?:png|jpg|gif|webp|pdf)$/;
const MAX_ID_ATTEMPTS = 16;

const EXTENSION_BY_MEDIA_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function operationError(
  operation: MediaPersistenceOperation,
  code: "blocked" | "validation" | "read-failed" | "write-failed",
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
    void iterator.return?.();
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

interface CanonicalRecord {
  outcome: MediaLoadOutcome;
  stats: Stats;
}

interface GuardedDirectory {
  path: string;
  realPath: string;
  stats: Stats;
}

export class FilesystemMediaStore implements MediaStore {
  readonly provider = { id: "media-files", label: "Project files" } as const;

  private constructor(
    private readonly filesystem: SafeRootFilesystem<MediaPersistenceOperation>,
    private readonly recordsDirectory: GuardedDirectory,
    private readonly publicDirectory: GuardedDirectory,
    private readonly bytesDirectory: GuardedDirectory,
    private readonly idFactory: (hint?: string) => string,
    private readonly now: () => string,
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
      const recordsDirectory = await prepareDirectory(RECORDS_DIRECTORY);
      const publicDirectory = await prepareDirectory("public");
      const bytesDirectory = await prepareDirectory(BYTES_DIRECTORY);
      return new FilesystemMediaStore(
        filesystem,
        recordsDirectory,
        publicDirectory,
        bytesDirectory,
        options.idFactory ?? createUuidIdFactory(),
        options.now ?? (() => new Date().toISOString()),
      );
    } catch (cause) {
      rethrow("initialize", "read-failed", "Could not initialize Media storage directories.", cause);
    }
  }

  async upload(input: MediaUploadInput): Promise<MediaRecord> {
    if (!isValidMediaFileName(input.fileName)) throw operationError("put", "validation", "Media fileName must be bounded, non-empty display metadata without control characters or separators.");
    if (typeof input.declaredMediaType !== "string" || input.declaredMediaType.length === 0) throw operationError("put", "validation", "Declared media type must be a non-empty string.");
    input.signal?.throwIfAborted();
    const id = await this.mintId();
    const peeked = await peekBytes(input.bytes, input.signal);
    const sniffed = sniffMedia(peeked.head);
    if (sniffed === undefined) {
      await peeked.cancel().catch(() => undefined);
      throw operationError("put", "validation", "Media bytes do not match an allowed file signature.");
    }
    let result: StreamingAtomicWriteResult;
    try {
      result = await this.writeBytes(id, sniffed.extension, peeked.stream, input.signal);
    } catch (cause) {
      await peeked.cancel().catch(() => undefined);
      throw cause;
    }
    const record = createMediaRecord({
      fileName: input.fileName,
      mediaType: sniffed.mediaType,
      byteLength: result.byteLength,
      checksum: result.checksum,
    }, { id, timestamp: this.now() });
    await this.writeRecord(record);
    return structuredClone(record);
  }

  async put(record: MediaRecord, source: MediaByteSource): Promise<void> {
    const validation = validateMediaRecord(record);
    if (!validation.ok) throw operationError("put", "validation", validation.issue.message);
    const snapshot = structuredClone(validation.value);
    const peeked = await peekBytes(source);
    const sniffed = sniffMedia(peeked.head);
    if (sniffed === undefined || sniffed.mediaType !== snapshot.document.mediaType) {
      await peeked.cancel().catch(() => undefined);
      throw operationError("put", "validation", "Media byte signature does not match the canonical mediaType.");
    }
    let result: StreamingAtomicWriteResult;
    try {
      result = await this.writeBytes(snapshot.id, sniffed.extension, peeked.stream);
    } catch (cause) {
      await peeked.cancel().catch(() => undefined);
      throw cause;
    }
    if (result.byteLength !== snapshot.document.byteLength || result.checksum !== snapshot.document.checksum) {
      throw operationError("put", "validation", "Media bytes do not match the canonical length and checksum.");
    }
    await this.writeRecord(snapshot);
  }

  async list(): Promise<readonly MediaSummary[]> {
    return this.run("list", async () => {
      let entries;
      try {
        entries = await this.filesystem.operations.readdir(this.recordsDirectory.path, { withFileTypes: true });
        await this.assertDirectories("list");
      } catch (cause) {
        rethrow("list", "read-failed", "Could not inspect Media records.", cause);
      }
      const summaries: MediaSummary[] = [];
      for (const entry of entries) {
        const match = RECORD_PATTERN.exec(entry.name);
        if (!match || entry.isSymbolicLink() || !entry.isFile()) continue;
        const canonical = await this.readCanonical("list", match[1]!);
        if (canonical?.outcome.status === "loaded") summaries.push(summarizeMedia(canonical.outcome.record));
      }
      return summaries.sort(compareMediaSummariesNewestFirst);
    });
  }

  async get(id: string): Promise<MediaLoadOutcome> {
    this.assertSafeId("get", id);
    return this.run("get", async () => {
      const canonical = await this.readCanonical("get", id);
      if (canonical === undefined) return { status: "not-found", id };
      if (canonical.outcome.status !== "loaded") return canonical.outcome;
      const record = canonical.outcome.record;
      const extension = EXTENSION_BY_MEDIA_TYPE[record.document.mediaType];
      const integrity = await this.verifyBytes("get", this.bytePath(id, extension), record.document.byteLength, record.document.checksum);
      if (integrity !== undefined) return { status: "bytes-missing", record: structuredClone(record), reason: integrity };
      return { status: "loaded", record: structuredClone(record) };
    });
  }

  async delete(id: string): Promise<boolean> {
    this.assertSafeId("delete", id);
    return this.run("delete", async () => {
      const canonical = await this.readCanonical("delete", id);
      if (canonical === undefined) return false;
      if (canonical.outcome.status !== "loaded") throw operationError("delete", "validation", `Media record "${id}" is invalid; no files were deleted.`);
      await this.unlinkValidated("delete", this.recordPath(id), canonical.stats);
      const extension = EXTENSION_BY_MEDIA_TYPE[canonical.outcome.record.document.mediaType];
      await this.unlinkIfRegular("delete", this.bytePath(id, extension));
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.run("clear", async () => {
      let recordEntries: Dirent[];
      let byteEntries: Dirent[];
      try {
        [recordEntries, byteEntries] = await Promise.all([
          this.filesystem.operations.readdir(this.recordsDirectory.path, { withFileTypes: true }),
          this.filesystem.operations.readdir(this.bytesDirectory.path, { withFileTypes: true }),
        ]);
        await this.assertDirectories("clear");
      } catch (cause) {
        rethrow("clear", "read-failed", "Could not inspect Media files before clearing.", cause);
      }
      const collect = async (relativeDirectory: string, entries: Dirent[], pattern: RegExp) => {
        const files: Array<{ path: string; stats: Stats }> = [];
        for (const entry of entries) {
          if (!pattern.test(entry.name)) continue;
          if (entry.isSymbolicLink() || !entry.isFile()) throw operationError("clear", "blocked", `Refusing to clear non-regular Media path: ${entry.name}`);
          const path = this.filesystem.ownedPath(`${relativeDirectory}/${entry.name}`);
          const stats = await this.filesystem.operations.lstat(path);
          if (stats.isSymbolicLink() || !stats.isFile()) throw operationError("clear", "blocked", `Media path changed before clear: ${entry.name}`);
          files.push({ path, stats });
        }
        return files;
      };
      const records = await collect(RECORDS_DIRECTORY, recordEntries, RECORD_PATTERN);
      const bytes = await collect(BYTES_DIRECTORY, byteEntries, BYTE_PATTERN);
      for (const file of records) await this.unlinkExpected("clear", file.path, file.stats, "record");
      for (const file of bytes) await this.unlinkExpected("clear", file.path, file.stats, "bytes");
    });
  }

  private async run<T>(operation: MediaPersistenceOperation, task: () => Promise<T>): Promise<T> {
    return this.filesystem.run(operation, async () => {
      await this.assertDirectories(operation);
      return task();
    });
  }

  private async assertDirectories(operation: MediaPersistenceOperation): Promise<void> {
    for (const directory of [this.recordsDirectory, this.publicDirectory, this.bytesDirectory]) {
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

  private recordPath(id: string): string {
    return this.filesystem.ownedPath(`${RECORDS_DIRECTORY}/media-${id}.json`);
  }

  private bytePath(id: string, extension: SniffedMedia["extension"]): string {
    return this.filesystem.ownedPath(`${BYTES_DIRECTORY}/media-${id}.${extension}`);
  }

  private async mintId(): Promise<string> {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = this.idFactory("media");
      if (!isSafeRecordId(id)) throw operationError("put", "blocked", "Media id source returned an unsafe id.");
      const record = await this.filesystem.operations.lstat(this.recordPath(id)).catch((cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return undefined;
        throw cause;
      });
      if (record === undefined) return id;
      if (record.isSymbolicLink() || !record.isFile()) {
        throw operationError("put", "blocked", "Refusing to mint an id whose canonical Media path is non-regular.");
      }
    }
    throw operationError("put", "write-failed", "Could not mint an unused Media id.");
  }

  private async writeBytes(
    id: string,
    extension: SniffedMedia["extension"],
    source: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<StreamingAtomicWriteResult> {
    await this.assertDirectories("put");
    return streamingAtomicReplace(this.filesystem, "put", this.bytePath(id, extension), source, { byteCap: MEDIA_MAX_BYTE_LENGTH, signal });
  }

  private async writeRecord(record: MediaRecord): Promise<void> {
    await this.run("put", async () => {
      await this.filesystem.atomicReplace("put", this.recordPath(record.id), `${JSON.stringify(record, null, 2)}\n`);
    });
  }

  private async readCanonical(operation: MediaPersistenceOperation, expectedId: string): Promise<CanonicalRecord | undefined> {
    const file = await this.filesystem.readFileNoFollow(operation, this.recordPath(expectedId));
    if (file === undefined) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      return { stats: file.stats, outcome: { status: "invalid", issue: { code: "invalid-record", message: "Canonical Media record is not valid JSON." }, raw: file.text } };
    }
    const outcome = loadMediaRecord(raw);
    if (outcome.status === "loaded" && outcome.record.id !== expectedId) {
      return { stats: file.stats, outcome: { status: "invalid", issue: { code: "invalid-record", message: "Canonical Media record id does not match its derived filename." }, raw } };
    }
    return { stats: file.stats, outcome };
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

  private async unlinkValidated(operation: "delete", path: string, expected: Stats): Promise<void> {
    await this.unlinkExpected(operation, path, expected, "record");
  }

  private async unlinkExpected(
    operation: "delete" | "clear",
    path: string,
    expected: Stats,
    label: "record" | "bytes",
  ): Promise<void> {
    try {
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
      const current = await this.filesystem.operations.lstat(path);
      if (current.isSymbolicLink() || !current.isFile() || !sameFile(current, expected)) throw operationError(operation, "blocked", `Media ${label} changed before deletion.`);
      await this.filesystem.operations.unlink(path);
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
    } catch (cause) {
      rethrow(operation, "write-failed", `Could not delete Media ${label}.`, cause);
    }
  }

  private async unlinkIfRegular(operation: "delete", path: string): Promise<void> {
    try {
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
      const stats = await this.filesystem.operations.lstat(path);
      if (stats.isSymbolicLink() || !stats.isFile()) throw operationError(operation, "blocked", "Refusing to delete a non-regular Media byte path.");
      await this.filesystem.operations.unlink(path);
      await this.filesystem.assertRoot(operation);
      await this.assertDirectories(operation);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return;
      rethrow(operation, "write-failed", "Could not delete Media bytes.", cause);
    }
  }
}

export function createFilesystemMediaStore(options: FilesystemMediaStoreOptions): Promise<FilesystemMediaStore> {
  return FilesystemMediaStore.create(options);
}
