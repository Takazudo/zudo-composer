import { serializeSiteProject, type SiteProject, type SiteProjectCollectionAttachment } from "../site-project/model";
import { notifyPersistenceChange, requestValue } from "../shared/persistence-generation";
import { validateCollectionAttachments, validateWorkspaceRecord, workspaceProjectMetadata, type WorkspaceRecord } from "./workspace-record";

export const WORKSPACE_DATABASE_NAME = "zudo-composer-workspaces-v1";

export function workspaceDatabaseName(database: string, workspaceId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId)) throw new Error("Invalid workspace identity.");
  return `${database}-workspace-v1-${workspaceId}`;
}
export function workspaceScopedFactory(factory: IDBFactory | null | undefined, identity: () => string): IDBFactory | null {
  const target = factory === undefined ? globalThis.indexedDB : factory;
  if (!target) return null;
  return new Proxy(target, { get(value, property) {
    if (property === "open") return (name: string, version?: number) => value.open(workspaceDatabaseName(name, identity()), version);
    if (property === "deleteDatabase") return (name: string) => value.deleteDatabase(workspaceDatabaseName(name, identity()));
    const member: unknown = Reflect.get(value, property, value);
    return typeof member === "function" ? member.bind(value) : member;
  } });
}

export function createWorkspaceStorage(factory: IDBFactory | null | undefined) {
  const target = factory === undefined ? globalThis.indexedDB : factory;
  const open = async () => {
    if (!target) throw new Error("Workspace IndexedDB is unavailable.");
    const request = target.open(WORKSPACE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("workspaces", { keyPath: "id" }); request.result.createObjectStore("selection"); };
    return requestValue(request);
  };
  async function transaction<T>(mode: IDBTransactionMode, action: (records: IDBObjectStore, selection: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await open();
    const tx = db.transaction(["workspaces", "selection"], mode);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Workspace transaction aborted.")); tx.onerror = () => reject(tx.error); });
    try { const result = await action(tx.objectStore("workspaces"), tx.objectStore("selection")); await done; if (mode === "readwrite") notifyPersistenceChange(WORKSPACE_DATABASE_NAME); return result; }
    catch (error) { try { tx.abort(); } catch { /* Already settled. */ } void done.catch(() => undefined); throw error; }
    finally { db.close(); }
  }
  const validate = (value: unknown): WorkspaceRecord => validateWorkspaceRecord(value, (message) => { throw new Error(message); });
  return {
    async findSeeding(project: SiteProject, revision: string): Promise<WorkspaceRecord | undefined> {
      return transaction("readonly", async (records) => {
        const values: unknown[] = await requestValue(records.getAll());
        return values.filter((value) => value && typeof value === "object" && (value as WorkspaceRecord).status === "seeding" && (value as WorkspaceRecord).baselineRevision === revision).map(validate).find((record) => record.seed && serializeSiteProject(record.seed) === serializeSiteProject(project));
      });
    },
    async open(id?: string): Promise<WorkspaceRecord | undefined> {
      return transaction("readonly", async (records, selection) => {
        const selected: unknown = id ?? await requestValue(selection.get("active"));
        if (selected === undefined) return undefined;
        if (typeof selected !== "string") throw new Error("Workspace selection is invalid; choose a workspace explicitly.");
        const record: unknown = await requestValue(records.get(selected));
        if (record === undefined) throw new Error(`Selected workspace ${selected} is missing; choose a workspace explicitly.`);
        return validate(record);
      });
    },
    async create(project: SiteProject, baselineRevision: string, id: string = crypto.randomUUID(), requiresBeforeComplete = false): Promise<WorkspaceRecord> {
      workspaceDatabaseName("validate", id);
      return transaction("readwrite", async (records) => {
        const existing: unknown = await requestValue(records.get(id));
        if (existing !== undefined) {
          const record = validate(existing);
          if (record.status !== "seeding" || Boolean(record.requiresBeforeComplete) !== requiresBeforeComplete || record.baselineRevision !== baselineRevision || !record.seed || serializeSiteProject(record.seed) !== serializeSiteProject(project)) throw new Error(`Workspace attempt ${id} already exists with a different or completed identity; open it explicitly.`);
          return record;
        }
        const record: WorkspaceRecord = { schemaVersion: 1, id, mutationToken: 0, status: "seeding", metadata: workspaceProjectMetadata(project), baselineRevision, seed: structuredClone(project), ...(requiresBeforeComplete ? { requiresBeforeComplete: true } : {}) };
        records.add(record);
        return record;
      });
    },
    /** Caller holds the workspace initialization lock throughout DB cleanup. */
    async markSeedCleanup(id: string, revision: string): Promise<void> {
      await transaction("readwrite", async (records, selection) => {
        const record = validate(await requestValue(records.get(id)));
        if (record.status !== "seeding" || record.baselineRevision !== revision || await requestValue(selection.get("active")) === id) throw new Error("Only an unselected matching seeding attempt may be discarded.");
        record.seedCleanupPending = true; records.put(record);
      });
    },
    /** Remove the exact attempt only after every provider DB deletion succeeded. */
    async discardSeeding(id: string, revision: string): Promise<void> {
      await transaction("readwrite", async (records, selection) => {
        const record = validate(await requestValue(records.get(id)));
        if (record.status !== "seeding" || !record.seedCleanupPending || record.baselineRevision !== revision || await requestValue(selection.get("active")) === id) throw new Error("Only a cleaned, unselected matching seeding attempt may be discarded.");
        records.delete(id);
      });
    },
    async complete(id: string, creationValidated = false): Promise<WorkspaceRecord> {
      return transaction("readwrite", async (records, selection) => {
        const record = validate(await requestValue(records.get(id)));
        if (record.seedCleanupPending) throw new Error("Workspace seed cleanup must finish before completion.");
        if (record.requiresBeforeComplete && !creationValidated) throw new Error("Workspace creation must repeat its before-complete validation before selection.");
        if (record.status !== "ready") {
          if (record.mutationToken === Number.MAX_SAFE_INTEGER) throw new Error("Workspace mutation generation is exhausted.");
          record.status = "ready"; delete record.seed; delete record.requiresBeforeComplete; record.mutationToken++; records.put(record);
        }
        selection.put(id, "active");
        return record;
      });
    },
    async update(id: string, expectedToken: number, patch: { name?: string; activeSitemap?: SiteProject["activeSitemap"]; baselineRevision?: string; collectionAttachments?: readonly SiteProjectCollectionAttachment[] }): Promise<WorkspaceRecord> {
      return transaction("readwrite", async (records) => {
        const record = validate(await requestValue(records.get(id)));
        if (record.status !== "ready" || record.mutationToken !== expectedToken) throw new Error("Workspace metadata changed; reload before applying this update.");
        if (record.mutationToken === Number.MAX_SAFE_INTEGER) throw new Error("Workspace mutation generation is exhausted.");
        if (patch.name !== undefined) { if (!patch.name.trim()) throw new Error("Workspace name is required."); record.metadata.name = patch.name; }
        if (patch.activeSitemap !== undefined) record.metadata.activeSitemap = structuredClone(patch.activeSitemap);
        if (patch.collectionAttachments !== undefined) {
          if (!validateCollectionAttachments(patch.collectionAttachments)) throw new Error("Collection attachment metadata is malformed.");
          record.metadata.collectionAttachments = patch.collectionAttachments.map((attachment) => structuredClone(attachment));
        }
        if (patch.baselineRevision !== undefined) { if (!/^[a-f0-9]{64}$/.test(patch.baselineRevision)) throw new Error("Invalid baseline revision."); record.baselineRevision = patch.baselineRevision; }
        record.mutationToken++;
        records.put(record);
        return record;
      });
    },
  };
}

const localLocks = new WeakMap<IDBFactory, Map<string, Promise<unknown>>>();
/** Browser Web Locks serialize once-only multi-provider seed; tests use an isolated factory. */
export async function withWorkspaceInitializationLock<T>(factory: IDBFactory | null | undefined, id: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`zudo-workspace-seed-${id}`, action);
  if (factory === undefined || factory === null) throw new Error("Workspace creation requires browser Web Locks to serialize seeding across tabs.");
  let locks = localLocks.get(factory);
  if (!locks) { locks = new Map(); localLocks.set(factory, locks); }
  const pending = (locks.get(id) ?? Promise.resolve()).then(action, action);
  locks.set(id, pending);
  try { return await pending; } finally { if (locks.get(id) === pending) locks.delete(id); }
}
