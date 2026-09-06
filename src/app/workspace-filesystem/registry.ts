// The workspace registry, persisted as project files.
//
// The browser registry is one IndexedDB database (`zudo-composer-workspaces-v1`)
// with a `workspaces` store and a `selection` store, and every operation runs in
// one readwrite transaction over both. The filesystem registry keeps that
// contract exactly: the whole registry is one `TransactionalRecordStore`, so a
// registry mutation still moves from one complete before-state to one complete
// after-state — a workspace record and the selection pointer can never disagree
// after a crash, and a half-written registry is never visible.
//
// The record shape, the per-record `mutationToken` precondition and every
// refusal are shared with the browser registry through `../workspace-record`.
// What differs is only where the bytes live.

import {
  serializeSiteProject,
  type SiteProject,
  type SiteProjectCollectionAttachment,
} from "../../site-project/model";
import { isPlainObject } from "../../shared";
import { createTransactionalRecordStore } from "../../shared/node-fs";
import type {
  DurableExtraErrorCode,
  RecordEnvelope,
  RecordTransactionSnapshot,
  SafeRootErrorPolicy,
  TransactionalRecordStore,
} from "../../shared/node-fs";
import {
  validateCollectionAttachments,
  validateWorkspaceRecord,
  workspaceProjectMetadata,
  type WorkspaceRecord,
} from "../workspace-record";
import type { WorkspaceSnapshotSource } from "../workspace-snapshot";
import { assertWorkspaceDirectoryId, isSafeWorkspaceId } from "../../shared/workspace-scope";
import {
  WORKSPACE_META_RECORD_ID,
  WORKSPACE_REGISTRY_LAYOUT,
  WORKSPACE_REGISTRY_SCHEMA_VERSION,
  WORKSPACE_SELECTION_RECORD_ID,
  WorkspaceRegistryError,
  type FilesystemWorkspaceRegistryOptions,
  type WorkspaceRegistryErrorCode,
  type WorkspaceRegistryOperation,
} from "./types";

type Operation = WorkspaceRegistryOperation;

/** The record store reports raw filesystem failures against these phases. */
const PHASES = { initialize: "initialize", snapshot: "read", commit: "update" } as const;

const RESERVED_RECORD_IDS: readonly string[] = [WORKSPACE_META_RECORD_ID, WORKSPACE_SELECTION_RECORD_ID];

function registryError(operation: Operation, code: WorkspaceRegistryErrorCode, message: string, cause?: unknown): WorkspaceRegistryError {
  const retryable = code === "read-failed" || code === "write-failed" || code === "conflict";
  return new WorkspaceRegistryError(operation, code, message, retryable, cause === undefined ? undefined : { cause });
}

const errorPolicy: SafeRootErrorPolicy<Operation, DurableExtraErrorCode> = {
  isError: (value) => value instanceof WorkspaceRegistryError,
  create: (operation, code, message, cause) => registryError(operation, code, message, cause),
  rethrow: (operation, code, message, cause) => {
    if (cause instanceof WorkspaceRegistryError) throw cause;
    throw registryError(operation, code, message, cause);
  },
};

/** Thrown by a plan that decided nothing should be written, so nothing is. */
class UnchangedRegistry<T> {
  constructor(readonly value: T) {}
}

/** What both a snapshot and a commit context supply to `decode`. */
type RegistryDocuments = Pick<RecordTransactionSnapshot, "records">;

interface DecodedRegistry {
  workspaces: readonly WorkspaceRecord[];
  active: string | null;
}

function envelope(id: string, value: unknown): RecordEnvelope {
  return { id, json: `${JSON.stringify(value, null, 2)}\n` };
}

function sameLayout(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(WORKSPACE_REGISTRY_LAYOUT);
}

function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface WorkspaceMetadataPatch {
  name?: string;
  activeSitemap?: SiteProject["activeSitemap"];
  baselineRevision?: string;
  collectionAttachments?: readonly SiteProjectCollectionAttachment[];
}

export class FilesystemWorkspaceRegistry {
  private constructor(
    private readonly records: TransactionalRecordStore<Operation>,
    private readonly newWorkspaceId: () => string,
  ) {}

  static async create(options: FilesystemWorkspaceRegistryOptions): Promise<FilesystemWorkspaceRegistry> {
    const records = await createTransactionalRecordStore<Operation>({
      root: options.registryRoot,
      schemaVersion: WORKSPACE_REGISTRY_SCHEMA_VERSION,
      errors: errorPolicy,
      rootLabel: "Workspace registry root",
      ownerLabel: "Workspace registry",
      recordLabel: "workspace record",
      phases: PHASES,
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      ...(options.randomToken === undefined ? {} : { randomToken: options.randomToken }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const registry = new FilesystemWorkspaceRegistry(records, options.newWorkspaceId ?? (() => crypto.randomUUID()));
    await registry.initialize();
    return registry;
  }

  get root(): string {
    return this.records.root;
  }

  /** Stamp the layout marker on a brand-new registry; refuse a mismatched one. */
  private async initialize(): Promise<void> {
    const snapshot = await this.records.snapshot();
    if (snapshot.records.length > 0) {
      this.decode(snapshot, "initialize");
      return;
    }
    try {
      await this.records.commit((before) => {
        // Re-read under the lock: another process may have stamped the marker
        // between the snapshot above and this commit.
        if (before.records.length > 0) throw new UnchangedRegistry(null);
        return { records: this.envelopes([], null), result: null };
      });
    } catch (cause) {
      if (!(cause instanceof UnchangedRegistry)) throw cause;
    }
  }

  // ---------------------------------------------------------------- decoding

  /** Re-checks the layout marker on every call — never only at open. */
  private decode(snapshot: RegistryDocuments, operation: Operation): DecodedRegistry {
    const meta: unknown = this.parse(operation, WORKSPACE_META_RECORD_ID, this.required(operation, snapshot, WORKSPACE_META_RECORD_ID));
    if (!isPlainObject(meta) || Object.keys(meta).join(",") !== "layout" || !sameLayout(meta.layout)) {
      throw registryError(operation, "unsupported-version", "Workspace registry layout marker is missing or unsupported. Records are preserved; explicit recovery is required.");
    }
    const selection: unknown = this.parse(operation, WORKSPACE_SELECTION_RECORD_ID, this.required(operation, snapshot, WORKSPACE_SELECTION_RECORD_ID));
    if (!isPlainObject(selection) || Object.keys(selection).join(",") !== "active" || (selection.active !== null && typeof selection.active !== "string")) {
      throw registryError(operation, "blocked", "Workspace selection is invalid; choose a workspace explicitly.");
    }
    const workspaces = snapshot.records
      .filter((record) => !RESERVED_RECORD_IDS.includes(record.id))
      .map((record) => this.validate(operation, record.id, this.parse(operation, record.id, record.json)))
      .sort(compareById);
    return { workspaces, active: selection.active as string | null };
  }

  private required(operation: Operation, snapshot: RegistryDocuments, id: string): string {
    const json = snapshot.records.find((record) => record.id === id)?.json;
    if (json === undefined) throw registryError(operation, "unsupported-version", `Workspace registry document "${id}" is missing. Records are preserved; explicit recovery is required.`);
    return json;
  }

  private parse(operation: Operation, id: string, json: string): unknown {
    try {
      return JSON.parse(json);
    } catch (cause) {
      throw registryError(operation, "blocked", `Workspace registry document "${id}" is not valid JSON. It was preserved; explicit recovery is required.`, cause);
    }
  }

  /** The document's filename is its identity; a record that disagrees is not repaired. */
  private validate(operation: Operation, documentId: string, value: unknown): WorkspaceRecord {
    const record = validateWorkspaceRecord(value, (message) => { throw registryError(operation, "blocked", message); });
    if (record.id !== documentId || !isSafeWorkspaceId(record.id)) {
      throw registryError(operation, "blocked", `Workspace document "${documentId}" does not carry its own identity. It was preserved; explicit recovery is required.`);
    }
    return record;
  }

  private envelopes(workspaces: readonly WorkspaceRecord[], active: string | null): RecordEnvelope[] {
    return [
      envelope(WORKSPACE_META_RECORD_ID, { layout: WORKSPACE_REGISTRY_LAYOUT }),
      envelope(WORKSPACE_SELECTION_RECORD_ID, { active }),
      ...[...workspaces].sort(compareById).map((record) => envelope(record.id, record)),
    ];
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Run one whole registry mutation. `plan` sees the complete validated
   * before-state and returns the complete after-state, so the workspace set and
   * the selection pointer commit or fail together.
   */
  private async mutate<T>(
    operation: Operation,
    plan: (before: DecodedRegistry) => { workspaces: readonly WorkspaceRecord[]; active: string | null; value: T },
  ): Promise<T> {
    try {
      return await this.records.commit((context) => {
        const planned = plan(this.decode(context, operation));
        return { records: this.envelopes(planned.workspaces, planned.active), result: planned.value };
      });
    } catch (cause) {
      if (cause instanceof UnchangedRegistry) return cause.value as T;
      if (cause instanceof WorkspaceRegistryError) throw cause;
      throw registryError(operation, "write-failed", `The workspace registry ${operation} did not complete.`, cause);
    }
  }

  private async read(operation: Operation): Promise<DecodedRegistry> {
    return this.decode(await this.records.snapshot(), operation);
  }

  private advance(operation: Operation, record: WorkspaceRecord): void {
    if (record.mutationToken === Number.MAX_SAFE_INTEGER) throw registryError(operation, "write-failed", "Workspace mutation generation is exhausted.");
    record.mutationToken += 1;
  }

  // ------------------------------------------------------------------- reads

  /** The registry-wide durable generation, advanced by every committed mutation. */
  async generation(): Promise<number> {
    return (await this.records.snapshot()).generation;
  }

  async list(): Promise<readonly WorkspaceRecord[]> {
    return (await this.read("read")).workspaces;
  }

  async selection(): Promise<string | null> {
    return (await this.read("read")).active;
  }

  /** Without an id, the selected workspace; `undefined` when none is selected. */
  async open(id?: string): Promise<WorkspaceRecord | undefined> {
    const registry = await this.read("read");
    const selected = id ?? registry.active;
    if (selected === null || selected === undefined) return undefined;
    const record = registry.workspaces.find((candidate) => candidate.id === selected);
    if (record === undefined) throw registryError("read", "blocked", `Selected workspace ${selected} is missing; choose a workspace explicitly.`);
    return record;
  }

  async findSeeding(project: SiteProject, revision: string): Promise<WorkspaceRecord | undefined> {
    const registry = await this.read("read");
    return registry.workspaces.find((record) =>
      record.status === "seeding"
      && record.baselineRevision === revision
      && record.seed !== undefined
      && serializeSiteProject(record.seed) === serializeSiteProject(project));
  }

  /**
   * The `workspace` capture source, identical to the browser registry's: the
   * durable token is the record's own `mutationToken`, read before and after
   * the snapshot value.
   */
  snapshotSource(id: string): WorkspaceSnapshotSource<WorkspaceRecord> {
    const record = async (): Promise<WorkspaceRecord> => {
      const value = await this.open(id);
      if (value === undefined) throw registryError("read", "blocked", `Workspace ${id} is missing; choose a workspace explicitly.`);
      return value;
    };
    return {
      id: "workspace",
      token: async () => (await record()).mutationToken,
      read: async () => {
        const value = await record();
        return { mutationToken: value.mutationToken, value };
      },
    };
  }

  // --------------------------------------------------------------- mutations

  async create(project: SiteProject, baselineRevision: string, id: string = this.newWorkspaceId(), requiresBeforeComplete = false): Promise<WorkspaceRecord> {
    assertWorkspaceDirectoryId(id);
    if (RESERVED_RECORD_IDS.includes(id)) throw registryError("create", "validation", `Workspace id "${id}" is reserved for registry metadata.`);
    return this.mutate("create", (before) => {
      const existing = before.workspaces.find((candidate) => candidate.id === id);
      if (existing) {
        if (existing.status !== "seeding" || Boolean(existing.requiresBeforeComplete) !== requiresBeforeComplete || existing.baselineRevision !== baselineRevision || !existing.seed || serializeSiteProject(existing.seed) !== serializeSiteProject(project)) {
          throw registryError("create", "conflict", `Workspace attempt ${id} already exists with a different or completed identity; open it explicitly.`);
        }
        throw new UnchangedRegistry(existing);
      }
      const record: WorkspaceRecord = {
        schemaVersion: 1,
        id,
        mutationToken: 0,
        status: "seeding",
        metadata: workspaceProjectMetadata(project),
        baselineRevision,
        seed: structuredClone(project),
        ...(requiresBeforeComplete ? { requiresBeforeComplete: true } : {}),
      };
      return { workspaces: [...before.workspaces, record], active: before.active, value: record };
    });
  }

  /** Caller holds the workspace initialization lock throughout directory cleanup. */
  async markSeedCleanup(id: string, revision: string): Promise<void> {
    await this.mutate("discard", (before) => {
      const record = this.owned(before, id, "discard");
      if (record.status !== "seeding" || record.baselineRevision !== revision || before.active === id) {
        throw registryError("discard", "conflict", "Only an unselected matching seeding attempt may be discarded.");
      }
      const next: WorkspaceRecord = { ...record, seedCleanupPending: true };
      return { workspaces: before.workspaces.map((candidate) => (candidate.id === id ? next : candidate)), active: before.active, value: undefined };
    });
  }

  /** Remove the exact attempt only after every workspace directory was removed. */
  async discardSeeding(id: string, revision: string): Promise<void> {
    await this.mutate("discard", (before) => {
      const record = this.owned(before, id, "discard");
      if (record.status !== "seeding" || !record.seedCleanupPending || record.baselineRevision !== revision || before.active === id) {
        throw registryError("discard", "conflict", "Only a cleaned, unselected matching seeding attempt may be discarded.");
      }
      return { workspaces: before.workspaces.filter((candidate) => candidate.id !== id), active: before.active, value: undefined };
    });
  }

  async complete(id: string, creationValidated = false): Promise<WorkspaceRecord> {
    return this.mutate("complete", (before) => {
      const record = this.owned(before, id, "complete");
      if (record.seedCleanupPending) throw registryError("complete", "conflict", "Workspace seed cleanup must finish before completion.");
      if (record.requiresBeforeComplete && !creationValidated) throw registryError("complete", "conflict", "Workspace creation must repeat its before-complete validation before selection.");
      if (record.status === "ready") return { workspaces: before.workspaces, active: id, value: record };
      const next: WorkspaceRecord = { ...record, status: "ready" };
      delete next.seed;
      delete next.requiresBeforeComplete;
      this.advance("complete", next);
      return { workspaces: before.workspaces.map((candidate) => (candidate.id === id ? next : candidate)), active: id, value: next };
    });
  }

  async update(id: string, expectedToken: number, patch: WorkspaceMetadataPatch): Promise<WorkspaceRecord> {
    return this.mutate("update", (before) => {
      const record = this.owned(before, id, "update");
      if (record.status !== "ready" || record.mutationToken !== expectedToken) throw registryError("update", "conflict", "Workspace metadata changed; reload before applying this update.");
      const next: WorkspaceRecord = structuredClone(record);
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw registryError("update", "validation", "Workspace name is required.");
        next.metadata.name = patch.name;
      }
      if (patch.activeSitemap !== undefined) next.metadata.activeSitemap = structuredClone(patch.activeSitemap);
      if (patch.collectionAttachments !== undefined) {
        if (!validateCollectionAttachments(patch.collectionAttachments)) throw registryError("update", "validation", "Collection attachment metadata is malformed.");
        next.metadata.collectionAttachments = patch.collectionAttachments.map((attachment) => structuredClone(attachment));
      }
      if (patch.baselineRevision !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(patch.baselineRevision)) throw registryError("update", "validation", "Invalid baseline revision.");
        next.baselineRevision = patch.baselineRevision;
      }
      this.advance("update", next);
      return { workspaces: before.workspaces.map((candidate) => (candidate.id === id ? next : candidate)), active: before.active, value: next };
    });
  }

  private owned(registry: DecodedRegistry, id: string, operation: Operation): WorkspaceRecord {
    const record = registry.workspaces.find((candidate) => candidate.id === id);
    if (record === undefined) throw registryError(operation, "blocked", `Workspace ${id} is missing; choose a workspace explicitly.`);
    return record;
  }
}

export function createFilesystemWorkspaceRegistry(options: FilesystemWorkspaceRegistryOptions): Promise<FilesystemWorkspaceRegistry> {
  return FilesystemWorkspaceRegistry.create(options);
}
