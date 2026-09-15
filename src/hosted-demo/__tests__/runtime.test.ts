import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeSiteProjectRevision } from "../../app/empty-site-project";
import { validateSiteProject, type SiteProject } from "../../site-project";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { createDemoWorkspaceProviders } from "../workspaces";
import { createDemoAsset } from "../assets";
import { prepareDemoAsset } from "../../../scripts/hosted-demo/prepare";
import { DEMO_EDITOR_HOSTS } from "../../../scripts/demo-editor-hosts.mjs";
import { loadHostContext } from "../../../server/host-context.mjs";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe.each(Object.entries(DEMO_EDITOR_HOSTS))("disposable %s editor runtime", (name, directory) => {
  let project: SiteProject;
  let host: Awaited<ReturnType<typeof loadHostContext>>;
  let seed: Awaited<ReturnType<typeof prepareDemoAsset>>;
  let createIntegration: typeof import("../../app/provider-integration").createProductionProviderIntegration;

  beforeAll(async () => {
    host = await loadHostContext({ workspaceRoot: resolve(repositoryRoot, directory), env: {} });
    const input = JSON.parse(await readFile(resolve(host.workspaceRoot, "site-project.json"), "utf8"));
    const validated = validateSiteProject(input, { componentPack: host.pack.manifest });
    if (!validated.ok) throw new Error(`${name} demo project is invalid`);
    project = validated.project;
    seed = await prepareDemoAsset(host.composerConfig.paths.assets);

    // Production integration must see this host's real pack, including every
    // component schema. The app test lane's default sample aliases cannot
    // validate the webshop, landing or blog projects.
    vi.resetModules();
    vi.doMock("virtual:zudo-composer-pack", () => ({ componentPack: host.pack }));
    vi.doMock("virtual:site-project-source", () => ({ default: null, siteProject: null, siteProjectRevision: null, deliverySource: { status: "no-active" } }));
    createIntegration = (await import("../../app/provider-integration")).createProductionProviderIntegration;
  });

  afterAll(() => {
    vi.doUnmock("virtual:zudo-composer-pack");
    vi.doUnmock("virtual:site-project-source");
    vi.resetModules();
  });

  async function assets() {
    return createDemoAsset({ snapshot: seed.snapshot, bytes: Object.fromEntries(seed.files.map((file) => [file.fileName.match(/sha256-([a-f0-9]+)/)![1]!, file.source])) });
  }
  async function integration() {
    return createIntegration({ project, sourceRevision: await computeSiteProjectRevision(project), createProviders: createDemoWorkspaceProviders(), assetProvider: (await assets()).provider });
  }

  if (name === "sample") it("shares the generated sample project with the detached test seed", async () => {
    const context = { componentPack: host.pack.manifest };
    const fixture = loadSampleSiteProject(context);
    expect(fixture).toEqual(project);
    expect(await computeSiteProjectRevision(fixture)).toBe(await computeSiteProjectRevision(project));
    fixture.name = "A test's private edit";
    expect(loadSampleSiteProject(context)).toEqual(project);
    expect(project.name).toBe("Sample Studio");
  });

  it("initializes with its own pack, captures coherently and isolates/reset realms", async () => {
    const a = await integration();
    const b = await integration();
    expect(a.componentProvider.manifest.packId).toBe(project.componentPack.packId);
    expect(await a.initialization.initialize()).toEqual({ status: "ready" });
    expect(await b.initialization.initialize()).toEqual({ status: "ready" });
    const capture = await a.captureWorkspace();
    expect(capture.status).toBe("ready");
    if (capture.status !== "ready") throw new Error(JSON.stringify(capture));
    expect(capture.project.componentPack).toEqual(project.componentPack);
    expect(await a.isCaptureCurrent(capture.capture)).toBe(true);
    const record = capture.project.providers.compositions[0]!.records[0]!;
    record.document.name = "Changed in this tab";
    await a.compositionProviders[0]!.store.put(record);
    expect(await a.isCaptureCurrent(capture.capture)).toBe(false);
    expect((await a.getCurrentSiteProject()).status).toBe("ready");
    const other = await b.getCurrentSiteProject();
    expect(other.status).toBe("ready");
    if (other.status === "ready") expect(other.project.providers.compositions[0]!.records.find((item) => item.id === record.id)!.document.name).not.toBe(record.document.name);
    const reset = await a.workspace.reset();
    const resetProject = await reset.getCurrentSiteProject();
    expect(resetProject.status).toBe("ready");
    if (resetProject.status === "ready") expect(resetProject.project.providers.compositions[0]!.records.find((item) => item.id === record.id)!.document.name).toBe(project.providers.compositions[0]!.records.find((item) => item.id === record.id)!.document.name);
    const content = await a.contentProvider.store.readAll();
    const model = structuredClone(content.models[0]!);
    model.document.name = "Changed model";
    await a.contentProvider.store.transact({ expectedMutationToken: content.mutationToken, operations: [{ kind: "put-model", record: model }] });
    await expect(a.contentProvider.store.transact({ expectedMutationToken: content.mutationToken, operations: [] })).rejects.toMatchObject({ code: "conflict" });
    expect((await a.captureWorkspace()).status).toBe("ready");
  });

  it("serves this host's bytes and validates assets CAS, cloning and handoff", async () => {
    const a = await assets();
    const before = await a.provider.store.snapshot();
    expect(before.records).toHaveLength(seed.snapshot.records.length);
    const first = before.records[0]!;
    const version = first.document.versions[0]!;
    expect(a.readUrl(version.url)?.bytes).toEqual(new Uint8Array(await readFile(resolve(host.composerConfig.paths.assets, "versions", version.url.split("/").at(-1)!))));
    const changed = await a.provider.store.updateMetadata(first.id, { note: "Edited" }, { expectedRevision: first.revision });
    await expect(a.provider.store.trash(first.id, { expectedRevision: first.revision })).rejects.toMatchObject({ code: "conflict" });
    const trash = await a.provider.store.trash(first.id, { expectedRevision: changed.revision });
    expect(a.readUrl(`/uploaded-assets/asset-${first.id}`)).toBeNull();
    expect(await a.provider.store.resolveVersion({ providerId: "asset-files", assetId: first.id, versionId: version.id })).toMatchObject({ checksum: version.checksum });
    await a.provider.store.restore(first.id, { expectedRevision: trash.revision });
    const snapshot = await a.provider.store.snapshot();
    snapshot.records[0]!.document.note = "mutation leak";
    expect((await a.provider.store.snapshot()).records[0]!.document.note).toBe("Edited");
    const handoff = await createDemoAsset(a.exportSeed());
    expect(await handoff.provider.store.snapshot()).toEqual(await a.provider.store.snapshot());
    const b = await assets();
    expect((await b.provider.store.snapshot()).records[0]!.document.note).not.toBe("Edited");
  });

  it("uses separate Git and canonical project revision domains", async () => {
    expect(await computeSiteProjectRevision(project)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uploads new bytes, preserves versions and enforces folder graph/CAS", async () => {
    const a = await assets();
    const b = await assets();
    const original = Object.values(a.exportSeed().bytes)[0]!;
    const bytes = new Uint8Array([...original, 1]);
    const file = { name: "new-demo.webp", type: "image/webp", arrayBuffer: async () => bytes.buffer } as unknown as Blob & { name: string };
    const uploaded = await a.provider.store.upload(file);
    const url = uploaded.document.versions[0]!.url;
    expect(a.readUrl(url)?.bytes).toEqual(bytes);
    expect(b.readUrl(url)).toBeNull();
    const handoff = await createDemoAsset(a.exportSeed());
    expect(handoff.readUrl(url)?.bytes).toEqual(bytes);
    const folder = await a.provider.store.createFolder({ name: "Images", parentId: null }, await a.provider.store.mutationToken());
    const moved = await a.provider.store.updateMetadata(uploaded.id, { folderId: folder.id }, { expectedRevision: uploaded.revision });
    await expect(a.provider.store.trashFolder(folder.id, { expectedRevision: folder.revision })).rejects.toMatchObject({ code: "validation" });
    const replacement = { type: "image/webp", arrayBuffer: async () => original.buffer } as unknown as Blob;
    const replaced = await a.provider.store.replace(uploaded.id, replacement, { expectedRevision: moved.revision });
    expect(replaced.document.versions).toHaveLength(2);
    expect(a.readUrl(url)?.bytes).toEqual(bytes);
    const snapshot = await a.provider.store.snapshot();
    await expect(a.provider.store.updateFolder(folder.id, { parentId: folder.id }, { expectedRevision: folder.revision })).rejects.toMatchObject({ code: "validation" });
    expect(await a.provider.store.snapshot()).toEqual(snapshot);
    const unsupported = { name: "new-demo.html", type: "text/html", arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Blob & { name: string };
    await expect(a.provider.store.upload(unsupported)).rejects.toMatchObject({ code: "validation" });
  });
});
