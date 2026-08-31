import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeRootFilesystem, type SafeRootErrorPolicy } from "../safe-root";
import { streamingAtomicReplace } from "../streaming-atomic-write";

type TestOperation = "initialize" | "write";

const errors: SafeRootErrorPolicy<TestOperation> = {
  isError: (value) => value instanceof TestFilesystemError,
  create: (operation, code, message, cause) => new TestFilesystemError(operation, code, message, cause),
  rethrow: (operation, code, message, cause): never => {
    if (cause instanceof TestFilesystemError) throw cause;
    throw new TestFilesystemError(operation, code, message, cause);
  },
};

class TestFilesystemError extends Error {
  constructor(
    readonly operation: TestOperation,
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("streamingAtomicReplace", () => {
  const sandboxes: string[] = [];

  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createFilesystem(
    operations?: Parameters<typeof SafeRootFilesystem.create<TestOperation>>[0]["operations"],
  ) {
    const sandbox = await mkdtemp(join(tmpdir(), "streaming-atomic-write-test-"));
    sandboxes.push(sandbox);
    const root = join(sandbox, "root");
    return {
      root,
      filesystem: await SafeRootFilesystem.create({
        root,
        operations,
        randomToken: () => "fixed-safe-token",
        errors,
        rootLabel: "Test root",
        ownerLabel: "Test",
        recordLabel: "record",
        initializeOperation: "initialize",
      }),
    };
  }

  async function expectNoTemporaryFiles(root: string) {
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  }

  it("commits byte-identical bytes with an incremental SHA-256 and secure temp permissions", async () => {
    const opens: Array<{ flags: number; mode?: number }> = [];
    const { root, filesystem } = await createFilesystem({
      open: async (path, flags, mode) => {
        opens.push({ flags, mode });
        return (await import("node:fs/promises")).open(path, flags, mode);
      },
    });
    const target = filesystem.ownedPath("asset.bin");
    const chunks = [Uint8Array.of(0, 1, 2, 255), Uint8Array.of(10, 20, 30)];

    const result = await streamingAtomicReplace(filesystem, "write", target, async function* () {
      yield* chunks;
    }(), { byteCap: 25 * 1024 * 1024 });

    const expected = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    expect(await readFile(target)).toEqual(expected);
    expect(result).toEqual({
      byteLength: expected.byteLength,
      checksum: createHash("sha256").update(expected).digest("hex"),
    });
    expect(opens.at(-1)).toEqual({
      flags: constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
      mode: 0o600,
    });
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expectNoTemporaryFiles(root);
  });

  it("rejects a whole cap-crossing chunk, drains to EOF, and raises one typed error", async () => {
    const { root, filesystem } = await createFilesystem();
    const target = filesystem.ownedPath("asset.bin");
    await writeFile(target, "previous");
    const seen: number[] = [];
    async function* source() {
      for (const value of [Uint8Array.of(1, 2), Uint8Array.of(3, 4), Uint8Array.of(5)]) {
        seen.push(value[0]!);
        yield value;
      }
    }

    const failure = streamingAtomicReplace(filesystem, "write", target, source(), { byteCap: 3 });
    await expect(failure).rejects.toMatchObject({
      name: "StreamingAtomicWriteCapError",
      code: "BYTE_CAP_EXCEEDED",
      byteCap: 3,
      byteLength: 5,
    });
    expect(seen).toEqual([1, 3, 5]);
    expect(await readFile(target, "utf8")).toBe("previous");
    await expectNoTemporaryFiles(root);
  });

  it("aborts a pending source read, closes the source, and leaves no temp file", async () => {
    const { root, filesystem } = await createFilesystem();
    const target = filesystem.ownedPath("asset.bin");
    const controller = new AbortController();
    const nextPending = deferred();
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    let calls = 0;
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          calls += 1;
          if (calls === 1) return { done: false, value: Uint8Array.of(1, 2, 3) };
          await nextPending.promise;
          return { done: true, value: undefined };
        },
        return: returned,
      }),
    };

    const write = streamingAtomicReplace(filesystem, "write", target, source, {
      byteCap: 100,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(calls).toBe(2));
    controller.abort(new Error("client disconnected"));

    await expect(write).rejects.toMatchObject({
      code: "write-failed",
      cause: expect.objectContaining({ message: "client disconnected" }),
    });
    expect(returned).toHaveBeenCalledOnce();
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expectNoTemporaryFiles(root);
  });

  it("cleans up and does not rename when the source fails", async () => {
    const { root, filesystem } = await createFilesystem();
    const target = filesystem.ownedPath("asset.bin");
    await writeFile(target, "previous");

    await expect(streamingAtomicReplace(filesystem, "write", target, async function* () {
      yield Uint8Array.of(1, 2);
      throw new Error("source failed");
    }(), { byteCap: 100 })).rejects.toMatchObject({
      code: "write-failed",
      cause: expect.objectContaining({ message: "source failed" }),
    });

    expect(await readFile(target, "utf8")).toBe("previous");
    await expectNoTemporaryFiles(root);
  });

  it("cleans up and does not rename after an injected mid-stream write error", async () => {
    let writeCalls = 0;
    const { root, filesystem } = await createFilesystem({
      open: async (path, flags, mode) => {
        const handle = await (await import("node:fs/promises")).open(path, flags, mode);
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "write") {
              return async (...args: Parameters<FileHandle["write"]>) => {
                writeCalls += 1;
                if (writeCalls === 2) throw new Error("injected write failure");
                return target.write(...args);
              };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    const target = filesystem.ownedPath("asset.bin");
    await writeFile(target, "previous");

    await expect(streamingAtomicReplace(filesystem, "write", target, async function* () {
      yield Uint8Array.of(1, 2);
      yield Uint8Array.of(3, 4);
    }(), { byteCap: 100 })).rejects.toMatchObject({ code: "write-failed" });

    expect(await readFile(target, "utf8")).toBe("previous");
    await expectNoTemporaryFiles(root);
  });

  it("stops after 16 exclusive temporary-file collisions", async () => {
    const open = vi.fn(async () => {
      throw Object.assign(new Error("collision"), { code: "EEXIST" });
    });
    const { root, filesystem } = await createFilesystem({ open });

    await expect(streamingAtomicReplace(
      filesystem,
      "write",
      filesystem.ownedPath("asset.bin"),
      async function* () { yield Uint8Array.of(1); }(),
      { byteCap: 100 },
    )).rejects.toMatchObject({ code: "write-failed" });

    expect(open).toHaveBeenCalledTimes(16);
    await expectNoTemporaryFiles(root);
  });

  it("serializes concurrent writes through the verified realpath queue", async () => {
    const firstWriteStarted = deferred();
    const releaseFirstWrite = deferred();
    let delayFirstOpen = true;
    const { root, filesystem: first } = await createFilesystem({
      open: async (path, flags, mode) => {
        const handle = await (await import("node:fs/promises")).open(path, flags, mode);
        if (!delayFirstOpen) return handle;
        delayFirstOpen = false;
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "write") return async (...args: Parameters<FileHandle["write"]>) => {
              firstWriteStarted.resolve();
              await releaseFirstWrite.promise;
              return target.write(...args);
            };
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    const second = await SafeRootFilesystem.create({
      root,
      errors,
      rootLabel: "Test root",
      ownerLabel: "Test",
      recordLabel: "record",
      initializeOperation: "initialize" as const,
    });
    let secondAdvanced = false;
    const firstWrite = streamingAtomicReplace(first, "write", first.ownedPath("first.bin"), async function* () {
      yield Uint8Array.of(1);
    }(), { byteCap: 100 });
    await firstWriteStarted.promise;
    const secondWrite = streamingAtomicReplace(second, "write", second.ownedPath("second.bin"), async function* () {
      secondAdvanced = true;
      yield Uint8Array.of(2);
    }(), { byteCap: 100 });

    await Promise.resolve();
    expect(secondAdvanced).toBe(false);
    releaseFirstWrite.resolve();
    await Promise.all([firstWrite, secondWrite]);
    expect(secondAdvanced).toBe(true);
    await expectNoTemporaryFiles(root);
  });

  it("does not advance the source until the preceding write settles", async () => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    let firstCall = true;
    const { root, filesystem } = await createFilesystem({
      open: async (path, flags, mode) => {
        const handle = await (await import("node:fs/promises")).open(path, flags, mode);
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "write") return async (...args: Parameters<FileHandle["write"]>) => {
              if (firstCall) {
                firstCall = false;
                writeStarted.resolve();
                await releaseWrite.promise;
              }
              return target.write(...args);
            };
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    let advances = 0;
    const write = streamingAtomicReplace(filesystem, "write", filesystem.ownedPath("asset.bin"), async function* () {
      advances += 1;
      yield Uint8Array.of(1);
      advances += 1;
      yield Uint8Array.of(2);
    }(), { byteCap: 100 });

    await writeStarted.promise;
    expect(advances).toBe(1);
    releaseWrite.resolve();
    await write;
    expect(advances).toBe(2);
    await expectNoTemporaryFiles(root);
  });

  it("owns a byte copy before an awaited write can expose caller mutation", async () => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    const { root, filesystem } = await createFilesystem({
      open: async (path, flags, mode) => {
        const handle = await (await import("node:fs/promises")).open(path, flags, mode);
        return new Proxy(handle, {
          get(target, property, receiver) {
            if (property === "write") return async (...args: Parameters<FileHandle["write"]>) => {
              writeStarted.resolve();
              await releaseWrite.promise;
              return target.write(...args);
            };
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    });
    const target = filesystem.ownedPath("asset.bin");
    const callerBytes = Uint8Array.of(1, 2, 3);
    const write = streamingAtomicReplace(filesystem, "write", target, async function* () {
      yield callerBytes;
    }(), { byteCap: 100 });

    await writeStarted.promise;
    callerBytes.fill(9);
    releaseWrite.resolve();
    const result = await write;

    expect(await readFile(target)).toEqual(Buffer.from([1, 2, 3]));
    expect(result.checksum).toBe(createHash("sha256").update(Uint8Array.of(1, 2, 3)).digest("hex"));
    await expectNoTemporaryFiles(root);
  });
});
