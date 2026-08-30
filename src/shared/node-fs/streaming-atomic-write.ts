import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type { SafeRootFilesystem } from "./safe-root";

export interface StreamingAtomicWriteOptions {
  byteCap: number;
  signal?: AbortSignal;
  /** Synchronous pre-commit integrity check. Throwing leaves the old target untouched. */
  validateResult?(result: StreamingAtomicWriteResult): void;
}

export interface StreamingAtomicWriteResult {
  byteLength: number;
  checksum: string;
}

export class StreamingAtomicWriteCapError extends Error {
  readonly name = "StreamingAtomicWriteCapError";
  readonly code = "BYTE_CAP_EXCEEDED";

  constructor(
    readonly byteCap: number,
    readonly byteLength: number,
  ) {
    super(`Stream exceeded the ${byteCap}-byte limit.`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

async function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<T>> {
  throwIfAborted(signal);
  if (signal === undefined) return iterator.next();

  let rejectAbort!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten === 0) throw new Error("Atomic stream write made no progress.");
    offset += bytesWritten;
  }
}

/**
 * Stream bytes into an exclusive temporary file, then durably replace an owned target.
 * Calls sharing a verified root are serialized by the root's realpath-keyed queue.
 */
export async function streamingAtomicReplace<Operation extends string>(
  filesystem: SafeRootFilesystem<Operation>,
  operation: Operation,
  finalPath: string,
  source: AsyncIterable<Uint8Array>,
  options: StreamingAtomicWriteOptions,
): Promise<StreamingAtomicWriteResult> {
  if (!Number.isSafeInteger(options.byteCap) || options.byteCap < 0) {
    throw new RangeError("byteCap must be a non-negative safe integer.");
  }
  filesystem.assertOwnedPath(finalPath);

  return filesystem.run(operation, async () => {
    throwIfAborted(options.signal);
    await filesystem.assertReplaceablePath(operation, finalPath);

    let temporaryPath: string | undefined;
    let handle: FileHandle | undefined;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let iteratorDone = false;
    try {
      const temporary = await filesystem.openTemporaryFile(operation, finalPath);
      temporaryPath = temporary.path;
      handle = temporary.handle;

      const hash = createHash("sha256");
      let byteLength = 0;
      let capExceeded = false;
      iterator = source[Symbol.asyncIterator]();

      while (true) {
        const item = await nextWithAbort(iterator, options.signal);
        if (item.done) {
          iteratorDone = true;
          break;
        }

        byteLength += item.value.byteLength;
        if (capExceeded || byteLength > options.byteCap) {
          capExceeded = true;
          continue;
        }

        // Detach from caller-owned storage before hashing or crossing an await.
        const bytes = Uint8Array.from(item.value);
        hash.update(bytes);
        await writeAll(handle, bytes);
        throwIfAborted(options.signal);
      }

      throwIfAborted(options.signal);
      if (capExceeded) {
        throw new StreamingAtomicWriteCapError(options.byteCap, byteLength);
      }

      const result = { byteLength, checksum: hash.digest("hex") };
      options.validateResult?.(result);

      throwIfAborted(options.signal);
      await handle.sync();
      throwIfAborted(options.signal);
      await handle.close();
      handle = undefined;

      await filesystem.assertRoot(operation);
      await filesystem.assertReplaceablePath(operation, finalPath);
      throwIfAborted(options.signal);
      await filesystem.operations.rename(temporaryPath, finalPath);
      temporaryPath = undefined;

      return result;
    } catch (cause) {
      if (cause instanceof StreamingAtomicWriteCapError) throw cause;
      filesystem.rethrowAtomicWriteFailure(operation, finalPath, cause);
    } finally {
      // Do not let a source whose pending `next()` never settles block destination cleanup.
      if (!iteratorDone) void iterator?.return?.().catch(() => undefined);
      await handle?.close().catch(() => undefined);
      if (temporaryPath !== undefined) {
        await filesystem.operations.unlink(temporaryPath).catch(() => undefined);
      }
    }
  });
}
