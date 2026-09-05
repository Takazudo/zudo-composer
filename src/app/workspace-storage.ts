import { isSiteProjectProviderId, type SiteProject, type SiteProjectCollectionAttachment } from "../site-project";
import { isSafeRecordId } from "../shared";
import { notifyPersistenceChange, requestValue } from "../shared/persistence-generation";

export const WORKSPACE_DATABASE_NAME = "zudo-composer-workspaces-v1";
export type WorkspaceProjectMetadata = Omit<SiteProject, "providers"> & { providers: { [K in keyof SiteProject["providers"]]: readonly { id: SiteProject["providers"][K][number]["id"] }[] } };
export interface WorkspaceRecord {
  schemaVersion: 1;
  id: string;
  mutationToken: number;
  status: "seeding" | "ready";
  metadata: WorkspaceProjectMetadata;
  baselineRevision: string;
  /** Fixed at creation; never replaced by a later injected active source. */
  seed?: SiteProject;
}
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
function metadata(project: SiteProject): WorkspaceProjectMetadata {
  const copy = structuredClone(project);
  return { ...copy, providers: {
    compositions: copy.providers.compositions.map(({ id }) => ({ id })),
    content: copy.providers.content.map(({ id }) => ({ id })),
    mappings: copy.providers.mappings.map(({ id }) => ({ id })),
    sitemaps: copy.providers.sitemaps.map(({ id }) => ({ id })),
  } };
}

function validAttachmentShape(value: unknown): value is SiteProjectCollectionAttachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const ref = (candidate: unknown, domain: "compositions" | "mappings"): candidate is { providerId: string; recordId: string } => {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as Record<string, unknown>;
    return Object.keys(value).length === 2 && typeof value.providerId === "string" && isSiteProjectProviderId(domain, value.providerId) && isSafeRecordId(value.recordId);
  };
  const target = item.target;
  return Object.keys(item).length === 5
    && isSafeRecordId(item.id)
    && Number.isSafeInteger(item.order) && Number(item.order) >= 0
    && ref(item.composition, "compositions") && ref(item.mapping, "mappings")
    && !!target && typeof target === "object"
    && Object.keys(target as object).length === 2
    && typeof (target as Record<string, unknown>).nodeId === "string" && Boolean((target as Record<string, unknown>).nodeId)
    && typeof (target as Record<string, unknown>).slotId === "string" && Boolean((target as Record<string, unknown>).slotId);
}

function validateCollectionAttachments(value: unknown): value is readonly SiteProjectCollectionAttachment[] {
  if (!Array.isArray(value) || !value.every(validAttachmentShape)) return false;
  const ids = new Set<string>();
  return value.every((attachment) => !ids.has(attachment.id) && (ids.add(attachment.id), true));
}
export function projectFromWorkspace(record: WorkspaceRecord): SiteProject {
  const copy = structuredClone(record.metadata);
  return { ...copy, providers: {
    compositions: copy.providers.compositions.map(({ id }) => ({ id, records: [] })),
    content: copy.providers.content.map(({ id }) => ({ id, models: [], entries: [] })),
    mappings: copy.providers.mappings.map(({ id }) => ({ id, records: [] })),
    sitemaps: copy.providers.sitemaps.map(({ id }) => ({ id, records: [] })),
  } };
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
  function validate(value: unknown): WorkspaceRecord {
    if (!value || typeof value !== "object" || (value as WorkspaceRecord).schemaVersion !== 1 || !Number.isSafeInteger((value as WorkspaceRecord).mutationToken) || (value as WorkspaceRecord).mutationToken < 0 || !["seeding", "ready"].includes((value as WorkspaceRecord).status) || !(value as WorkspaceRecord).metadata || !validateCollectionAttachments((value as WorkspaceRecord).metadata.collectionAttachments) || typeof (value as WorkspaceRecord).baselineRevision !== "string") throw new Error("Workspace metadata is invalid; explicit recovery is required.");
    return value as WorkspaceRecord;
  }
  return {
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
    async create(project: SiteProject, baselineRevision: string, id: string = crypto.randomUUID()): Promise<WorkspaceRecord> {
      workspaceDatabaseName("validate", id);
      return transaction("readwrite", async (records) => {
        const existing: unknown = await requestValue(records.get(id));
        if (existing !== undefined) return validate(existing);
        const record: WorkspaceRecord = { schemaVersion: 1, id, mutationToken: 0, status: "seeding", metadata: metadata(project), baselineRevision, seed: structuredClone(project) };
        records.add(record);
        return record;
      });
    },
    async complete(id: string): Promise<WorkspaceRecord> {
      return transaction("readwrite", async (records, selection) => {
        const record = validate(await requestValue(records.get(id)));
        if (record.status !== "ready") {
          if (record.mutationToken === Number.MAX_SAFE_INTEGER) throw new Error("Workspace mutation generation is exhausted.");
          record.status = "ready"; delete record.seed; record.mutationToken++; records.put(record);
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
