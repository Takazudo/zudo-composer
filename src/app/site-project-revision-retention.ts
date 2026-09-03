import { COMPOSER_DATABASE_NAME } from "../composer/storage/indexeddb";
import { CONTENT_DATABASE_NAME } from "../content/storage/indexeddb/types";
import { MAPPING_DATABASE_NAME } from "../mapping/storage/indexeddb/types";
import { SITEMAPPER_DATABASE_NAME } from "../sitemapper/storage/indexeddb/types";

export const SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME = "zudo-composer-site-project-revisions";
export const SITE_PROJECT_REVISION_REGISTRY_STORE_NAME = "revisions";
export const SITE_PROJECT_REVISION_RETENTION_COUNT = 5;
export const SITE_PROJECT_REVISION_RETENTION_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

const REGISTRY_VERSION = 1;
const CLEANUP_LOCK_NAME = "zudo-site-project-revision-cleanup";
const DATABASE_NAMES = [COMPOSER_DATABASE_NAME, CONTENT_DATABASE_NAME, MAPPING_DATABASE_NAME, SITEMAPPER_DATABASE_NAME] as const;

interface RevisionRegistryRecord {
  revision: string;
  lastUsedAt: number;
  state: "pending" | "ready" | "deleting";
}

interface RevisionLock {
  readonly name: string;
  readonly mode: "exclusive" | "shared";
}

export interface RevisionLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: RevisionLock | null) => T | PromiseLike<T>,
  ): Promise<T>;
}

export interface RevisionRetentionReport {
  registered: boolean;
  deleted: readonly string[];
  skipped: readonly string[];
}

export interface SiteProjectRevisionRetention {
  protect(): Promise<boolean>;
  afterReady(): void;
}

export function siteProjectRevisionDatabaseName(databaseName: string, revision: string): string {
  return `${databaseName}--site-project--${revision}`;
}

export function siteProjectRevisionLockName(revision: string): string {
  return `zudo-site-project-revision:${revision}`;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function openRegistry(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME, REGISTRY_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME)) {
        request.result.createObjectStore(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME, { keyPath: "revision" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("SiteProject revision registry could not be opened."));
    request.onblocked = () => reject(new Error("SiteProject revision registry is blocked."));
  });
}

async function withRegistryLock<T>(options: { factory: IDBFactory; locks: RevisionLockManager }, operation: (database: IDBDatabase) => Promise<T>): Promise<T | undefined> {
  let outcome: T | undefined;
  await options.locks.request(CLEANUP_LOCK_NAME, { mode: "exclusive" }, async (lock) => {
    if (!lock) return;
    const database = await openRegistry(options.factory);
    try { outcome = await operation(database); } finally { database.close(); }
  });
  return outcome;
}

async function putRecord(database: IDBDatabase, record: RevisionRegistryRecord): Promise<void> {
  const transaction = database.transaction(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME, "readwrite");
  const pending = completed(transaction);
  transaction.objectStore(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME).put(record);
  await pending;
}

async function readRecords(database: IDBDatabase): Promise<readonly RevisionRegistryRecord[]> {
  const transaction = database.transaction(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME, "readonly");
  const pending = completed(transaction);
  const values = await result(transaction.objectStore(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME).getAll());
  await pending;
  return values.filter((value): value is RevisionRegistryRecord => (
    value !== null
    && typeof value === "object"
    && "revision" in value
    && typeof value.revision === "string"
    && "lastUsedAt" in value
    && typeof value.lastUsedAt === "number"
    && "state" in value
    && (value.state === "pending" || value.state === "ready" || value.state === "deleting")
  ));
}

async function readRecord(database: IDBDatabase, revision: string): Promise<RevisionRegistryRecord | undefined> {
  const transaction = database.transaction(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME, "readonly");
  const pending = completed(transaction);
  const value: unknown = await result(transaction.objectStore(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME).get(revision));
  await pending;
  return value !== null
    && typeof value === "object"
    && "revision" in value
    && value.revision === revision
    && "lastUsedAt" in value
    && typeof value.lastUsedAt === "number"
    && "state" in value
    && (value.state === "pending" || value.state === "ready" || value.state === "deleting")
    ? value as RevisionRegistryRecord
    : undefined;
}

async function deleteRecord(database: IDBDatabase, revision: string): Promise<void> {
  const transaction = database.transaction(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME, "readwrite");
  const pending = completed(transaction);
  transaction.objectStore(SITE_PROJECT_REVISION_REGISTRY_STORE_NAME).delete(revision);
  await pending;
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB database ${JSON.stringify(name)} could not be deleted.`));
    // A delete stays pending while blocked. The exclusive Web Lock remains held
    // until it succeeds, so a late delete cannot race a newly active revision.
  });
}

async function deleteRevisionDatabases(factory: IDBFactory, revision: string): Promise<void> {
  for (const name of DATABASE_NAMES) {
    await deleteDatabase(factory, siteProjectRevisionDatabaseName(name, revision));
  }
}

function retentionCandidates(records: readonly RevisionRegistryRecord[], currentRevision: string, now: number, retentionCount: number, graceMs: number): readonly RevisionRegistryRecord[] {
  const sorted = [...records].sort((left, right) => (
    right.lastUsedAt - left.lastUsedAt || (left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0)
  ));
  const cutoff = now - graceMs;
  return sorted.filter((record, index) => record.revision !== currentRevision && (
    record.state === "deleting"
    || (index >= retentionCount && record.lastUsedAt <= cutoff)
  ));
}

/**
 * Register one successfully opened revision and prune only older revisions
 * previously registered by this code. Unknown databases are never enumerated
 * or deleted.
 */
export async function maintainSiteProjectRevisionRetention(options: {
  factory: IDBFactory;
  locks: RevisionLockManager;
  revision: string;
  now?: number;
  retentionCount?: number;
  graceMs?: number;
}): Promise<RevisionRetentionReport> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  let registered = false;
  const now = options.now ?? Date.now();
  const retentionCount = options.retentionCount ?? SITE_PROJECT_REVISION_RETENTION_COUNT;
  const graceMs = options.graceMs ?? SITE_PROJECT_REVISION_RETENTION_GRACE_MS;
  const selected = await withRegistryLock(options, async (registry) => {
    const existing = await readRecord(registry, options.revision);
    if (existing?.state === "deleting") return [];
    await putRecord(registry, { revision: options.revision, lastUsedAt: now, state: "ready" });
    registered = true;
    return retentionCandidates(await readRecords(registry), options.revision, now, retentionCount, graceMs);
  }) ?? [];

  for (const selectedCandidate of selected) {
    await options.locks.request(siteProjectRevisionLockName(selectedCandidate.revision), { mode: "exclusive", ifAvailable: true }, async (revisionLock) => {
      if (!revisionLock) { skipped.push(selectedCandidate.revision); return; }
      const tombstoned = await withRegistryLock(options, async (registry) => {
        const candidates = retentionCandidates(await readRecords(registry), options.revision, now, retentionCount, graceMs);
        const candidate = candidates.find(({ revision }) => revision === selectedCandidate.revision);
        if (!candidate) return false;
        await putRecord(registry, { ...candidate, state: "deleting" });
        return true;
      });
      if (!tombstoned) return;
      try {
        await deleteRevisionDatabases(options.factory, selectedCandidate.revision);
      } catch {
        skipped.push(selectedCandidate.revision);
        return;
      }
      const finalized = await withRegistryLock(options, async (registry) => {
        const candidate = await readRecord(registry, selectedCandidate.revision);
        if (candidate?.state !== "deleting") return false;
        await deleteRecord(registry, selectedCandidate.revision);
        return true;
      });
      if (finalized) deleted.push(selectedCandidate.revision);
      else skipped.push(selectedCandidate.revision);
    });
  }

  return { registered, deleted, skipped };
}

type SharedProtectionOutcome = "protected" | "tombstoned" | "failed";

function acquireSharedProtection(options: { factory: IDBFactory; locks: RevisionLockManager; revision: string }): Promise<SharedProtectionOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: SharedProtectionOutcome): void => { if (!settled) { settled = true; resolve(outcome); } };
    const pageLifetime = new Promise<void>(() => { /* released when the browser context closes */ });
    let pending: Promise<unknown>;
    try {
      pending = options.locks.request(siteProjectRevisionLockName(options.revision), { mode: "shared" }, async (lock) => {
        if (!lock) { settle("failed"); return; }
        let outcome: SharedProtectionOutcome;
        try {
          outcome = await withRegistryLock(options, async (registry) => {
            const record = await readRecord(registry, options.revision);
            if (record?.state === "deleting") return "tombstoned" as const;
            await putRecord(registry, {
              revision: options.revision,
              lastUsedAt: Date.now(),
              state: record?.state === "ready" ? "ready" : "pending",
            });
            return "protected" as const;
          }) ?? "failed";
        } catch { outcome = "failed"; }
        settle(outcome);
        if (outcome === "protected") await pageLifetime;
      });
    } catch { settle("failed"); return; }
    void pending.catch(() => settle("failed"));
  });
}

async function repairTombstonedRevision(options: { factory: IDBFactory; locks: RevisionLockManager; revision: string }): Promise<boolean> {
  let repaired = false;
  try {
    await options.locks.request(siteProjectRevisionLockName(options.revision), { mode: "exclusive" }, async (lock) => {
      if (!lock) return;
      const tombstoned = await withRegistryLock(options, async (registry) => (await readRecord(registry, options.revision))?.state === "deleting");
      if (!tombstoned) { repaired = true; return; }
      try { await deleteRevisionDatabases(options.factory, options.revision); } catch { return; }
      repaired = await withRegistryLock(options, async (registry) => {
        const record = await readRecord(registry, options.revision);
        if (record?.state !== "deleting") return false;
        await deleteRecord(registry, options.revision);
        return true;
      }) === true;
    });
  } catch { return false; }
  return repaired;
}

/** Register under a granted shared revision lock, then clean in the background only after providers are ready. */
export function startSiteProjectRevisionRetention(options: {
  factory: IDBFactory;
  locks: RevisionLockManager;
  revision: string;
}): SiteProjectRevisionRetention {
  let protectedRevision = false;
  let protection: Promise<boolean> | undefined;
  let maintenance: Promise<unknown> | undefined;
  const protect = (): Promise<boolean> => {
    if (protectedRevision) return Promise.resolve(true);
    if (protection) return protection;
    const pending = (async () => {
      const first = await acquireSharedProtection(options);
      if (first === "protected") { protectedRevision = true; return true; }
      if (first !== "tombstoned" || !await repairTombstonedRevision(options)) return false;
      const second = await acquireSharedProtection(options);
      protectedRevision = second === "protected";
      return protectedRevision;
    })().catch(() => false);
    protection = pending;
    void pending.finally(() => { if (protection === pending) protection = undefined; });
    return pending;
  };
  return {
    protect,
    afterReady() {
      maintenance ??= protect().then((ready) => ready
        ? maintainSiteProjectRevisionRetention(options)
        : undefined).catch(() => undefined);
    },
  };
}
