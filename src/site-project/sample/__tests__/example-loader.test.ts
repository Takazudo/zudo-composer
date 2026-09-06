import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createFilesystemMediaStore } from "../../../media/storage/filesystem";
import type { MediaFileProvider, MediaFileProviderStore } from "../../../media";
import { createProductionProviderIntegration } from "../../../app/provider-integration";
import { createWorkspaceStorage, workspaceDatabaseName, WORKSPACE_DATABASE_NAME } from "../../../app/workspace-storage";
import { requestValue } from "../../../shared/persistence-generation";
import { COMPOSER_DATABASE_NAME } from "../../../composer/storage/indexeddb/types";
import { activeSiteProjectValidationContext } from "../../../app/site-project-manifest";
import { activeComponentProvider } from "../../../features/composer/active-pack";
import { compileSiteProject } from "../../compiler";
import { captureSiteProjectMediaLock } from "../../media/capture";
import { createReleasePlan } from "../../api/review";
import type { SiteProjectApiDependencies } from "../../api/types";
import { loadSampleSiteProject } from "../index";
import { CATALOG_EDITORIAL_ATTEMPT_ID, CATALOG_EDITORIAL_IDS as IDS, loadCatalogEditorialSiteProject } from "../catalog-editorial";
import { createCatalogEditorialExample, EXAMPLE_PDF_URL } from "../example-loader";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const context = activeSiteProjectValidationContext;
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "catalog-example-")); roots.push(root);
  const store = await createFilesystemMediaStore({ mediaStoreRoot: root });
  const bytes = new Uint8Array(await readFile("media-store/public/uploaded-media/deployment-sample.pdf"));
  const upload = vi.fn(async (file: File) => {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file); });
    return store.upload({ fileName: file.name, declaredMediaType: file.type, bytes: new Uint8Array(buffer) });
  });
  const browserStore = new Proxy(store, { get(target, property) { if (property === "upload") return upload; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } }) as unknown as MediaFileProviderStore;
  const media = { descriptor: store.provider, store: browserStore } as MediaFileProvider;
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })) as unknown as typeof globalThis.fetch;
  return { store, media, fetch, upload };
}
async function workspaceSetup() {
  const factory = new IDBFactory();
  const original = createProductionProviderIntegration({ project: loadSampleSiteProject(context), sourceRevision: "a".repeat(64), compositionIdbFactory: factory, contentIdbFactory: factory, mappingIdbFactory: factory, sitemapIdbFactory: factory, mediaProvider: null });
  expect(await original.initialization.initialize()).toMatchObject({ status: "ready" });
  const records = async () => { const db = await requestValue(factory.open(WORKSPACE_DATABASE_NAME)); try { return await requestValue(db.transaction("workspaces").objectStore("workspaces").getAll()); } finally { db.close(); } };
  return { factory, original, records, storage: createWorkspaceStorage(factory) };
}
it.each(["replace", "trash"] as const)("rejects Media %s after seed validation and removes the failed workspace before selecting it", async (mutation) => {
  const fixture = await setup(), { original, storage, factory, records } = await workspaceSetup();
  let attemptId = "";
  await expect(createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: (project, revision, commit) => {
    attemptId = commit.attemptId;
    return original.workspace.loadExample(project, revision, { ...commit, beforeComplete: async () => {
      const record = (await fixture.store.snapshot()).records[0]!;
      if (mutation === "trash") await fixture.store.trash(record.id, { expectedRevision: record.revision });
      else await fixture.store.replace(record.id, { bytes: new TextEncoder().encode("%PDF-1.4\nchanged") }, { expectedRevision: record.revision });
      await commit.beforeComplete();
    } });
  } })).rejects.toThrow("Media changed before workspace selection");
  expect((await storage.open())!.id).toBe(original.workspace.id);
  expect((await records()).map((record) => record.id)).toEqual([original.workspace.id]);
  expect((await factory.databases()).some(({ name }) => name?.endsWith(attemptId))).toBe(false);
});
it.each(["unchanged", "trash", "replace"] as const)("retains one blocked cleanup identity and reseeds CURRENT data after Media is %s", async (mutation) => {
  const fixture = await setup(), { original, storage, factory, records } = await workspaceSetup();
  const deletes = vi.spyOn(factory, "deleteDatabase");
  let held!: IDBDatabase, attemptId = "";
  const first = () => createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: (project, revision, commit) => {
    attemptId = commit.attemptId;
    return original.workspace.loadExample(project, revision, { ...commit, beforeComplete: async () => {
      held = await requestValue(factory.open(workspaceDatabaseName(COMPOSER_DATABASE_NAME, attemptId)));
      held.onversionchange = () => undefined;
      throw new Error("injected post-seed failure");
    } });
  } });
  try {
    await expect(first()).rejects.toThrow("cleanup is incomplete");
    expect(await records()).toHaveLength(2);
    expect(await storage.open(attemptId)).toMatchObject({ status: "seeding", seedCleanupPending: true });
    expect(attemptId).toBe(CATALOG_EDITORIAL_ATTEMPT_ID);
    const oldRevision = (await storage.open(attemptId))!.baselineRevision;
    const oldMedia = (await fixture.store.snapshot()).records[0]!;
    if (mutation === "trash") await fixture.store.trash(oldMedia.id, { expectedRevision: oldMedia.revision });
    if (mutation === "replace") await fixture.store.replace(oldMedia.id, { bytes: new TextEncoder().encode("%PDF-1.4\nreplacement") }, { expectedRevision: oldMedia.revision });
    await expect(original.workspace.open(attemptId)).rejects.toThrow("original validated loader");
    const retry = () => createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: (project, revision, commit) => {
      expect(commit.attemptId).toBe(attemptId);
      return original.workspace.loadExample(project, revision, commit);
    } });
    await expect(retry()).rejects.toThrow("cleanup is incomplete");
    expect(await records()).toHaveLength(2); expect((await storage.open())!.id).toBe(original.workspace.id);
    expect((await storage.open(attemptId))!.baselineRevision).toBe(oldRevision);
    expect(deletes.mock.calls.filter(([name]) => name === workspaceDatabaseName(COMPOSER_DATABASE_NAME, attemptId))).toHaveLength(1);
    held.close();
    const result = await retry();
    expect(result!.value.workspace.id).toBe(attemptId);
    expect(await records()).toHaveLength(2);
    expect(await storage.open(attemptId)).toMatchObject({ status: "ready" });
    expect((await factory.databases()).filter(({ name }) => name?.endsWith(attemptId))).toHaveLength(4);
    expect(fixture.upload).toHaveBeenCalledTimes(mutation === "unchanged" ? 1 : 2);
    const captured = await result!.value.getCurrentSiteProject();
    expect(captured).toMatchObject({ status: "ready" });
    if (mutation !== "unchanged" && captured.status === "ready") {
      expect((await storage.open(attemptId))!.baselineRevision).not.toBe(oldRevision);
      const resource = captured.project.providers.content[0]!.entries.find(({ id }) => id === IDS.entries.products[0])!.values[IDS.fields.productResource] as { asset: { assetId: string } };
      expect(resource.asset.assetId).not.toBe(oldMedia.id);
      expect((await fixture.store.snapshot()).records.find(({ id }) => id === resource.asset.assetId)?.document.state).toBe("active");
    }
    expect((await storage.open(attemptId))!.seed).toBeUndefined();
    expect(await result!.value.initialization.retry()).toMatchObject({ status: "ready" });
    await expect(storage.markSeedCleanup(attemptId, (await storage.open(attemptId))!.baselineRevision)).rejects.toThrow("Only an unselected");
    await expect(storage.discardSeeding(attemptId, (await storage.open(attemptId))!.baselineRevision)).rejects.toThrow("Only a cleaned");
  } finally { held?.close(); deletes.mockRestore(); }
});
it("rejects mismatched non-cleanup or ready example identities without rebinding them", async () => {
  const { original, storage } = await workspaceSetup();
  const project = loadCatalogEditorialSiteProject(context);
  await storage.create(project, "b".repeat(64), CATALOG_EDITORIAL_ATTEMPT_ID, true);
  const changed = { ...project, name: "A different requested project" };
  await expect(original.workspace.loadExample(changed, "c".repeat(64), { attemptId: CATALOG_EDITORIAL_ATTEMPT_ID, beforeComplete: async () => {} })).rejects.toThrow("different or completed identity");
  const loaded = await original.workspace.loadExample(project, "b".repeat(64), { attemptId: CATALOG_EDITORIAL_ATTEMPT_ID, beforeComplete: async () => {} });
  await expect(original.workspace.loadExample(changed, "c".repeat(64), { attemptId: CATALOG_EDITORIAL_ATTEMPT_ID, beforeComplete: async () => {} })).rejects.toThrow("different or completed identity");
  expect((await storage.open())!.id).toBe(loaded.workspace.id);
  expect((await storage.open(CATALOG_EDITORIAL_ATTEMPT_ID))!.metadata.name).toBe(project.name);
  await storage.create(project, "b".repeat(64), "generic-attempt", true);
  await storage.markSeedCleanup("generic-attempt", "b".repeat(64));
  await expect(storage.create(changed, "c".repeat(64), "generic-attempt", true)).rejects.toThrow("different or completed identity");
});
it("cannot bypass a persisted creation guard by ordinarily opening or completing a crash-interrupted seed", async () => {
  const { original, storage } = await workspaceSetup();
  const project = loadCatalogEditorialSiteProject(context), beforeComplete = vi.fn();
  await storage.create(project, "b".repeat(64), "guarded-seed", true);
  await expect(original.workspace.open("guarded-seed")).rejects.toThrow("original validated loader");
  await expect(storage.complete("guarded-seed")).rejects.toThrow("before-complete validation");
  expect((await storage.open())!.id).toBe(original.workspace.id);
  const next = await original.workspace.loadExample(project, "b".repeat(64), { attemptId: "guarded-seed", beforeComplete });
  expect(beforeComplete).toHaveBeenCalledTimes(1); expect(next.workspace.id).toBe("guarded-seed");
});
it("reports post-selection Media drift as a created mutable workspace, not a failed or permanently pinned creation", async () => {
  const fixture = await setup(), { original, storage } = await workspaceSetup();
  const result = await createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: async (project, revision, commit) => {
    const next = await original.workspace.loadExample(project, revision, commit);
    const record = (await fixture.store.snapshot()).records[0]!;
    await fixture.store.trash(record.id, { expectedRevision: record.revision });
    return next;
  } });
  expect(result).toMatchObject({ mediaStatus: "changed", message: expect.stringContaining("not permanently pinned") });
  expect((await storage.open())!.id).toBe(result!.value.workspace.id);
});
it("does nothing on cancel or unavailable capability, including no Media reads or project switch", async () => {
  const loadExample = vi.fn(); const fetch = vi.fn();
  expect(await createCatalogEditorialExample({ confirmed: false, context, media: null, loadExample, fetch })).toBeUndefined();
  await expect(createCatalogEditorialExample({ confirmed: true, context, media: null, loadExample, fetch })).rejects.toThrow("requires the local development");
  expect(loadExample).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("validates before upload, rejects corrupted fixture bytes and never calls the workspace writer", async () => {
  const fixture = await setup(), loadExample = vi.fn();
  const wrongContext = { componentPack: { ...context.componentPack, packVersion: "999" } };
  await expect(createCatalogEditorialExample({ ...fixture, confirmed: true, context: wrongContext, loadExample })).rejects.toThrow("invalid");
  expect(fixture.upload).not.toHaveBeenCalled();
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer })) as unknown as typeof globalThis.fetch;
  await expect(createCatalogEditorialExample({ ...fixture, fetch, confirmed: true, context, loadExample })).rejects.toThrow("integrity");
  expect(fixture.upload).not.toHaveBeenCalled(); expect(loadExample).not.toHaveBeenCalled();
});
it("preserves the current workspace after later creation failure and retries by reusing verified global Media", async () => {
  const fixture = await setup(); const factory = new IDBFactory();
  const original = createProductionProviderIntegration({ project: loadSampleSiteProject(context), sourceRevision: "a".repeat(64), compositionIdbFactory: factory, contentIdbFactory: factory, mappingIdbFactory: factory, sitemapIdbFactory: factory, mediaProvider: null });
  expect(await original.initialization.initialize()).toMatchObject({ status: "ready" });
  const originalId = original.workspace.id!;
  const storage = createWorkspaceStorage(factory);
  const openDatabase = factory.open.bind(factory);
  const failure = vi.spyOn(factory, "open").mockImplementation((name, version) => {
    if (name.includes("-workspace-v1-") && !name.endsWith(originalId)) throw new Error("workspace write unavailable");
    return openDatabase(name, version);
  });
  await expect(createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: (project, revision, commit) => original.workspace.loadExample(project, revision, commit) })).rejects.toThrow();
  failure.mockRestore();
  expect((await storage.open())!.id).toBe(originalId);
  expect((await fixture.store.snapshot()).records).toHaveLength(1);
  const result = await createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: (project, revision, commit) => original.workspace.loadExample(project, revision, commit) });
  const loaded = result!.value;
  expect(loaded!.workspace.id).not.toBe(originalId);
  expect((await storage.open())!.id).toBe(loaded!.workspace.id);
  expect((await storage.open(originalId))!.metadata.name).toBe("Sample Studio");
  expect(fixture.upload).toHaveBeenCalledTimes(1);
  expect(fixture.fetch).toHaveBeenCalledWith(EXAMPLE_PDF_URL, { credentials: "same-origin", redirect: "error" });
  const captured = await loaded!.getCurrentSiteProject();
  expect(captured.status).toBe("ready"); if (captured.status !== "ready") return;
  const media = await captureSiteProjectMediaLock(captured.project, activeComponentProvider.catalog, fixture.store);
  expect(media.status).toBe("ready"); if (media.status !== "ready") return;
  expect(media.lock!.pins).toHaveLength(1);
  const release = await compileSiteProject(captured.project, { componentCatalog: activeComponentProvider.catalog, policy: "release", mediaLock: media.lock });
  expect(release.status).toBe("ready"); if (release.status !== "ready") return;
  expect(release.build.routes.some((route) => route.pathname.includes("supply-notes"))).toBe(false);
  const reopened = await loaded!.workspace.open(originalId);
  expect((await reopened.getCurrentSiteProject()).status).toBe("ready");
});
it("reviews a selected draft over its baseline with exact Media dependencies and reports missing unselected dependencies", async () => {
  const fixture = await setup();
  const project = (await createCatalogEditorialExample({ ...fixture, confirmed: true, context, loadExample: async (project, _revision, commit) => { await commit.beforeComplete(); return project; } }))!.value;
  const baseline = structuredClone(project);
  baseline.providers.content[0]!.entries = baseline.providers.content[0]!.entries.filter((record) => record.lifecycle === "published");
  const selection = [{ ref: { providerId: "content-indexeddb", modelId: IDS.models.news, recordId: IDS.entries.news[3] }, action: "publish" as const }];
  const deps: SiteProjectApiDependencies = { get projectStore(): never { throw new Error("Review must not write a stage"); }, get buildStore(): never { throw new Error("Review must not build"); }, componentCatalog: activeComponentProvider.catalog, mediaStore: fixture.store, hash: async (text: string) => createHash("sha256").update(text).digest("hex"), toolchain: { compiler: "test", componentPack: project.componentPack, providerCommit: "a".repeat(40), providerTree: "b".repeat(40), installedProviderDigest: "c".repeat(64), contractDigest: "d".repeat(64) } };
  const input = { project, baseline, selection, workingPrecondition: null, expectedRevision: null, expectedActive: null, storeGeneration: 0 };
  const plan = await createReleasePlan(input, deps);
  expect(plan.checks.filter((check) => check.severity === "blocking")).toEqual([]);
  expect(plan.publication).toHaveLength(1); expect(plan.mediaLock!.pins).toHaveLength(1);
  expect(plan.affected.some((item) => item.identity.includes("supply-notes-for-the-next-season"))).toBe(true);
  const missing = await createReleasePlan({ ...input, baseline: null }, deps);
  expect(missing.checks.some((check) => check.severity === "blocking" && check.code.startsWith("content-"))).toBe(true);
  expect(loadCatalogEditorialSiteProject(context).providers.content[0]!.entries.find((entry) => entry.id === IDS.entries.news[3])!.lifecycle).toBe("draft");
});
