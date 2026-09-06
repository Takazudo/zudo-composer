import { COMPOSER_DATABASE_NAME } from "../composer/storage/indexeddb/types";
import { CONTENT_DATABASE_NAME } from "../content/storage/indexeddb/types";
import { MAPPING_DATABASE_NAME } from "../mapping/storage/indexeddb/types";
import { SITEMAPPER_DATABASE_NAME } from "../sitemapper/storage/indexeddb/types";
import { notifyPersistenceChange } from "../shared/persistence-generation";
import { workspaceDatabaseName } from "./workspace-storage";

export interface WorkspaceSeedFactories {
  compositionIdbFactory?: IDBFactory | null;
  contentIdbFactory?: IDBFactory | null;
  mappingIdbFactory?: IDBFactory | null;
  sitemapIdbFactory?: IDBFactory | null;
}
const pendingDeletions = new WeakMap<IDBFactory, Set<string>>();
/** Called only for an owned unselected seeding record, under its writer lock.
 * A blocked delete cannot be cancelled. Keep the persisted cleanup marker;
 * the next attempt must await fresh deletes (queued AFTER these) before seeding.
 */
export async function deleteWorkspaceSeedDatabases(id: string, factories: WorkspaceSeedFactories): Promise<void> {
  const databases = [
    [COMPOSER_DATABASE_NAME, factories.compositionIdbFactory],
    [CONTENT_DATABASE_NAME, factories.contentIdbFactory],
    [MAPPING_DATABASE_NAME, factories.mappingIdbFactory],
    [SITEMAPPER_DATABASE_NAME, factories.sitemapIdbFactory],
  ] as const;
  const outcomes = await Promise.allSettled(databases.map(async ([database, factory]) => {
    const target = factory === undefined ? globalThis.indexedDB : factory;
    if (!target) throw new Error("Workspace cleanup storage is unavailable.");
    const name = workspaceDatabaseName(database, id);
    let pending = pendingDeletions.get(target);
    if (!pending) { pending = new Set(); pendingDeletions.set(target, pending); }
    if (pending.has(name)) throw new Error(`Cleanup of ${name} is still pending. Retry this same attempt after other connections close.`);
    await new Promise<void>((resolve, reject) => {
      pending.add(name);
      let request: IDBOpenDBRequest;
      try { request = target.deleteDatabase(name); } catch (error) { pending.delete(name); reject(error); return; }
      const timeout = setTimeout(() => reject(new Error(`Cleanup of ${name} is still pending. Retry this same attempt after other connections close.`)), 1000);
      request.onblocked = () => { clearTimeout(timeout); reject(new Error(`Cleanup of ${name} is blocked. Close other connections and retry this same attempt.`)); };
      request.onerror = () => { clearTimeout(timeout); pending.delete(name); reject(request.error ?? new Error(`Cleanup of ${name} failed.`)); };
      request.onsuccess = () => { clearTimeout(timeout); pending.delete(name); notifyPersistenceChange(name); resolve(); };
    });
  }));
  const failed = outcomes.find((outcome) => outcome.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
