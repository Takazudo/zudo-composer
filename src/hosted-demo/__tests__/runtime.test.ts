import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createProductionProviderIntegration } from "../../app/provider-integration";
import { computeSiteProjectRevision } from "../../app/empty-site-project";
import { validateSiteProject } from "../../site-project";
import { activeSiteProjectValidationContext } from "../../app/site-project-manifest";
import sample from "../../../packages/demo-studio/site-project.json";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { siteProject } from "virtual:site-project-source";
import { createDemoWorkspaceProviders } from "../workspaces";
import { createDemoAsset } from "../assets";
import { prepareDemoAsset } from "../../../scripts/hosted-demo/prepare";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const validated = validateSiteProject(sample, activeSiteProjectValidationContext);
if (!validated.ok) throw new Error("Demo sample invalid");
const project = validated.project;
async function assets() { const seed = await prepareDemoAsset(resolve("cms/assets")); return createDemoAsset({ snapshot: seed.snapshot, bytes: Object.fromEntries(seed.files.map((f) => [f.fileName.match(/sha256-([a-f0-9]+)/)![1]!, f.source])) }); }
async function integration() { return createProductionProviderIntegration({ project, sourceRevision: await computeSiteProjectRevision(project), createProviders: createDemoWorkspaceProviders(), assetProvider: (await assets()).provider }); }
describe("disposable hosted runtime", () => {
  it("shares the generated studio project with the detached test seed and virtual source", async () => {
    const fixture = loadSampleSiteProject(activeSiteProjectValidationContext);
    expect(fixture).toEqual(project);
    expect(siteProject).toEqual(project);
    expect(await computeSiteProjectRevision(fixture)).toBe(await computeSiteProjectRevision(project));
    fixture.name = "A test's private edit";
    expect(loadSampleSiteProject(activeSiteProjectValidationContext)).toEqual(project);
    expect(sample.name).toBe("Sample Studio");
  });
  it("initializes all real domain contracts, captures coherently and isolates/reset realms", async () => {
    const a = await integration(); const b = await integration();
    expect(await a.initialization.initialize()).toEqual({ status: "ready" });
    expect(await b.initialization.initialize()).toEqual({ status: "ready" });
    const capture = await a.captureWorkspace(); expect(capture.status).toBe("ready"); if (capture.status !== "ready") throw new Error(JSON.stringify(capture));
    expect(await a.isCaptureCurrent(capture.capture)).toBe(true);
    const record = capture.project.providers.compositions[0]!.records[0]!;
    record.document.name = "Changed in this tab"; await a.compositionProviders[0]!.store.put(record);
    expect(await a.isCaptureCurrent(capture.capture)).toBe(false);
    const changed = await a.getCurrentSiteProject(); expect(changed.status).toBe("ready");
    const other = await b.getCurrentSiteProject(); expect(other.status).toBe("ready"); if (other.status === "ready") expect(other.project.providers.compositions[0]!.records.find((r) => r.id === record.id)!.document.name).not.toBe(record.document.name);
    const reset = await a.workspace.reset(); expect((await reset.getCurrentSiteProject()).status).toBe("ready");
    const content = await a.contentProvider.store.readAll(); const model = structuredClone(content.models[0]!); model.document.name = "Changed model"; await a.contentProvider.store.transact({ expectedMutationToken: content.mutationToken, operations: [{ kind: "put-model", record: model }] });
    await expect(a.contentProvider.store.transact({ expectedMutationToken: content.mutationToken, operations: [] })).rejects.toMatchObject({ code: "conflict" });
    expect((await a.captureWorkspace()).status).toBe("ready");
  });
  it("serves exact bytes and validates assets CAS, cloning, folders, replacement history and handoff", async () => {
    const a = await assets(); const before = await a.provider.store.snapshot(); expect(before.records).toHaveLength(6);
    const first = before.records[0]!; const version = first.document.versions[0]!;
    expect(a.readUrl(version.url)?.bytes).toEqual(new Uint8Array(await readFile(resolve("cms/assets/versions", version.url.split("/").at(-1)!))));
    const changed = await a.provider.store.updateMetadata(first.id, { note: "Edited" }, { expectedRevision: first.revision });
    await expect(a.provider.store.trash(first.id, { expectedRevision: first.revision })).rejects.toMatchObject({ code: "conflict" });
    const trash = await a.provider.store.trash(first.id, { expectedRevision: changed.revision }); expect(a.readUrl(`/uploaded-assets/asset-${first.id}`)).toBeNull(); expect(await a.provider.store.resolveVersion({ providerId: "asset-files", assetId: first.id, versionId: version.id })).toMatchObject({ checksum: version.checksum });
    await a.provider.store.restore(first.id, { expectedRevision: trash.revision });
    const snapshot = await a.provider.store.snapshot(); snapshot.records[0]!.document.note = "mutation leak"; expect((await a.provider.store.snapshot()).records[0]!.document.note).toBe("Edited");
    const handoff = await createDemoAsset(a.exportSeed()); expect(await handoff.provider.store.snapshot()).toEqual(await a.provider.store.snapshot());
    const b = await assets(); expect((await b.provider.store.snapshot()).records[0]!.document.note).not.toBe("Edited");
  });
  it("uses separate Git and canonical project revision domains", async () => { expect(await computeSiteProjectRevision(project)).toMatch(/^[a-f0-9]{64}$/); });
});

it("uploads new bytes, preserves old versions and enforces folder graph/CAS", async () => {
  const a = await assets(); const b = await assets();
  const seed = a.exportSeed(); const original = Object.values(seed.bytes)[0]!;
  const bytes = new Uint8Array([...original, 1]);
  const file = { name: "new-demo.png", type: "image/png", arrayBuffer: async () => bytes.buffer } as unknown as Blob & { name: string };
  const uploaded = await a.provider.store.upload(file);
  const url = uploaded.document.versions[0]!.url;
  expect(a.readUrl(url)?.bytes).toEqual(bytes); expect(b.readUrl(url)).toBeNull();
  const handoff = await createDemoAsset(a.exportSeed()); expect(handoff.readUrl(url)?.bytes).toEqual(bytes);
  const folder = await a.provider.store.createFolder({ name: "Images", parentId: null }, await a.provider.store.mutationToken());
  const moved = await a.provider.store.updateMetadata(uploaded.id, { folderId: folder.id }, { expectedRevision: uploaded.revision });
  await expect(a.provider.store.trashFolder(folder.id, { expectedRevision: folder.revision })).rejects.toMatchObject({ code: "validation" });
  const replacement = { type: "image/png", arrayBuffer: async () => original.buffer } as unknown as Blob;
  const replaced = await a.provider.store.replace(uploaded.id, replacement, { expectedRevision: moved.revision });
  expect(replaced.document.versions).toHaveLength(2); expect(a.readUrl(url)?.bytes).toEqual(bytes);
  const snapshot = await a.provider.store.snapshot();
  await expect(a.provider.store.updateFolder(folder.id, { parentId: folder.id }, { expectedRevision: folder.revision })).rejects.toMatchObject({ code: "validation" });
  expect(await a.provider.store.snapshot()).toEqual(snapshot);
  const unsupported = { name: "new-demo.html", type: "text/html", arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Blob & { name: string };
  await expect(a.provider.store.upload(unsupported)).rejects.toMatchObject({ code: "validation" });
});
