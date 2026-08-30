import { randomBytes } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_TEMP_ATTEMPTS = 16;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export interface SafeRootFilesystemOperations {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  open(path: string, flags: number, mode?: number): Promise<FileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export type SafeRootErrorCode = "blocked" | "read-failed" | "write-failed";

export interface SafeRootErrorPolicy<Operation extends string> {
  isError(value: unknown): boolean;
  create(
    operation: Operation,
    code: SafeRootErrorCode,
    message: string,
    cause?: unknown,
  ): Error;
  rethrow(
    operation: Operation,
    code: "read-failed" | "write-failed",
    message: string,
    cause: unknown,
  ): never;
}

export interface SafeRootFilesystemOptions<Operation extends string> {
  root: string;
  operations?: Partial<SafeRootFilesystemOperations>;
  randomToken?: () => string;
  errors: SafeRootErrorPolicy<Operation>;
  /** For example, "Composer compositions root". */
  rootLabel: string;
  /** For example, "Composer". */
  ownerLabel: string;
  /** For example, "composition". */
  recordLabel: string;
  initializeOperation: Operation;
}

export interface SafeRootReadResult {
  text: string;
  stats: Stats;
}

export interface SafeRootTemporaryFile {
  path: string;
  handle: FileHandle;
}

const defaultOperations: SafeRootFilesystemOperations = {
  mkdir: (path, options) => nodeFs.mkdir(path, options),
  lstat: (path) => nodeFs.lstat(path),
  realpath: (path) => nodeFs.realpath(path),
  readdir: (path, options) => nodeFs.readdir(path, options),
  open: (path, flags, mode) => nodeFs.open(path, flags, mode),
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  unlink: (path) => nodeFs.unlink(path),
};

const rootQueues = new Map<string, Promise<void>>();

function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

async function serialized<T>(realRoot: string, task: () => Promise<T>): Promise<T> {
  const previous = rootQueues.get(realRoot) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  rootQueues.set(realRoot, settled);
  void settled.then(() => {
    if (rootQueues.get(realRoot) === settled) rootQueues.delete(realRoot);
  });
  return run;
}

export class SafeRootFilesystem<Operation extends string> {
  private constructor(
    private readonly rootPath: string,
    readonly realRoot: string,
    private readonly rootStats: Stats,
    readonly operations: SafeRootFilesystemOperations,
    private readonly randomToken: () => string,
    private readonly errors: SafeRootErrorPolicy<Operation>,
    private readonly rootLabel: string,
    private readonly ownerLabel: string,
    private readonly recordLabel: string,
  ) {}

  static async create<Operation extends string>(
    options: SafeRootFilesystemOptions<Operation>,
  ): Promise<SafeRootFilesystem<Operation>> {
    const rootPath = resolve(options.root);
    const operations = { ...defaultOperations, ...options.operations };
    try {
      await operations.mkdir(rootPath, { recursive: true });
      const rootStats = await operations.lstat(rootPath);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw options.errors.create(
          options.initializeOperation,
          "blocked",
          `${options.rootLabel} is not a real directory: ${rootPath}`,
        );
      }
      const realRoot = await operations.realpath(rootPath);
      if (!isAbsolute(realRoot)) {
        throw options.errors.create(
          options.initializeOperation,
          "blocked",
          `${options.rootLabel} did not resolve to an absolute path: ${rootPath}`,
        );
      }
      const realStats = await operations.lstat(realRoot);
      if (realStats.isSymbolicLink() || !realStats.isDirectory() || !sameFile(rootStats, realStats)) {
        throw options.errors.create(
          options.initializeOperation,
          "blocked",
          `${options.rootLabel} failed realpath verification: ${rootPath}`,
        );
      }
      return new SafeRootFilesystem(
        rootPath,
        realRoot,
        rootStats,
        operations,
        options.randomToken ?? (() => randomBytes(18).toString("base64url")),
        options.errors,
        options.rootLabel,
        options.ownerLabel,
        options.recordLabel,
      );
    } catch (cause) {
      options.errors.rethrow(
        options.initializeOperation,
        "read-failed",
        `Could not initialize ${options.rootLabel}: ${rootPath}`,
        cause,
      );
    }
  }

  ownedPath(filename: string): string {
    const path = join(this.realRoot, filename);
    this.assertOwnedPath(path);
    return path;
  }

  assertOwnedPath(path: string): void {
    const fromRoot = relative(this.realRoot, path);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
      throw new Error(`Internal ${this.ownerLabel} filename escaped its verified root.`);
    }
  }

  async run<T>(operation: Operation, task: () => Promise<T>): Promise<T> {
    return serialized(this.realRoot, async () => {
      await this.assertRoot(operation);
      return task();
    });
  }

  async assertRoot(operation: Operation): Promise<void> {
    try {
      const current = await this.operations.lstat(this.rootPath);
      if (current.isSymbolicLink() || !current.isDirectory() || !sameFile(current, this.rootStats)) {
        throw this.errors.create(
          operation,
          "blocked",
          `${this.rootLabel} was replaced or is no longer a real directory: ${this.rootPath}`,
        );
      }
      const currentReal = await this.operations.realpath(this.rootPath);
      if (currentReal !== this.realRoot) {
        throw this.errors.create(
          operation,
          "blocked",
          `${this.rootLabel} now resolves outside its verified location: ${this.rootPath}`,
        );
      }
    } catch (cause) {
      if (this.errors.isError(cause)) throw cause;
      throw this.errors.create(
        operation,
        "blocked",
        `Could not verify ${this.rootLabel}: ${this.rootPath}`,
        cause,
      );
    }
  }

  async readFileNoFollow(
    operation: Operation,
    path: string,
  ): Promise<SafeRootReadResult | undefined> {
    await this.assertRoot(operation);
    let before: Stats;
    try {
      before = await this.operations.lstat(path);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return undefined;
      this.errors.rethrow(operation, "read-failed", `Could not inspect ${this.ownerLabel} file: ${basename(path)}`, cause);
    }
    if (before.isSymbolicLink() || !before.isFile()) {
      throw this.errors.create(
        operation,
        "blocked",
        `Refusing to follow or replace non-regular ${this.ownerLabel} path: ${basename(path)}`,
      );
    }

    let handle: FileHandle | undefined;
    try {
      handle = await this.operations.open(path, constants.O_RDONLY | NO_FOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(before, opened)) {
        throw this.errors.create(
          operation,
          "blocked",
          `${this.ownerLabel} file changed while it was being opened: ${basename(path)}`,
        );
      }
      const text = await handle.readFile({ encoding: "utf8" });
      await this.assertRoot(operation);
      return { text, stats: opened };
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return undefined;
      if (errorCode(cause) === "ELOOP") {
        throw this.errors.create(
          operation,
          "blocked",
          `Refusing to follow ${this.ownerLabel} symlink path: ${basename(path)}`,
          cause,
        );
      }
      this.errors.rethrow(operation, "read-failed", `Could not read ${this.ownerLabel} file: ${basename(path)}`, cause);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async assertReplaceablePath(
    operation: Operation,
    path: string,
    expectedStats?: Stats,
  ): Promise<void> {
    try {
      const stats = await this.operations.lstat(path);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw this.errors.create(
          operation,
          "blocked",
          `Refusing to replace non-regular ${this.ownerLabel} path: ${basename(path)}`,
        );
      }
      if (expectedStats !== undefined && !sameFile(stats, expectedStats)) {
        throw this.errors.create(
          operation,
          "blocked",
          `${this.ownerLabel} file changed before it could be migrated: ${basename(path)}`,
        );
      }
    } catch (cause) {
      if (errorCode(cause) === "ENOENT" && expectedStats === undefined) return;
      if (errorCode(cause) === "ENOENT") {
        throw this.errors.create(
          operation,
          "blocked",
          `${this.ownerLabel} file disappeared before it could be migrated: ${basename(path)}`,
          cause,
        );
      }
      this.errors.rethrow(operation, "write-failed", `Could not inspect ${this.ownerLabel} path: ${basename(path)}`, cause);
    }
  }

  async atomicReplace(
    operation: Operation,
    finalPath: string,
    contents: string,
    expectedStats?: Stats,
  ): Promise<void> {
    await this.assertRoot(operation);
    await this.assertReplaceablePath(operation, finalPath, expectedStats);

    let temporaryPath: string | undefined;
    let handle: FileHandle | undefined;
    try {
      const temporary = await this.openTemporaryFile(operation, finalPath);
      handle = temporary.handle;
      temporaryPath = temporary.path;

      await handle.writeFile(contents, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;

      await this.assertRoot(operation);
      await this.assertReplaceablePath(operation, finalPath, expectedStats);
      await this.operations.rename(temporaryPath, finalPath);
      temporaryPath = undefined;
      await this.assertRoot(operation);
    } catch (cause) {
      this.errors.rethrow(operation, "write-failed", `Could not atomically replace ${basename(finalPath)}.`, cause);
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryPath !== undefined) {
        await this.operations.unlink(temporaryPath).catch(() => undefined);
      }
    }
  }

  /** Allocate an owned temporary file for callers implementing atomic writes. */
  async openTemporaryFile(
    operation: Operation,
    finalPath: string,
  ): Promise<SafeRootTemporaryFile> {
    for (let attempt = 0; attempt < MAX_TEMP_ATTEMPTS; attempt += 1) {
      const token = this.randomToken();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
        throw this.errors.create(operation, "blocked", "Temporary filename source returned an unsafe token.");
      }
      const path = this.ownedPath(`.${basename(finalPath)}.${token}.tmp`);
      try {
        const handle = await this.operations.open(
          path,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
          0o600,
        );
        return { path, handle };
      } catch (cause) {
        if (errorCode(cause) === "EEXIST") continue;
        throw cause;
      }
    }
    throw this.errors.create(
      operation,
      "write-failed",
      `Could not allocate an exclusive temporary file for ${basename(finalPath)}.`,
    );
  }

  rethrowAtomicWriteFailure(operation: Operation, finalPath: string, cause: unknown): never {
    this.errors.rethrow(
      operation,
      "write-failed",
      `Could not atomically replace ${basename(finalPath)}.`,
      cause,
    );
  }

  async deleteValidatedPair(
    operation: Operation,
    id: string,
    canonicalPath: string,
    companionPath: string,
    canonicalStats: Stats,
  ): Promise<void> {
    try {
      await this.assertRoot(operation);
      const companionStats = await this.operations.lstat(companionPath).catch((cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return undefined;
        throw cause;
      });
      if (companionStats?.isFile() && !companionStats.isSymbolicLink()) {
        await this.operations.unlink(companionPath);
      }

      await this.assertRoot(operation);
      const currentCanonical = await this.operations.lstat(canonicalPath);
      if (
        currentCanonical.isSymbolicLink()
        || !currentCanonical.isFile()
        || !sameFile(currentCanonical, canonicalStats)
      ) {
        throw this.errors.create(
          operation,
          "blocked",
          `Canonical ${this.recordLabel} changed before deleting id "${id}".`,
        );
      }
      await this.operations.unlink(canonicalPath);
      await this.assertRoot(operation);
    } catch (cause) {
      this.errors.rethrow(
        operation,
        "write-failed",
        `Could not delete ${this.recordLabel} files for id "${id}".`,
        cause,
      );
    }
  }
}
