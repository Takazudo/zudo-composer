import { IDBFactory, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceSaveRegistry } from "../workspace-sessions";
import { captureWorkspaceSnapshot, type WorkspaceSnapshotSource } from "../workspace-snapshot";
import { createWorkspaceStorage, workspaceDatabaseName } from "../workspace-storage";
import { createProductionProviderIntegration } from "../provider-integration";
import { createWorkspaceSummary } from "../workspace-summary";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import { loadSampleSiteProject } from "../../site-project/sample";
import { createSaveQueue } from "../../shared/persistence/save-queue";
import type { MediaFileProvider } from "../../media";
import { createIndexedDbCompositionProvider } from "../../composer/storage/indexeddb";
import { createIndexedDbMappingProvider } from "../../mapping";
import { createIndexedDbSitemapProvider } from "../../sitemapper/storage/indexeddb/provider";
import { notifyPersistenceChange, requestValue } from "../../shared/persistence-generation";

const revision = "a".repeat(64);
const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);
function options() {
  const factory = new IDBFactory();
  return { project: sample(), sourceRevision: revision, compositionIdbFactory: factory, contentIdbFactory: factory, mappingIdbFactory: factory, sitemapIdbFactory: factory, mediaProvider: null };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }

describe("workspace save and capture lifetime", () => {
  it("retains and flushes the latest queued edit after route unmount", async () => {
    const first = deferred(); const saved: string[] = [];
    const ref = { providerId: "content-indexeddb", recordId: "entry" };
    const queue = createSaveQueue({ ref, initialRecord: { id: "entry", title: "initial" }, write: async ({ record }) => { if (record.title === "A") await first.promise; saved.push(record.title); } });
    const sessions = createWorkspaceSaveRegistry();
    const registration = sessions.register({ feature: "Content", ...ref }, queue);
    queue.edit(ref, { id: "entry", title: "A" }); registration.changed();
    queue.edit(ref, { id: "entry", title: "B" }); registration.changed();
    registration.detach();
    const closing = queue.close();
    const flush = sessions.flush();
    first.resolve();
    await closing;
    expect(await flush).toMatchObject({ status: "ready" });
    expect(saved).toEqual(["A", "B"]);
  });

  it("keeps failed detached handles actionable and blocks every capture until retry succeeds", async () => {
    const sessions = createWorkspaceSaveRegistry(); let failed = true;
    const handle = sessions.register({ feature: "Media", providerId: "files", recordId: "asset" }, { flush: async () => { if (failed) throw new Error("upload failed"); }, retry: () => { failed = false; } });
    handle.detach();
    const read = vi.fn();
    expect(await captureWorkspaceSnapshot("one", sessions, [{ id: "media", token: async () => 0, read }])).toMatchObject({ status: "save-failed", failures: [{ feature: "Media", recordId: "asset", error: { message: "upload failed" } }] });
    expect(read).not.toHaveBeenCalled();
    handle.retry();
    expect(await sessions.flush()).toMatchObject({ status: "ready" });
    expect(sessions.failures).toEqual([]);
  });

  it("detects sequential mixed reads with delayed notifications and retries from fresh persisted tokens", async () => {
    let token = 0; let mutate = true;
    const sources: WorkspaceSnapshotSource[] = [
      { id: "composition", token: async () => token, read: async () => ({ mutationToken: token, value: token }) },
      { id: "mapping", token: async () => 0, read: async () => { if (mutate) { token++; mutate = false; } return { mutationToken: 0, value: "mapping" }; } },
    ];
    const capture = await captureWorkspaceSnapshot("one", createWorkspaceSaveRegistry(), sources);
    expect(capture).toMatchObject({ status: "ready", capture: { values: { composition: 1 }, tokens: { composition: 1 } } });
    sources[1]!.read = async () => { token++; return { mutationToken: 0, value: "mapping" }; };
    expect(await captureWorkspaceSnapshot("one", createWorkspaceSaveRegistry(), sources, 2)).toEqual({ status: "changed", sources: ["composition"] });
  });
});

describe("durable mutable workspace", () => {
  it("preserves a seeding record and the prior selection when completion token is exhausted", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const storage = createWorkspaceStorage(opts.compositionIdbFactory);
    const seeding = await storage.create(opts.project, revision, "exhausted");
    const exhausted = { ...seeding, mutationToken: Number.MAX_SAFE_INTEGER };
    const db = await requestValue(opts.compositionIdbFactory.open("zudo-composer-workspaces-v1"));
    const tx = db.transaction("workspaces", "readwrite");
    const done = new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    tx.objectStore("workspaces").put(exhausted); await done; db.close();
    await expect(storage.complete("exhausted")).rejects.toThrow("generation is exhausted");
    expect(await storage.open("exhausted")).toEqual(exhausted);
    expect((await storage.open())!.id).toBe(current.workspace.id);
  });
  it.each(["composition", "mapping", "sitemap"] as const)("%s tokens persist atomically across instances, delete/clear, abort and exhaustion", async (domain) => {
    const factory = new IDBFactory();
    const make = () => domain === "composition" ? createIndexedDbCompositionProvider({ idbFactory: factory, seed: [] }) : domain === "mapping" ? createIndexedDbMappingProvider({ idbFactory: factory }) : createIndexedDbSitemapProvider({ idbFactory: factory });
    const provider = make(); await provider.initialization.initialize();
    const project = sample();
    const composition = structuredClone(project.providers.compositions[0]!.records.find(({ id }) => id === "services-page")!); delete composition.document.binding;
    const record = domain === "composition" ? composition : domain === "mapping" ? project.providers.mappings[0]!.records[0]! : project.providers.sitemaps[0]!.records[0]!;
    const store = provider.store as unknown as { snapshot(): Promise<{ mutationToken: number; records: readonly { id: string }[] }>; mutationToken(): Promise<number>; put(value: unknown): Promise<unknown>; delete(id: string): Promise<unknown>; clear(): Promise<void> };
    const before = await store.mutationToken();
    await store.put(record);
    const saved = await store.snapshot();
    expect(saved.mutationToken).toBe(before + 1);
    expect(saved.records.map(({ id }) => id)).toEqual([record.id]);
    expect(await make().store.mutationToken!()).toBe(saved.mutationToken);
    await expect(store.put({})).rejects.toThrow();
    expect(await store.mutationToken()).toBe(saved.mutationToken);
    await store.delete(record.id); await store.clear();
    expect(await store.snapshot()).toEqual({ records: [], mutationToken: before + 3 });
    const name = domain === "composition" ? "zudo-composer" : domain === "mapping" ? "zudo-composer-mapping" : "zudo-composer-sitemapper";
    const db = await requestValue(factory.open(name));
    const tx = db.transaction("meta", "readwrite");
    const done = new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    tx.objectStore("meta").put({ key: "mutation", token: Number.MAX_SAFE_INTEGER });
    await done; db.close();
    await expect(store.put(record)).rejects.toMatchObject({ code: "write-failed", retryable: false });
    expect(await store.snapshot()).toEqual({ records: [], mutationToken: Number.MAX_SAFE_INTEGER });
  });

  it("serializes simultaneous first opens and does not advance provider generations on subsequent retry", async () => {
    const opts = options(); const first = createProductionProviderIntegration(opts); const second = createProductionProviderIntegration(opts);
    expect(await Promise.all([first.initialization.initialize(), second.initialization.initialize()])).toEqual([{ status: "ready" }, { status: "ready" }]);
    const tokens = async () => Promise.all([first.compositionProviders[0]!.store.mutationToken!(), first.contentProvider.store.readAll().then(({ mutationToken }) => mutationToken), first.mappingProvider.store.mutationToken!(), first.sitemapProvider.store.mutationToken!()]);
    const before = await tokens(); await second.initialization.retry();
    expect(await tokens()).toEqual(before);
  });
  it("keeps B edits after captured A, source activation/reload, and rejected A reconciliation", async () => {
    const opts = options();
    const media = { descriptor: { id: "files" }, store: { mutationToken: async () => "media-token", snapshot: async () => ({ schemaVersion: 2, mutationToken: "media-token", records: [], folders: [] }) } } as unknown as MediaFileProvider;
    const current = createProductionProviderIntegration({ ...opts, mediaProvider: media });
    const approved = await current.captureWorkspace();
    expect(approved.status).toBe("ready"); if (approved.status !== "ready") return;
    const loaded = await current.compositionProviders[0]!.store.get("services-page");
    if (loaded.status !== "loaded") throw new Error("Missing sample");
    await current.compositionProviders[0]!.store.put({ ...loaded.record, document: { ...loaded.record.document, name: "Newer B" } });
    expect(await current.isCaptureCurrent(approved.capture)).toBe(false);
    expect(await current.workspace.reconcileBaseline(approved.capture, "b".repeat(64))).toBe("changed");
    const sourceA = structuredClone(approved.project); sourceA.name = "Activated A";
    const reload = createProductionProviderIntegration({ ...opts, project: sourceA, sourceRevision: "b".repeat(64) });
    const working = await reload.getCurrentSiteProject();
    expect(working).toMatchObject({ status: "ready", project: { name: opts.project.name, providers: { compositions: [{ records: expect.arrayContaining([expect.objectContaining({ document: expect.objectContaining({ name: "Newer B" }) })]) }] } } });
    expect((await opts.compositionIdbFactory.databases()).map(({ name }) => name).filter((name) => name?.includes("site-project--"))).toEqual([]);
    expect(reload.workspace.id).toBe(current.workspace.id);
  });

  it("persists authored active Sitemap/name and never re-inserts deleted seed entries on retry/reload", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts);
    await current.initialization.initialize();
    const original = await current.sitemapProvider.store.get("sample-studio-sitemap");
    if (original.status !== "loaded") throw new Error("Missing sample");
    await current.sitemapProvider.store.put({ ...original.record, id: "second", document: { ...original.record.document, id: "second", name: "Second" } });
    const meta = await current.workspace.metadata();
    await current.workspace.updateMetadata(meta.mutationToken, { name: "My authored project", activeSitemap: { providerId: "sitemap-indexeddb", recordId: "second" } });
    await current.contentProvider.store.deleteEntry("about-entry");
    await current.initialization.retry();
    const reload = createProductionProviderIntegration(opts);
    const snapshot = await reload.getCurrentSiteProject();
    expect(snapshot).toMatchObject({ status: "ready", project: { name: "My authored project", activeSitemap: { recordId: "second" } } });
    expect(await reload.contentProvider.store.getEntry("about-entry")).toMatchObject({ status: "not-found" });
  });

  it("refreshes summary from committed provider writes across integrations and does not emit on failed writes", async () => {
    const opts = options(); const first = createProductionProviderIntegration(opts); const other = createProductionProviderIntegration(opts);
    await first.initialization.initialize(); await other.initialization.initialize();
    const summary = createWorkspaceSummary(first);
    expect(await summary.counts()).toMatchObject({ content: { value: { entries: 4 } } });
    await other.contentProvider.store.deleteEntry("about-entry");
    expect(await summary.counts()).toMatchObject({ content: { value: { entries: 3 } } });
    const changed = vi.fn(); const stop = first.subscribeChanges(changed);
    await expect(other.mappingProvider.store.put({} as never)).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();
    stop(); summary.dispose?.();
  });

  it("reset selects a complete new namespace while the original remains openable and pending creation remains unselected", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const meta = await current.workspace.metadata(); await current.workspace.updateMetadata(meta.mutationToken, { name: "Keep me" });
    const storage = createWorkspaceStorage(opts.compositionIdbFactory);
    await storage.create(opts.project, revision, "interrupted");
    expect((await storage.open())!.id).toBe(current.workspace.id);
    const next = await current.workspace.reset();
    expect(next.workspace.id).not.toBe(current.workspace.id);
    expect(next.sessions).toBe(current.sessions);
    expect((await storage.open())!.id).toBe(next.workspace.id);
    expect((await current.workspace.open(current.workspace.id!)).workspace.id).toBe(current.workspace.id);
    expect((await current.getCurrentSiteProject())).toMatchObject({ status: "ready", project: { name: "Keep me" } });
    expect((await opts.compositionIdbFactory.databases()).map(({ name }) => name)).toContain(workspaceDatabaseName("zudo-composer", current.workspace.id!));
  });

  it("reports the absent Media capability instead of declaring a complete release capture", async () => {
    const current = createProductionProviderIntegration(options());
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
    expect(await current.captureWorkspace()).toMatchObject({ status: "unavailable", source: "capabilities", error: { message: expect.stringContaining("Media is unavailable") } });
  });

  it("preserves old selection and drafts when new-workspace selection commit fails", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const storage = createWorkspaceStorage(opts.compositionIdbFactory);
    const originalPut = FakeObjectStore.prototype.put;
    const spy = vi.spyOn(FakeObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "selection" && value !== current.workspace.id) throw new Error("selection commit failed");
      return originalPut.call(this, value, key);
    });
    try { await expect(current.workspace.reset()).rejects.toThrow("selection commit failed"); }
    finally { spy.mockRestore(); }
    expect((await storage.open())!.id).toBe(current.workspace.id);
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
  });

  it("fails closed on a dangling selected ID instead of creating or seeding another workspace", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const db = await requestValue(opts.compositionIdbFactory.open("zudo-composer-workspaces-v1"));
    const tx = db.transaction("selection", "readwrite"); const done = new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    tx.objectStore("selection").put("missing", "active"); await done; db.close();
    const names = await opts.compositionIdbFactory.databases();
    const reload = createProductionProviderIntegration(opts);
    expect(await reload.initialization.initialize()).toMatchObject({ status: "error", error: { message: expect.stringContaining("missing") } });
    expect(await opts.compositionIdbFactory.databases()).toEqual(names);
    expect((await current.workspace.open(current.workspace.id!)).workspace.id).toBe(current.workspace.id);
  });

  it("ignores preference wakeups and observer failures without misreporting committed saves", async () => {
    const current = createProductionProviderIntegration(options()); await current.initialization.initialize();
    const changed = vi.fn(); const stop = current.subscribeChanges(changed);
    notifyPersistenceChange("sidebar-preferences"); expect(changed).not.toHaveBeenCalled();
    const stopThrowing = current.subscribeChanges(() => { throw new Error("observer bug"); });
    await expect(current.contentProvider.store.deleteEntry("about-entry")).resolves.toBe(true);
    expect(await current.contentProvider.store.getEntry("about-entry")).toMatchObject({ status: "not-found" });
    stopThrowing(); stop();
  });

  it("opens persisted provider catalogs when the active source becomes unavailable", async () => {
    const opts = options(); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const reload = createProductionProviderIntegration({ ...opts, project: null, sourceRevision: null });
    expect(await reload.getCurrentSiteProject()).toMatchObject({ status: "ready" });
    expect((await reload.compositionCatalog.listCompositions()).entries).toHaveLength(6);
    expect(await reload.mappingCompositionCatalog.resolve({ providerId: "indexeddb", recordId: "services-page" })).toMatchObject({ status: "resolved" });
  });
});
