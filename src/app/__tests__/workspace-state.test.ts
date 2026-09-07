import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceSaveRegistry } from "../workspace-sessions";
import { captureWorkspaceSnapshot, type WorkspaceSnapshotSource } from "../workspace-snapshot";
import { createProductionProviderIntegration } from "../provider-integration";
import { createWorkspaceSummary } from "../workspace-summary";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from "../../test/workspace-providers";
import { createSaveQueue } from "../../shared/persistence/save-queue";
import type { MediaFileProvider } from "../../media";
import { notifyPersistenceChange } from "../../shared/persistence-generation";

const revision = "a".repeat(64);
const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);

const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((value) => value.dispose())); });

/** One temporary host project, shared by every integration a test opens over it. */
async function host(): Promise<TemporaryWorkspaceProviders> {
  const value = await createTemporaryWorkspaceProviders();
  hosts.push(value);
  return value;
}

function options(current: TemporaryWorkspaceProviders) {
  return { project: sample(), sourceRevision: revision, createProviders: current.createProviders, mediaProvider: null };
}

function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }

describe("workspace save and capture lifetime", () => {
  it("retains and flushes the latest queued edit after route unmount", async () => {
    const first = deferred(); const saved: string[] = [];
    const ref = { providerId: "content-filesystem", recordId: "entry" };
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
  it("serializes simultaneous first opens and does not advance provider generations on subsequent retry", async () => {
    const opts = options(await host());
    const first = createProductionProviderIntegration(opts); const second = createProductionProviderIntegration(opts);
    expect(await Promise.all([first.initialization.initialize(), second.initialization.initialize()])).toEqual([{ status: "ready" }, { status: "ready" }]);
    const tokens = async () => Promise.all([first.compositionProviders[0]!.store.mutationToken!(), first.contentProvider.store.readAll().then(({ mutationToken }) => mutationToken), first.mappingProvider.store.mutationToken!(), first.sitemapProvider.store.mutationToken!()]);
    const before = await tokens(); await second.initialization.retry();
    expect(await tokens()).toEqual(before);
  });

  it("keeps B edits after captured A, source activation/reload, and rejected A reconciliation", async () => {
    const opts = options(await host());
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
    expect(reload.workspace.id).toBe(current.workspace.id);
  });

  it("persists authored active Sitemap/name and never re-inserts deleted seed entries on retry/reload", async () => {
    const opts = options(await host()); const current = createProductionProviderIntegration(opts);
    await current.initialization.initialize();
    const original = await current.sitemapProvider.store.get("sample-studio-sitemap");
    if (original.status !== "loaded") throw new Error("Missing sample");
    await current.sitemapProvider.store.put({ ...original.record, id: "second", document: { ...original.record.document, id: "second", name: "Second" } });
    const meta = await current.workspace.metadata();
    await current.workspace.updateMetadata(meta.mutationToken, { name: "My authored project", activeSitemap: { providerId: "sitemap-filesystem", recordId: "second" } });
    await current.contentProvider.store.deleteEntry("about-entry");
    await current.initialization.retry();
    const reload = createProductionProviderIntegration(opts);
    const snapshot = await reload.getCurrentSiteProject();
    expect(snapshot).toMatchObject({ status: "ready", project: { name: "My authored project", activeSitemap: { recordId: "second" } } });
    expect(await reload.contentProvider.store.getEntry("about-entry")).toMatchObject({ status: "not-found" });
  });

  it("refreshes summary from committed provider writes across integrations and does not emit on failed writes", async () => {
    const opts = options(await host()); const first = createProductionProviderIntegration(opts); const other = createProductionProviderIntegration(opts);
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

  it("reset selects a complete new workspace while the original stays openable with its own directories", async () => {
    const project = await host();
    const opts = options(project); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const meta = await current.workspace.metadata(); await current.workspace.updateMetadata(meta.mutationToken, { name: "Keep me" });
    await project.storage.create(opts.project, revision, "interrupted");
    expect((await project.storage.open())!.id).toBe(current.workspace.id);
    const next = await current.workspace.reset();
    expect(next.workspace.id).not.toBe(current.workspace.id);
    expect(next.sessions).toBe(current.sessions);
    expect((await project.storage.open())!.id).toBe(next.workspace.id);
    expect((await current.workspace.open(current.workspace.id!)).workspace.id).toBe(current.workspace.id);
    expect((await current.getCurrentSiteProject())).toMatchObject({ status: "ready", project: { name: "Keep me" } });
    expect(await project.storage.missingDirectories(current.workspace.id!)).toEqual([]);
  });

  it("reports the absent Media capability instead of declaring a complete release capture", async () => {
    const current = createProductionProviderIntegration(options(await host()));
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
    expect(await current.captureWorkspace()).toMatchObject({ status: "unavailable", source: "capabilities", error: { message: expect.stringContaining("Media is unavailable") } });
  });

  it("refuses a ready workspace whose authoring directories were removed outside the application", async () => {
    const project = await host();
    const current = createProductionProviderIntegration(options(project));
    await current.initialization.initialize();
    await project.storage.deleteDirectories(current.workspace.id!);
    const reload = createProductionProviderIntegration(options(project));
    expect(await reload.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: false, message: expect.stringContaining("files are missing") } });
  });

  it("ignores preference wakeups and observer failures without misreporting committed saves", async () => {
    const current = createProductionProviderIntegration(options(await host())); await current.initialization.initialize();
    const changed = vi.fn(); const stop = current.subscribeChanges(changed);
    notifyPersistenceChange("sidebar-preferences"); expect(changed).not.toHaveBeenCalled();
    const stopThrowing = current.subscribeChanges(() => { throw new Error("observer bug"); });
    await expect(current.contentProvider.store.deleteEntry("about-entry")).resolves.toBe(true);
    expect(await current.contentProvider.store.getEntry("about-entry")).toMatchObject({ status: "not-found" });
    stopThrowing(); stop();
  });

  it("opens persisted provider catalogs when the active source becomes unavailable", async () => {
    const opts = options(await host()); const current = createProductionProviderIntegration(opts); await current.initialization.initialize();
    const reload = createProductionProviderIntegration({ ...opts, project: null, sourceRevision: null });
    expect(await reload.getCurrentSiteProject()).toMatchObject({ status: "ready" });
    expect((await reload.compositionCatalog.listCompositions()).entries).toHaveLength(6);
    expect(await reload.mappingCompositionCatalog.resolve({ providerId: "files", recordId: "services-page" })).toMatchObject({ status: "resolved" });
  });
});
