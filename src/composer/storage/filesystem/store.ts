import type { Stats } from "node:fs";
import { basename } from "node:path";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  compareCompositionSummariesNewestFirst,
  isSafeCompositionRecordId,
  loadCompositionRecord,
  summarizeComposition,
  validateCompositionRecord,
  type CompositionLoadOutcome,
  type CompositionLifecycleStore,
  type CompositionDerivedOutputOutcome,
  type CompositionDerivedOutputRecordOutcome,
  type CompositionDependent,
  type CompositionDeleteOutcome,
  type CompositionPersistenceOperation,
  type CompositionRecord,
  type CompositionSaveOutcome,
  type CompositionSummary,
  type CompositionUnpublishOutcome,
} from "../../library";
import { cloneJson } from "../../../shared/json";
import { SafeRootFilesystem } from "../../../shared/node-fs";
import type {
  FilesystemCompositionStoreOptions,
  FilesystemDerivedOutputPlan,
  FilesystemDerivedOutputRequest,
} from "./types";

const JSON_SUFFIX = ".composition.json";
const JSX_SUFFIX = ".tsx";
const OWNED_JSON_PATTERN = /^composition-([a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?)\.composition\.json$/;
function errorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function operationError(
  operation: CompositionPersistenceOperation,
  code: "blocked" | "validation" | "read-failed" | "write-failed" | "conflict",
  message: string,
  cause?: unknown,
): CompositionPersistenceError {
  return new CompositionPersistenceError(
    operation,
    code,
    message,
    code === "read-failed" || code === "write-failed" || code === "conflict",
    cause === undefined ? undefined : { cause },
  );
}

function rethrow(
  operation: CompositionPersistenceOperation,
  code: "read-failed" | "write-failed",
  message: string,
  cause: unknown,
): never {
  if (cause instanceof CompositionPersistenceError) throw cause;
  throw operationError(operation, code, message, cause);
}

interface CanonicalResult {
  outcome: CompositionLoadOutcome;
  stats: Stats;
}

interface ClosureEntry {
  id: string;
  outcome: CompositionLoadOutcome;
  /** Undefined only for a new put record that is not on disk yet. */
  stats?: Stats;
}

/**
 * A same-provider snapshot read before entering the root queue. The snapshot
 * is checked again under that queue before any mutation, so a browser planning
 * round can never make us write against a different canonical dependency.
 */
interface DependencyClosure {
  entries: readonly ClosureEntry[];
  byId: ReadonlyMap<string, ClosureEntry>;
  records: readonly CompositionRecord[];
}

export class FilesystemCompositionStore implements CompositionLifecycleStore {
  readonly provider = COMPOSITION_PROVIDERS.files;

  private constructor(
    private readonly filesystem: SafeRootFilesystem<CompositionPersistenceOperation>,
    private readonly provideJsx: FilesystemCompositionStoreOptions["provideJsx"],
    private readonly now: () => string,
  ) {}

  private get operations() {
    return this.filesystem.operations;
  }

  private get realRoot(): string {
    return this.filesystem.realRoot;
  }

  static async create(
    options: FilesystemCompositionStoreOptions,
  ): Promise<FilesystemCompositionStore> {
    const filesystem = await SafeRootFilesystem.create({
      root: options.compositionsRoot,
      operations: options.operations,
      randomToken: options.randomToken,
      errors: {
        isError: (value): value is CompositionPersistenceError => value instanceof CompositionPersistenceError,
        create: operationError,
        rethrow,
      },
      rootLabel: "Composer compositions root",
      ownerLabel: "Composer",
      recordLabel: "composition",
      initializeOperation: "initialize",
    });
    return new FilesystemCompositionStore(
      filesystem,
      options.provideJsx,
      options.now ?? (() => new Date().toISOString()),
    );
  }

  async list(): Promise<readonly CompositionSummary[]> {
    const closure = await this.loadDependencyClosure("list");
    const currentClosure = closure;
    const targetIds = currentClosure.records.map((record) => record.id);
    const plans = await this.prepareDerivedOutputs("list", currentClosure, targetIds);

    return this.run("list", async () => {
      await this.assertClosureUnchanged("list", currentClosure);
      const outputs = await this.applyDerivedOutputs("list", currentClosure, plans, targetIds);
      return currentClosure.records
        .map((record) => ({
          ...summarizeComposition(record),
          ...(outputs.get(record.id) === undefined ? {} : { derivedOutput: outputs.get(record.id) }),
        }))
        .sort(compareCompositionSummariesNewestFirst);
    });
  }

  async get(id: string): Promise<CompositionLoadOutcome> {
    this.assertSafeId("get", id);
    const closure = await this.loadDependencyClosure("get");
    const target = closure.byId.get(id)?.outcome;
    if (target === undefined) {
      // The closure intentionally skips symlinks; a direct get must still
      // report a hostile canonical path rather than pretending it is absent.
      await this.readCanonical("get", id);
      return { status: "not-found", id };
    }
    if (target.status !== "loaded") return target;

    const currentClosure = closure;
    const current = currentClosure.byId.get(id)?.outcome;
    if (current?.status !== "loaded") return current ?? { status: "not-found", id };
    const targetIds = this.outputTargetsForGet(current.record, currentClosure);
    const plans = await this.prepareDerivedOutputs("get", currentClosure, targetIds);
    return this.run("get", async () => {
      await this.assertClosureUnchanged("get", currentClosure);
      const outputs = await this.applyDerivedOutputs("get", currentClosure, plans, targetIds);
      return {
        ...current,
        ...(outputs.get(id) === undefined ? {} : { derivedOutput: outputs.get(id) }),
      };
    });
  }

  /**
   * Stores canonical JSON first and derived JSX second. Supplying `jsx`
   * preserves an already-generated exact production result; otherwise the
   * injected provider is called.
   */
  async put(record: CompositionRecord, jsx?: string): Promise<CompositionSaveOutcome> {
    const validation = validateCompositionRecord(record);
    if (!validation.ok) {
      throw operationError("put", "validation", validation.issue.message);
    }
    if (jsx !== undefined && typeof jsx !== "string") {
      throw operationError("put", "validation", "Generated JSX must be a string.");
    }
    const snapshot = cloneJson(validation.record);
    const snapshotValidation = validateCompositionRecord(snapshot);
    if (!snapshotValidation.ok) {
      throw operationError("put", "validation", snapshotValidation.issue.message);
    }
    const id = snapshotValidation.record.id;
    const canonical = `${JSON.stringify(snapshotValidation.record, null, 2)}\n`;

    const closure = await this.loadDependencyClosure("put", snapshotValidation.record);
    const targetIds = jsx === undefined ? closure.records.map((candidate) => candidate.id) : [id];
    const plans = jsx === undefined
      ? await this.prepareDerivedOutputs("put", closure, targetIds)
      : new Map<string, FilesystemDerivedOutputPlan>([[id, { status: "generated", code: jsx }]]);

    return this.run("put", async () => {
      await this.assertClosureUnchanged("put", closure, new Set([id]));
      await this.assertBindingTransition(snapshotValidation.record);
      await this.filesystem.atomicReplace("put", this.jsonPath(id), canonical);
      const outputs = await this.applyDerivedOutputs("put", closure, plans, targetIds);
      return {
        canonical: { status: "saved" },
        derived: this.summarizeDerivedOutputs(outputs, targetIds),
      };
    });
  }

  async delete(id: string): Promise<boolean> {
    const outcome = await this.deleteWithDependencyCheck(id);
    return outcome.status === "deleted";
  }

  /**
   * The root queue serializes every Composer-managed filesystem operation.
   * The binding scan deliberately happens inside that queue and immediately
   * before the source pair is removed, so normal UI saves cannot interleave a
   * new consumer between a helpful preflight and the destructive write.
   */
  async deleteWithDependencyCheck(id: string): Promise<CompositionDeleteOutcome> {
    this.assertSafeId("delete", id);
    return this.run("delete", async () => {
      const canonical = await this.readCanonical("delete", id);
      if (canonical === undefined) return { status: "not-found" };
      if (canonical.outcome.status !== "loaded") {
        throw operationError(
          "delete",
          "validation",
          `Canonical composition JSON is invalid for id "${id}"; no files were deleted.`,
        );
      }
      if (canonical.outcome.record.document.publication?.kind === "global-template") {
        const dependents = await this.findDependents("delete", id);
        if (dependents.length > 0) return { status: "blocked", dependents };
      }
      await this.deleteValidatedPair("delete", id, canonical.stats);
      return { status: "deleted" };
    });
  }

  /**
   * Clear only the source role after a final serialized dependency scan. JSX
   * is prepared and replaced before canonical JSON so an injected output
   * failure cannot detach the source record's publication metadata.
   */
  async unpublishWithDependencyCheck(id: string): Promise<CompositionUnpublishOutcome> {
    this.assertSafeId("put", id);
    return this.run("put", async () => {
      const canonical = await this.readCanonical("put", id);
      if (canonical === undefined) return { status: "not-found" };
      if (canonical.outcome.status !== "loaded") {
        throw operationError(
          "put",
          "validation",
          `Canonical composition JSON is invalid for id "${id}"; it was preserved.`,
        );
      }
      const source = canonical.outcome.record;
      if (source.document.publication === undefined) return { status: "not-published" };
      if (source.document.publication.kind === "global-template") {
        const dependents = await this.findDependents("put", id);
        if (dependents.length > 0) return { status: "blocked", dependents };
      }

      const document = cloneJson(source.document);
      delete document.publication;
      const next: CompositionRecord = {
        ...source,
        updatedAt: this.now(),
        document,
      };
      const validation = validateCompositionRecord(next);
      if (!validation.ok) throw operationError("put", "validation", validation.issue.message);
      const snapshot = cloneJson(validation.record);
      const productionJsx = await this.getProductionJsx("put", snapshot);
      await this.filesystem.atomicReplace("put", this.jsxPath(id), productionJsx);
      await this.filesystem.atomicReplace("put", this.jsonPath(id), `${JSON.stringify(snapshot, null, 2)}\n`, canonical.stats);
      return { status: "unpublished" };
    });
  }

  /**
   * A detach must not clear a binding in canonical JSON until its derived JSX
   * has been prepared and durably replaced. A later JSON replacement failure
   * can leave stale derived output, but preserves the old canonical binding;
   * the normal read repair will reconcile that artifact on retry.
   */
  async saveLifecycleRecord(record: CompositionRecord): Promise<void> {
    const validation = validateCompositionRecord(record);
    if (!validation.ok) throw operationError("put", "validation", validation.issue.message);
    const snapshot = cloneJson(validation.record);
    const snapshotValidation = validateCompositionRecord(snapshot);
    if (!snapshotValidation.ok) throw operationError("put", "validation", snapshotValidation.issue.message);
    const id = snapshotValidation.record.id;
    const canonical = `${JSON.stringify(snapshotValidation.record, null, 2)}\n`;

    await this.run("put", async () => {
      const current = await this.readCanonical("put", id);
      if (current === undefined) {
        throw operationError(
          "put",
          "blocked",
          `Canonical consumer "${id}" disappeared before its lifecycle update could be saved.`,
        );
      }
      if (current.outcome.status !== "loaded") {
        throw operationError(
          "put",
          "validation",
          `Canonical consumer "${id}" is invalid; its lifecycle update was not attempted.`,
        );
      }
      const productionJsx = await this.getProductionJsx("put", snapshotValidation.record);
      await this.filesystem.atomicReplace("put", this.jsxPath(id), productionJsx);
      await this.filesystem.atomicReplace("put", this.jsonPath(id), canonical, current.stats);
    });
  }

  async clear(): Promise<void> {
    await this.run("clear", async () => {
      let entries;
      try {
        entries = await this.operations.readdir(this.realRoot, { withFileTypes: true });
        await this.filesystem.assertRoot("clear");
      } catch (cause) {
        rethrow("clear", "read-failed", "Could not inspect Composer composition files.", cause);
      }

      const records: Array<{ id: string; stats: Stats; record: CompositionRecord }> = [];
      for (const entry of entries.sort(compareNames)) {
        const match = OWNED_JSON_PATTERN.exec(entry.name);
        if (!match || entry.isSymbolicLink() || !entry.isFile()) continue;
        const id = match[1]!;
        const canonical = await this.readCanonical("clear", id);
        if (canonical === undefined) continue;
        if (canonical.outcome.status !== "loaded") {
          throw operationError(
            "clear",
            "validation",
            `Canonical composition JSON is invalid for id "${id}"; no files were deleted.`,
          );
        }
        records.push({ id, stats: canonical.stats, record: canonical.outcome.record });
      }

      for (const source of records) {
        if (source.record.document.publication?.kind !== "global-template") continue;
        const hasDependent = records.some((candidate) =>
          candidate.id !== source.id && candidate.record.document.binding?.sourceRecordId === source.id,
        );
        if (hasDependent) {
          throw operationError(
            "clear",
            "blocked",
            "Cannot clear Composer compositions while a Global template still has bound consumers. Detach or remove bindings individually first.",
          );
        }
      }

      for (const record of records) {
        const current = await this.readCanonical("clear", record.id);
        if (
          current === undefined ||
          current.outcome.status !== "loaded" ||
          !sameFile(current.stats, record.stats)
        ) {
          throw operationError(
            "clear",
            "blocked",
            `Canonical composition changed while clearing id "${record.id}"; remaining files were preserved.`,
          );
        }
        await this.deleteValidatedPair("clear", record.id, current.stats);
      }
    });
  }

  /**
   * Read every same-provider canonical record before acquiring the root queue.
   * This deliberately performs no migration or derived write: browser planning
   * can take a network round trip, and holding the queue across that boundary
   * would deadlock if a caller tried to re-enter list/get for a dependency.
   */
  private async loadDependencyClosure(
    operation: CompositionPersistenceOperation,
    replacing?: CompositionRecord,
  ): Promise<DependencyClosure> {
    let directoryEntries;
    try {
      directoryEntries = await this.operations.readdir(this.realRoot, { withFileTypes: true });
      await this.filesystem.assertRoot(operation);
    } catch (cause) {
      rethrow(operation, "read-failed", "Could not read Composer canonical records for output planning.", cause);
    }

    const entries: ClosureEntry[] = [];
    for (const entry of directoryEntries.sort(compareNames)) {
      const match = OWNED_JSON_PATTERN.exec(entry.name);
      if (!match || entry.isSymbolicLink() || !entry.isFile()) continue;
      const canonical = await this.readCanonical(operation, match[1]!);
      if (canonical !== undefined) entries.push({ id: match[1]!, outcome: canonical.outcome, stats: canonical.stats });
    }

    if (replacing !== undefined) {
      const existing = entries.find((entry) => entry.id === replacing.id);
      const replacement: ClosureEntry = {
        id: replacing.id,
        outcome: { status: "loaded", record: cloneJson(replacing) },
        stats: existing?.stats,
      };
      const index = entries.findIndex((entry) => entry.id === replacing.id);
      if (index === -1) entries.push(replacement);
      else entries[index] = replacement;
    }

    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const records = entries
      .map((entry) => entry.outcome)
      .filter((outcome): outcome is Extract<CompositionLoadOutcome, { status: "loaded" }> => outcome.status === "loaded")
      .map((outcome) => cloneJson(outcome.record));
    return { entries, byId, records };
  }

  private async assertClosureUnchanged(
    operation: CompositionPersistenceOperation,
    closure: DependencyClosure,
    mutableIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    let directoryEntries;
    try {
      directoryEntries = await this.operations.readdir(this.realRoot, { withFileTypes: true });
    } catch (cause) {
      rethrow(operation, "read-failed", "Could not verify Composer canonical records before writing derived output.", cause);
    }
    const knownIds = new Set(closure.entries.map((entry) => entry.id));
    for (const directoryEntry of directoryEntries) {
      const match = OWNED_JSON_PATTERN.exec(directoryEntry.name);
      if (!match || directoryEntry.isSymbolicLink() || !directoryEntry.isFile()) continue;
      if (!knownIds.has(match[1]!)) {
        throw operationError(
          operation,
          "conflict",
          `Canonical composition appeared while derived output was being planned: ${match[1]}. Retry the operation.`,
        );
      }
    }
    for (const entry of closure.entries) {
      if (mutableIds.has(entry.id)) continue;
      const current = await this.operations.lstat(this.jsonPath(entry.id)).catch((cause: unknown) => {
        if (errorCode(cause) === "ENOENT") return undefined;
        throw cause;
      });
      const known = entry.stats;
      if (
        (known === undefined && current !== undefined)
        || (known !== undefined && (
          current === undefined
          || current.isSymbolicLink()
          || !current.isFile()
          || !sameFile(current, known)
        ))
      ) {
        throw operationError(
          operation,
          "conflict",
          `Canonical composition changed while derived output was being planned: ${entry.id}. Retry the operation.`,
        );
      }
    }
    await this.filesystem.assertRoot(operation);
  }

  private async assertBindingTransition(next: CompositionRecord): Promise<void> {
    const binding = next.document.binding;
    if (binding === undefined) return;

    const previous = await this.readCanonical("put", next.id);
    if (previous !== undefined && previous.outcome.status !== "loaded") {
      throw operationError("put", "validation", "The existing consumer record is invalid and cannot change bindings safely.");
    }
    const priorBinding = previous?.outcome.status === "loaded" ? previous.outcome.record.document.binding : undefined;
    if (
      priorBinding?.sourceRecordId === binding.sourceRecordId
      && priorBinding.outletId === binding.outletId
    ) {
      return;
    }
    if (binding.sourceRecordId === next.id) {
      throw operationError("put", "conflict", "A Composition cannot bind to itself as a Global template.");
    }

    const source = await this.readCanonical("put", binding.sourceRecordId);
    if (source === undefined) {
      throw operationError("put", "conflict", "The selected Global template is no longer available.");
    }
    if (
      source.outcome.status !== "loaded"
      || source.outcome.record.document.binding !== undefined
      || source.outcome.record.document.publication?.kind !== "global-template"
      || source.outcome.record.document.publication.outlet.id !== binding.outletId
    ) {
      throw operationError("put", "conflict", "The selected Global template changed before this consumer could be saved.");
    }
  }

  private outputTargetsForGet(record: CompositionRecord, closure: DependencyClosure): string[] {
    const ids = new Set<string>();
    const binding = record.document.binding;
    if (binding !== undefined) ids.add(binding.sourceRecordId);
    ids.add(record.id);
    // A missing source cannot be included in `records`, but its not-found
    // outcome still reaches the pure planner through `sourceOutcomes`.
    return [...ids].filter((id) => id === record.id || closure.byId.has(id));
  }

  private makeOutputRequest(
    closure: DependencyClosure,
    targetIds: readonly string[],
  ): FilesystemDerivedOutputRequest {
    return {
      records: closure.records.map((record) => cloneJson(record)),
      sourceOutcomes: closure.entries.map((entry) => ({
        id: entry.id,
        outcome: cloneJson(entry.outcome),
      })),
      targetIds: [...targetIds],
    };
  }

  private async prepareDerivedOutputs(
    operation: CompositionPersistenceOperation,
    closure: DependencyClosure,
    targetIds: readonly string[],
  ): Promise<Map<string, FilesystemDerivedOutputPlan>> {
    const request = this.makeOutputRequest(closure, targetIds);
    const records = new Map(closure.records.map((record) => [record.id, record]));
    const plans = new Map<string, FilesystemDerivedOutputPlan>();
    for (const id of targetIds) {
      const record = records.get(id);
      if (record === undefined) continue;
      let supplied: string | FilesystemDerivedOutputPlan;
      try {
        supplied = await this.provideJsx(cloneJson(record), request);
      } catch (cause) {
        rethrow(
          operation,
          "write-failed",
          `Could not obtain derived output for composition "${record.id}".`,
          cause,
        );
      }
      if (typeof supplied === "string") {
        plans.set(id, { status: "generated", code: supplied });
      } else if (supplied.status === "generated" && typeof supplied.code === "string") {
        plans.set(id, { status: "generated", code: supplied.code });
      } else if (supplied.status === "blocked" && typeof supplied.reason === "string" && supplied.reason.trim() !== "") {
        plans.set(id, { status: "blocked", reason: supplied.reason });
      } else {
        throw operationError(
          operation,
          "write-failed",
          `Derived-output planner returned an invalid result for composition "${record.id}".`,
        );
      }
    }
    return plans;
  }

  private orderedOutputIds(
    targetIds: readonly string[],
    closure: DependencyClosure,
  ): readonly string[] {
    const position = new Map(targetIds.map((id, index) => [id, index]));
    return [...targetIds].sort((a, b) => {
      const aRecord = closure.records.find((record) => record.id === a);
      const bRecord = closure.records.find((record) => record.id === b);
      const aConsumer = aRecord?.document.binding !== undefined;
      const bConsumer = bRecord?.document.binding !== undefined;
      if (aConsumer !== bConsumer) return aConsumer ? 1 : -1;
      return (position.get(a) ?? 0) - (position.get(b) ?? 0);
    });
  }

  private async applyDerivedOutputs(
    operation: CompositionPersistenceOperation,
    closure: DependencyClosure,
    plans: ReadonlyMap<string, FilesystemDerivedOutputPlan>,
    targetIds: readonly string[],
  ): Promise<Map<string, CompositionDerivedOutputRecordOutcome>> {
    const outcomes = new Map<string, CompositionDerivedOutputRecordOutcome>();
    for (const id of this.orderedOutputIds(targetIds, closure)) {
      const plan = plans.get(id);
      if (plan === undefined) continue;
      const path = this.jsxPath(id);
      if (plan.status === "blocked") {
        outcomes.set(id, await this.blockDerivedOutput(operation, id, path, plan.reason));
        continue;
      }

      try {
        const existing = await this.filesystem.readFileNoFollow(operation, path);
        if (existing?.text === plan.code) {
          outcomes.set(id, { recordId: id, status: "current" });
          continue;
        }
        await this.filesystem.atomicReplace(operation, path, plan.code);
        outcomes.set(id, { recordId: id, status: "repaired" });
      } catch (cause) {
        const reason = `Generated output could not be written: ${cause instanceof Error ? cause.message : "unknown filesystem error"}`;
        outcomes.set(id, await this.blockDerivedOutput(operation, id, path, reason));
      }
    }
    return outcomes;
  }

  private async blockDerivedOutput(
    operation: CompositionPersistenceOperation,
    id: string,
    path: string,
    reason: string,
  ): Promise<CompositionDerivedOutputRecordOutcome> {
    try {
      const existing = await this.operations.lstat(path);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        return {
          recordId: id,
          status: "blocked",
          reason,
          staleArtifact: `Generated artifact could not be removed because ${basename(path)} is not a regular file.`,
        };
      }
      await this.operations.unlink(path);
      await this.filesystem.assertRoot(operation);
      return { recordId: id, status: "blocked", reason };
    } catch (cause) {
      if (errorCode(cause) === "ENOENT") return { recordId: id, status: "blocked", reason };
      return {
        recordId: id,
        status: "blocked",
        reason,
        staleArtifact: `Generated artifact could not be removed: ${cause instanceof Error ? cause.message : "unknown filesystem error"}`,
      };
    }
  }

  private summarizeDerivedOutputs(
    outputs: ReadonlyMap<string, CompositionDerivedOutputRecordOutcome>,
    targetIds: readonly string[],
  ): CompositionDerivedOutputOutcome {
    const records = targetIds
      .map((id) => outputs.get(id))
      .filter((outcome): outcome is CompositionDerivedOutputRecordOutcome => outcome !== undefined);
    const status = records.some((outcome) => outcome.status === "blocked")
      ? "blocked"
      : records.some((outcome) => outcome.status === "repaired")
        ? "repaired"
        : "current";
    return { status, records };
  }

  private async run<T>(
    operation: CompositionPersistenceOperation,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.filesystem.run(operation, task);
  }

  private async findDependents(
    operation: "delete" | "put",
    sourceRecordId: string,
  ): Promise<CompositionDependent[]> {
    let entries;
    try {
      entries = await this.operations.readdir(this.realRoot, { withFileTypes: true });
      await this.filesystem.assertRoot(operation);
    } catch (cause) {
      rethrow(operation, "read-failed", "Could not inspect Composition bindings before source mutation.", cause);
    }

    const dependents: CompositionDependent[] = [];
    for (const entry of entries.sort(compareNames)) {
      const match = OWNED_JSON_PATTERN.exec(entry.name);
      if (!match || entry.isSymbolicLink() || !entry.isFile() || match[1] === sourceRecordId) continue;
      const canonical = await this.readCanonical(operation, match[1]!);
      if (canonical === undefined) continue;
      if (canonical.outcome.status !== "loaded") {
        throw operationError(
          operation,
          "validation",
          `Canonical composition JSON is invalid for id "${match[1]}"; source mutation was not attempted.`,
        );
      }
      const binding = canonical.outcome.record.document.binding;
      if (binding?.sourceRecordId !== sourceRecordId) continue;
      dependents.push({ summary: summarizeComposition(canonical.outcome.record), binding: cloneJson(binding) });
    }
    return dependents.sort((a, b) => compareCompositionSummariesNewestFirst(a.summary, b.summary));
  }

  private assertSafeId(operation: CompositionPersistenceOperation, id: string): void {
    if (!isSafeCompositionRecordId(id)) {
      throw operationError(
        operation,
        "validation",
        `Composition id is not a stable path-safe id: ${JSON.stringify(id)}`,
      );
    }
  }

  private jsonPath(id: string): string {
    return this.filesystem.ownedPath(`composition-${id}${JSON_SUFFIX}`);
  }

  private jsxPath(id: string): string {
    return this.filesystem.ownedPath(`composition-${id}${JSX_SUFFIX}`);
  }

  private async readCanonical(
    operation: CompositionPersistenceOperation,
    expectedId: string,
  ): Promise<CanonicalResult | undefined> {
    const file = await this.filesystem.readFileNoFollow(operation, this.jsonPath(expectedId));
    if (file === undefined) return undefined;

    let raw: unknown;
    try {
      raw = JSON.parse(file.text);
    } catch {
      return {
        stats: file.stats,
        outcome: {
          status: "invalid",
          issue: { code: "invalid-record", message: "Canonical composition file is not valid JSON." },
          raw: file.text,
        },
      };
    }

    const outcome = loadCompositionRecord(raw);
    if (outcome.status === "loaded" && outcome.record.id !== expectedId) {
      return {
        stats: file.stats,
        outcome: {
          status: "invalid",
          issue: {
            code: "invalid-record",
            message: "Canonical composition record id does not match its derived filename.",
          },
          raw,
        },
      };
    }
    return { outcome, stats: file.stats };
  }

  private async getProductionJsx(
    operation: CompositionPersistenceOperation,
    record: CompositionRecord,
  ): Promise<string> {
    try {
      const supplied = await this.provideJsx(cloneJson(record), {
        records: [cloneJson(record)],
        sourceOutcomes: [{ id: record.id, outcome: { status: "loaded", record: cloneJson(record) } }],
        targetIds: [record.id],
      });
      if (typeof supplied === "string") return supplied;
      if (supplied.status === "generated") return supplied.code;
      throw new TypeError(supplied.reason);
    } catch (cause) {
      rethrow(
        operation,
        "write-failed",
        `Could not obtain production JSX for composition "${record.id}".`,
        cause,
      );
    }
  }

  private async deleteValidatedPair(
    operation: "delete" | "clear",
    id: string,
    canonicalStats: Stats,
  ): Promise<void> {
    await this.filesystem.deleteValidatedPair(
      operation,
      id,
      this.jsonPath(id),
      this.jsxPath(id),
      canonicalStats,
    );
  }
}

export function createFilesystemCompositionStore(
  options: FilesystemCompositionStoreOptions,
): Promise<FilesystemCompositionStore> {
  return FilesystemCompositionStore.create(options);
}
