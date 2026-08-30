import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  maintainSiteProjectRevisionRetention,
  SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME,
  siteProjectRevisionDatabaseName,
  siteProjectRevisionLockName,
  startSiteProjectRevisionRetention,
  type RevisionLockManager,
} from "../site-project-revision-retention";

const baseNames = ["zudo-composer", "zudo-composer-content", "zudo-composer-mapping", "zudo-composer-sitemapper"];
const revision = (value: string) => value.repeat(64);

class Locks implements RevisionLockManager {
  readonly requests: { name: string; mode: string; ifAvailable: boolean }[] = [];
  private readonly states = new Map<string, { shared: number; exclusive: boolean; queue: { mode: "exclusive" | "shared"; grant(): void }[] }>();

  private state(name: string): { shared: number; exclusive: boolean; queue: { mode: "exclusive" | "shared"; grant(): void }[] } {
    const current = this.states.get(name) ?? { shared: 0, exclusive: false, queue: [] };
    this.states.set(name, current);
    return current;
  }

  private canGrant(state: { shared: number; exclusive: boolean }, mode: "exclusive" | "shared"): boolean {
    return mode === "shared" ? !state.exclusive : !state.exclusive && state.shared === 0;
  }

  private drain(name: string): void {
    const state = this.state(name);
    if (state.exclusive || state.queue.length === 0) return;
    if (state.shared > 0 && state.queue[0]!.mode === "exclusive") return;
    if (state.queue[0]!.mode === "exclusive") { state.queue.shift()!.grant(); return; }
    while (state.queue[0]?.mode === "shared" && !state.exclusive) state.queue.shift()!.grant();
  }

  request<T>(name: string, options: { mode: "exclusive" | "shared"; ifAvailable?: boolean }, callback: (lock: { name: string; mode: "exclusive" | "shared" } | null) => T | PromiseLike<T>): Promise<T> {
    this.requests.push({ name, mode: options.mode, ifAvailable: options.ifAvailable === true });
    const state = this.state(name);
    if (options.ifAvailable && (state.queue.length > 0 || !this.canGrant(state, options.mode))) return Promise.resolve(callback(null));
    return new Promise<T>((resolve, reject) => {
      const grant = (): void => {
        if (options.mode === "shared") state.shared += 1;
        else state.exclusive = true;
        const lock = { name, mode: options.mode };
        void Promise.resolve().then(() => callback(lock)).then(resolve, reject).finally(() => {
          if (options.mode === "shared") state.shared -= 1;
          else state.exclusive = false;
          this.drain(name);
        });
      };
      if (state.queue.length === 0 && this.canGrant(state, options.mode)) grant();
      else state.queue.push({ mode: options.mode, grant });
    });
  }
}

async function createRevisionDatabases(factory: IDBFactory, sourceRevision: string): Promise<void> {
  for (const base of baseNames) {
    const request = factory.open(siteProjectRevisionDatabaseName(base, sourceRevision), 1);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  }
}

describe("SiteProject revision retention", () => {
  it("keeps the newest bounded set and deletes only registered, unlocked revision databases", async () => {
    const factory = new IDBFactory(); const locks = new Locks();
    const revisions = [revision("a"), revision("b"), revision("c"), revision("d")];
    for (const [index, sourceRevision] of revisions.entries()) {
      await createRevisionDatabases(factory, sourceRevision);
      await maintainSiteProjectRevisionRetention({ factory, locks, revision: sourceRevision, now: index + 1, retentionCount: 10, graceMs: 0 });
    }
    const report = await maintainSiteProjectRevisionRetention({ factory, locks, revision: revisions[3]!, now: 10, retentionCount: 2, graceMs: 0 });
    expect(report).toEqual({ registered: true, deleted: [revisions[1], revisions[0]], skipped: [] });
    const names = (await factory.databases()).map(({ name }) => name);
    for (const removed of revisions.slice(0, 2)) for (const base of baseNames) expect(names).not.toContain(siteProjectRevisionDatabaseName(base, removed));
    for (const retained of revisions.slice(2)) for (const base of baseNames) expect(names).toContain(siteProjectRevisionDatabaseName(base, retained));
    expect(names).toContain(SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME);
  });

  it("retains a candidate when another context holds its revision lock", async () => {
    const factory = new IDBFactory(); const locks = new Locks();
    const oldRevision = revision("a"); const currentRevision = revision("b");
    await createRevisionDatabases(factory, oldRevision);
    const active = startSiteProjectRevisionRetention({ factory, locks, revision: oldRevision });
    await expect(active.protect()).resolves.toBe(true);
    active.afterReady();
    await vi.waitFor(async () => expect((await factory.databases()).map(({ name }) => name)).toContain(SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME));
    const report = await maintainSiteProjectRevisionRetention({ factory, locks, revision: currentRevision, now: Date.now() + 1_000, retentionCount: 1, graceMs: 0 });
    expect(report).toEqual({ registered: true, deleted: [], skipped: [oldRevision] });
    const names = (await factory.databases()).map(({ name }) => name);
    expect(names).toContain(siteProjectRevisionDatabaseName(baseNames[0]!, oldRevision));
  });

  it("tombstones a partial multi-database deletion and fully repairs it before reopening", async () => {
    const factory = new IDBFactory(); const locks = new Locks();
    const oldRevision = revision("a"); const currentRevision = revision("b");
    await createRevisionDatabases(factory, oldRevision);
    await maintainSiteProjectRevisionRetention({ factory, locks, revision: oldRevision, now: 1, retentionCount: 10, graceMs: 0 });
    let deletes = 0;
    const failingFactory = new Proxy(factory, {
      get(target, property) {
        if (property === "deleteDatabase") return (name: string) => {
          deletes += 1;
          if (deletes === 2) throw new Error("injected second-database deletion failure");
          return target.deleteDatabase(name);
        };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const interrupted = await maintainSiteProjectRevisionRetention({ factory: failingFactory, locks, revision: currentRevision, now: 2, retentionCount: 1, graceMs: 0 });
    expect(interrupted).toEqual({ registered: true, deleted: [], skipped: [oldRevision] });
    const partialNames = (await factory.databases()).map(({ name }) => name);
    expect(partialNames).not.toContain(siteProjectRevisionDatabaseName(baseNames[0]!, oldRevision));
    expect(partialNames).toContain(siteProjectRevisionDatabaseName(baseNames[1]!, oldRevision));

    const reopened = startSiteProjectRevisionRetention({ factory, locks, revision: oldRevision });
    await expect(reopened.protect()).resolves.toBe(true);
    const repairedNames = (await factory.databases()).map(({ name }) => name);
    for (const base of baseNames) expect(repairedNames).not.toContain(siteProjectRevisionDatabaseName(base, oldRevision));
  });

  it("does not hold the global registry lock while one revision deletion is blocked", async () => {
    const factory = new IDBFactory(); const locks = new Locks();
    const oldRevision = revision("a"); const currentRevision = revision("b"); const unrelatedRevision = revision("c");
    await createRevisionDatabases(factory, oldRevision);
    await maintainSiteProjectRevisionRetention({ factory, locks, revision: oldRevision, now: 1, retentionCount: 10, graceMs: 0 });
    const heldRequest = factory.open(siteProjectRevisionDatabaseName(baseNames[0]!, oldRevision));
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      heldRequest.onsuccess = () => resolve(heldRequest.result);
      heldRequest.onerror = () => reject(heldRequest.error);
    });
    const blockedCleanup = maintainSiteProjectRevisionRetention({ factory, locks, revision: currentRevision, now: 2, retentionCount: 1, graceMs: 0 });
    await vi.waitFor(() => expect(locks.requests).toContainEqual({ name: siteProjectRevisionLockName(oldRevision), mode: "exclusive", ifAvailable: true }));
    await expect(maintainSiteProjectRevisionRetention({ factory, locks, revision: unrelatedRevision, now: 3, retentionCount: 10, graceMs: 0 })).resolves.toMatchObject({ registered: true });
    held.close();
    await expect(blockedCleanup).resolves.toMatchObject({ deleted: [oldRevision] });
  });

  it("holds a shared revision lock before scheduling post-ready maintenance", async () => {
    const factory = new IDBFactory(); const locks = new Locks(); const sourceRevision = revision("c");
    const retention = startSiteProjectRevisionRetention({ factory, locks, revision: sourceRevision });
    await expect(retention.protect()).resolves.toBe(true);
    retention.afterReady();
    await vi.waitFor(async () => expect((await factory.databases()).map(({ name }) => name)).toContain(SITE_PROJECT_REVISION_REGISTRY_DATABASE_NAME));
    expect(locks.requests[0]).toEqual({ name: siteProjectRevisionLockName(sourceRevision), mode: "shared", ifAvailable: false });
  });
});
