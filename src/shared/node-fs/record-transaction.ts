import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link as nodeLink } from "node:fs/promises";
import { join } from "node:path";
import { isSafeRecordId } from "../record-identity";
import {
  SafeRootFilesystem,
  errorCode,
  type DurableExtraErrorCode,
  type SafeRootErrorPolicy,
  type SafeRootFilesystemOperations,
} from "./safe-root";
import { commitDocument, syncDirectory, withMutationLock } from "./mutation-lock";

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const POINTER_FILENAME = "current.json";
const GENERATIONS_DIRECTORY = "generations";
const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

/** One record as it is written: an id plus its already-serialized JSON text. */
export interface RecordEnvelope {
  readonly id: string;
  readonly json: string;
}

export interface RecordTransactionContext {
  readonly generation: number;
  readonly mutationToken: string;
  readonly records: readonly RecordEnvelope[];
}

/**
 * The complete next state of the domain. A transaction is expressed as the
 * whole record set rather than a diff so before/after graph validation happens
 * on one value, and so the commit has exactly one outcome for every record.
 */
export interface RecordTransactionPlan<T> {
  readonly records: readonly RecordEnvelope[];
  readonly result: T;
}

export interface RecordTransactionSnapshot {
  readonly schemaVersion: number;
  readonly generation: number;
  readonly mutationToken: string;
  readonly records: readonly RecordEnvelope[];
}

/** Only isolated reproducible generation supplies this; live stores use random tokens. */
export type RecordMutationTokenSource = (next: Omit<RecordTransactionSnapshot, "mutationToken"> & {
  readonly previousMutationToken: string;
}) => string;

interface PointerEntry {
  id: string;
  digest: string;
}

interface Pointer {
  schemaVersion: number;
  generation: number;
  mutationToken: string;
  entries: PointerEntry[];
}

export interface TransactionalRecordStoreOptions<Operation extends string> {
  root: string;
  schemaVersion: number;
  errors: SafeRootErrorPolicy<Operation, DurableExtraErrorCode>;
  /** For example, "Content records root". */
  rootLabel: string;
  /** For example, "Content". */
  ownerLabel: string;
  /** For example, "content record". */
  recordLabel: string;
  operations?: Partial<SafeRootFilesystemOperations & { link: typeof nodeLink }>;
  randomToken?: () => string;
  /** Reproducible generation seam. Must return a new SHA-256-shaped token per commit. */
  newMutationToken?: RecordMutationTokenSource;
  now?: () => string;
  /** Distinct operation names so failures name the phase that produced them. */
  phases: {
    initialize: Operation;
    snapshot: Operation;
    commit: Operation;
  };
}

function digestOf(json: string): string {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function isPointer(value: unknown, schemaVersion: number): value is Pointer {
  if (typeof value !== "object" || value === null) return false;
  const pointer = value as Partial<Pointer>;
  return pointer.schemaVersion === schemaVersion
    && Number.isSafeInteger(pointer.generation) && (pointer.generation as number) >= 0
    && typeof pointer.mutationToken === "string" && /^[a-f0-9]{64}$/.test(pointer.mutationToken)
    && Array.isArray(pointer.entries)
    && pointer.entries.every((entry) =>
      typeof entry === "object" && entry !== null
      && isSafeRecordId((entry as PointerEntry).id)
      && /^[a-f0-9]{64}$/.test((entry as PointerEntry).digest));
}

/**
 * Multi-record store whose transactions commit or fail whole.
 *
 * A generation directory is a complete, immutable copy of every record. A
 * transaction stages the next generation beside the live one and then swaps a
 * single pointer document with one atomic rename, so the visible record set
 * moves from the whole before-state to the whole after-state in one step. An
 * unchanged record is hard-linked rather than rewritten, so the copy costs one
 * link per untouched record.
 *
 * Failure modes:
 *
 * - Any failure before the pointer rename (validation, write, fsync, crash)
 *   leaves an orphan generation directory that no pointer names. The live
 *   record set is byte-identical to the before-state — no partial records are
 *   ever visible — and the orphan is purged by the next commit.
 * - A failure of the post-rename directory fsync is reported as
 *   `commit-uncertain`: the pointer may or may not survive a power loss. The
 *   mutation lock is retained so the next mutation fails closed, and recovery
 *   is a human reading `current.json` — never a blind retry.
 * - A crash after the commit but before pruning leaves older generation
 *   directories on disk. They are unreferenced and harmless, and the next
 *   commit purges them.
 * - A lock left by a dead process fails every mutation closed with `conflict`.
 *   Reads keep working; removing `.mutation.lock` is a deliberate human act.
 */
export class TransactionalRecordStore<Operation extends string> {
  private constructor(
    private readonly filesystem: SafeRootFilesystem<Operation, DurableExtraErrorCode>,
    private readonly generationsDirectory: string,
    private readonly schemaVersion: number,
    private readonly phases: TransactionalRecordStoreOptions<Operation>["phases"],
    private readonly now: () => string,
    private readonly link: typeof nodeLink,
    private readonly newMutationToken: RecordMutationTokenSource,
  ) {}

  static async create<Operation extends string>(
    options: TransactionalRecordStoreOptions<Operation>,
  ): Promise<TransactionalRecordStore<Operation>> {
    const { link, ...fileOperations } = options.operations ?? {};
    const filesystem = await SafeRootFilesystem.create<Operation, DurableExtraErrorCode>({
      root: options.root,
      operations: fileOperations,
      randomToken: options.randomToken,
      errors: options.errors,
      rootLabel: options.rootLabel,
      ownerLabel: options.ownerLabel,
      recordLabel: options.recordLabel,
      initializeOperation: options.phases.initialize,
    });
    const generationsDirectory = filesystem.ownedPath(GENERATIONS_DIRECTORY);
    try {
      await filesystem.operations.mkdir(generationsDirectory, { recursive: true });
      const stats = await filesystem.operations.lstat(generationsDirectory);
      const realPath = await filesystem.operations.realpath(generationsDirectory);
      if (stats.isSymbolicLink() || !stats.isDirectory() || realPath !== generationsDirectory) {
        throw options.errors.create(
          options.phases.initialize,
          "blocked",
          `${options.ownerLabel} generations directory is not a real owned directory.`,
        );
      }
    } catch (cause) {
      options.errors.rethrow(
        options.phases.initialize,
        "read-failed",
        `Could not initialize ${options.ownerLabel} generation storage.`,
        cause,
      );
    }
    return new TransactionalRecordStore(
      filesystem,
      generationsDirectory,
      options.schemaVersion,
      options.phases,
      options.now ?? (() => new Date().toISOString()),
      link ?? nodeLink,
      options.newMutationToken ?? (() => randomBytes(32).toString("hex")),
    );
  }

  get root(): string {
    return this.filesystem.realRoot;
  }

  snapshot(): Promise<RecordTransactionSnapshot> {
    return this.filesystem.run(this.phases.snapshot, () => this.read(this.phases.snapshot));
  }

  async mutationToken(): Promise<string> {
    return (await this.snapshot()).mutationToken;
  }

  /**
   * Apply one whole transaction.
   *
   * `plan` receives the entire before-state read under both the in-process
   * queue and the cross-process lock, and returns the entire after-state. It
   * is the only place a domain validates its graph, and throwing from it
   * writes nothing at all.
   */
  commit<T>(
    plan: (context: RecordTransactionContext) => Promise<RecordTransactionPlan<T>> | RecordTransactionPlan<T>,
    options: { expectedMutationToken?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    const operation = this.phases.commit;
    return this.filesystem.run(operation, () =>
      withMutationLock(
        this.filesystem,
        operation,
        { now: this.now, preflightDirectories: [this.filesystem.realRoot, this.generationsDirectory] },
        async () => {
          const before = await this.read(operation);
          options.signal?.throwIfAborted();
          if (options.expectedMutationToken !== undefined && options.expectedMutationToken !== before.mutationToken) {
            throw this.filesystem.errors.create(
              operation,
              "conflict",
              `${this.filesystem.ownerLabel} changed; reload before retrying.`,
            );
          }
          const planned = await plan(before);
          this.assertPlan(operation, planned.records);
          const pointer = await this.stage(operation, before, planned.records, options.signal);
          await commitDocument(
            this.filesystem,
            operation,
            this.filesystem.ownedPath(POINTER_FILENAME),
            `${JSON.stringify(pointer, null, 2)}\n`,
            {
              signal: options.signal,
              uncertainMessage: `${this.filesystem.ownerLabel} pointer rename completed but directory durability is uncertain. Inspect ${POINTER_FILENAME} and the retained lock before recovery; do not retry blindly.`,
            },
          );
          await this.prune(pointer.generation);
          return planned.result;
        },
      ));
  }

  private assertPlan(operation: Operation, records: readonly RecordEnvelope[]): void {
    const seen = new Set<string>();
    for (const record of records) {
      if (!isSafeRecordId(record.id)) {
        throw this.filesystem.errors.create(
          operation,
          "blocked",
          `${this.filesystem.ownerLabel} transaction contains a record id that is not a stable path-safe id.`,
        );
      }
      if (seen.has(record.id)) {
        throw this.filesystem.errors.create(
          operation,
          "blocked",
          `${this.filesystem.ownerLabel} transaction names ${this.filesystem.ownerLabel} id "${record.id}" twice.`,
        );
      }
      seen.add(record.id);
      if (typeof record.json !== "string") {
        throw this.filesystem.errors.create(
          operation,
          "blocked",
          `${this.filesystem.ownerLabel} transaction record "${record.id}" is not serialized JSON text.`,
        );
      }
    }
  }

  private generationPath(generation: number): string {
    return join(this.generationsDirectory, String(generation));
  }

  private recordPath(generation: number, id: string): string {
    const path = join(this.generationPath(generation), `${id}.json`);
    this.filesystem.assertOwnedPath(path);
    return path;
  }

  /**
   * Read the live generation.
   *
   * A writer in another process may commit and prune between reading the
   * pointer and reading the records it names, which makes those files vanish
   * mid-read. That is a moved snapshot, not corruption, so the pointer is
   * re-read and the whole read is retried; only an unchanged pointer whose
   * records are missing or mismatched is a genuine recovery case.
   */
  private async read(operation: Operation): Promise<RecordTransactionSnapshot> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pointer = await this.readPointer(operation);
      if (pointer === undefined) {
        return { schemaVersion: this.schemaVersion, generation: 0, mutationToken: "0".repeat(64), records: [] };
      }
      const records = await this.readRecords(operation, pointer);
      if (records !== undefined) {
        return {
          schemaVersion: pointer.schemaVersion,
          generation: pointer.generation,
          mutationToken: pointer.mutationToken,
          records,
        };
      }
      const current = await this.readPointer(operation);
      if (current !== undefined && current.generation === pointer.generation) {
        throw this.filesystem.errors.create(
          operation,
          "blocked",
          `A ${this.filesystem.recordLabel} named by ${POINTER_FILENAME} is missing or does not match its digest. Explicit recovery is required.`,
        );
      }
    }
    throw this.filesystem.errors.create(
      operation,
      "conflict",
      `${this.filesystem.ownerLabel} records changed repeatedly during snapshot capture. Retry.`,
    );
  }

  private async readPointer(operation: Operation): Promise<Pointer | undefined> {
    await this.filesystem.assertRoot(operation);
    const file = await this.filesystem.readFileNoFollow(operation, this.filesystem.ownedPath(POINTER_FILENAME));
    if (file === undefined) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      /* Preserved on disk for manual recovery. */
    }
    if (!isPointer(raw, this.schemaVersion)) {
      throw this.filesystem.errors.create(
        operation,
        "blocked",
        `${this.filesystem.ownerLabel} ${POINTER_FILENAME} is malformed or uses an unsupported schema. Records are preserved; explicit recovery is required.`,
      );
    }
    return raw;
  }

  /** Undefined when the named generation is no longer completely readable. */
  private async readRecords(operation: Operation, pointer: Pointer): Promise<RecordEnvelope[] | undefined> {
    const records: RecordEnvelope[] = [];
    for (const entry of pointer.entries) {
      const record = await this.filesystem.readFileNoFollow(operation, this.recordPath(pointer.generation, entry.id));
      if (record === undefined || digestOf(record.text) !== entry.digest) return undefined;
      records.push({ id: entry.id, json: record.text });
    }
    return records;
  }

  /**
   * Write the whole next generation beside the live one. Nothing written here
   * is reachable until the pointer swap, so a failure at any point is a
   * complete no-op for readers.
   */
  private async stage(
    operation: Operation,
    before: RecordTransactionSnapshot,
    records: readonly RecordEnvelope[],
    signal: AbortSignal | undefined,
  ): Promise<Pointer> {
    if (before.generation >= MAX_GENERATION) {
      throw this.filesystem.errors.create(
        operation,
        "write-failed",
        `${this.filesystem.ownerLabel} generation numbering is exhausted.`,
      );
    }
    const generation = before.generation + 1;
    const ordered = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const mutationToken = this.newMutationToken({ schemaVersion: this.schemaVersion, generation, previousMutationToken: before.mutationToken, records: structuredClone(ordered) });
    if (typeof mutationToken !== "string" || mutationToken.length !== 64 || !/^[a-f0-9]{64}$/.test(mutationToken) || mutationToken === before.mutationToken) {
      throw this.filesystem.errors.create(operation, "write-failed", `${this.filesystem.ownerLabel} mutation token source must return a new SHA-256-shaped token.`);
    }
    const directory = this.generationPath(generation);
    await this.purgeGeneration(generation);
    try {
      await this.filesystem.operations.mkdir(directory, { recursive: true });
    } catch (cause) {
      this.filesystem.errors.rethrow(
        operation,
        "write-failed",
        `Could not stage the next ${this.filesystem.ownerLabel} generation.`,
        cause,
      );
    }

    const carryForward = new Map(before.records.map((record) => [record.id, digestOf(record.json)]));
    const entries: PointerEntry[] = [];
    try {
      for (const record of ordered) {
        signal?.throwIfAborted();
        const digest = digestOf(record.json);
        const path = this.recordPath(generation, record.id);
        if (carryForward.get(record.id) === digest) {
          await this.link(this.recordPath(before.generation, record.id), path);
        } else {
          const handle = await this.filesystem.operations.open(
            path,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
            0o600,
          );
          try {
            await handle.writeFile(record.json, { encoding: "utf8" });
            await handle.sync();
          } finally {
            await handle.close().catch(() => undefined);
          }
        }
        entries.push({ id: record.id, digest });
      }
      await syncDirectory(this.filesystem, operation, directory);
      await syncDirectory(this.filesystem, operation, this.generationsDirectory);
    } catch (cause) {
      // Removing the staged generation is housekeeping; it must never replace
      // the failure that caused it.
      await this.purgeGeneration(generation).catch(() => undefined);
      this.filesystem.errors.rethrow(
        operation,
        "write-failed",
        `Could not stage the next ${this.filesystem.ownerLabel} generation.`,
        cause,
      );
    }
    return {
      schemaVersion: this.schemaVersion,
      generation,
      mutationToken,
      entries,
    };
  }

  /** Best effort: unreferenced generations are invisible, never incorrect. */
  private async prune(liveGeneration: number): Promise<void> {
    try {
      const entries = await this.filesystem.operations.readdir(this.generationsDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === String(liveGeneration)) continue;
        if (!/^\d+$/.test(entry.name)) continue;
        await this.purgeGeneration(Number(entry.name));
      }
    } catch {
      /* Stale generations cost disk, never correctness. */
    }
  }

  private async purgeGeneration(generation: number): Promise<void> {
    const directory = this.generationPath(generation);
    this.filesystem.assertOwnedPath(directory);
    let stats;
    try {
      stats = await this.filesystem.operations.lstat(directory);
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return;
      throw cause;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw this.filesystem.errors.create(
        this.phases.commit,
        "blocked",
        `${this.filesystem.ownerLabel} generation path is not a real directory: ${generation}`,
      );
    }
    const real = await this.filesystem.operations.realpath(directory);
    if (real !== directory) {
      throw this.filesystem.errors.create(
        this.phases.commit,
        "blocked",
        `${this.filesystem.ownerLabel} generation directory failed realpath verification: ${generation}`,
      );
    }
    for (const entry of await this.filesystem.operations.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      this.filesystem.assertOwnedPath(path);
      const current = await this.filesystem.operations.lstat(path);
      if (current.isSymbolicLink() || !current.isFile()) {
        throw this.filesystem.errors.create(
          this.phases.commit,
          "blocked",
          `Refusing to remove a non-regular ${this.filesystem.ownerLabel} generation entry: ${entry.name}`,
        );
      }
      await this.filesystem.operations.unlink(path);
    }
    await this.filesystem.operations.rmdir(directory);
    const remaining = await this.filesystem.operations
      .lstat(directory)
      .then(() => true, () => false);
    if (remaining) {
      throw this.filesystem.errors.create(
        this.phases.commit,
        "write-failed",
        `Could not remove the ${this.filesystem.ownerLabel} generation directory: ${generation}`,
      );
    }
  }
}

export function createTransactionalRecordStore<Operation extends string>(
  options: TransactionalRecordStoreOptions<Operation>,
): Promise<TransactionalRecordStore<Operation>> {
  return TransactionalRecordStore.create(options);
}
