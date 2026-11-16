import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { resolveComponentPack } from "../../../plugins/component-pack.mjs";
import { composer } from "../../config/config";
import { initializeAuthoringWorkspace } from "../../edit/initialize-workspace";
import { captureHost } from "../../edit/inspect";
import { acquireAuthoringLease } from "../../edit/authoring-lease.mjs";
import { defineSite, node, imageUse } from "../../../src/site-project/authoring";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot, isAuthoringWorkspaceSnapshotCurrent, resolveAuthoringPackIdentity, resolveAuthoringRendererIdentity } from "../capture";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "workspace-export-")); roots.push(workspaceRoot);
  const pack = defineComponentPack({ packId: "capture-proof", packVersion: "1.0.0", components: [defineComponent<{ text: string }>()((props: { text: string }) => props.text, {
    id: "paragraph", schemaVersion: 1, title: "Paragraph", description: "Proof", category: "Proof",
    source: { module: "capture-proof/components", exportKind: "named", exportName: "Paragraph" },
    defaults: { text: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }],
  })] });
  const composerConfig = composer({ workspaceRoot, pack: "capture-proof/components", authoringAuthority: "workspace", nativeEditing: { source: "workspace" } }, { env: {} });
  const assets = await createFilesystemAssetStore({ assetsStoreRoot: composerConfig.paths.assets });
  const asset = await assets.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
  const site = defineSite({ id: "proof", name: "Proof", componentPack: pack });
  const page = site.page({ id: "home", name: "Home", root: [node("paragraph", { text: "Reviewed" }, {}, "paragraph")] });
  const model = site.model({ id: "hero", name: "Hero", kind: "single", fields: [{ key: "image", kind: "asset-use", use: "image" }] });
  site.entry(model, { id: "hero-entry", values: { image: imageUse(asset.id, "Pixel") } });
  site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page } });
  await initializeAuthoringWorkspace({ composerConfig, pack, project: site.toSiteProject(), workspaceId: "proof" });
  return { composerConfig, pack, packIdentity: { specifier: "capture-proof/components", source: "self", digest: "a".repeat(64), compiler: "compiler-proof", contractDigest: "c".repeat(64) }, renderer: { id: "capture-renderer", version: "1", module: "capture-proof/renderer", digest: "d".repeat(64) }, assets };
}

it("captures all native domains and exact referenced asset bytes, then builds without live storage", async () => {
  const options = await fixture();
  const snapshot = await captureAuthoringWorkspace(options);
  expect(Object.keys(snapshot.tokens).sort()).toEqual(["assets", "compositions", "content", "mappings", "sitemaps", "workspace"]);
  expect(snapshot.project.providers.content[0]!.entries).toHaveLength(1);
  expect(snapshot.assets.files).toHaveLength(1);
  expect(await isAuthoringWorkspaceSnapshotCurrent(options, snapshot)).toBe(true);
  await rm(options.composerConfig.paths.data, { recursive: true });
  await writeFile(join(options.composerConfig.workspaceRoot, "site-project.json"), "invalid obsolete source");
  const build = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot: JSON.parse(JSON.stringify(snapshot)) });
  expect(build.build.routes[0]!.composition.document.root[0]!.props.text).toBe("Reviewed");
  expect(build.assetFiles).toHaveLength(1);
});

it("rejects stale workspace generation after edit/revert but retains exact earlier build input", async () => {
  const options = await fixture(); const snapshot = await captureAuthoringWorkspace(options);
  const host = await captureHost({ config: options.composerConfig, pack: options.pack });
  // Inspection cannot generate derived JSX, so mutate through the content store.
  const entry = (await host.stores.content.readAll()).entries[0]!;
  const modified = structuredClone(entry); const fieldId = Object.keys(entry.values)[0]!; modified.values[fieldId] = { ...modified.values[fieldId] as object, alt: "Changed" };
  await host.stores.content.putEntry(modified);
  await host.stores.content.putEntry(entry);
  expect(await isAuthoringWorkspaceSnapshotCurrent(options, snapshot)).toBe(false);
  expect((await compileAuthoringWorkspaceSnapshot({ ...options, snapshot })).build.routes).toHaveLength(1);
});

it("refuses unflushed live authoring and never creates missing workspace state", async () => {
  const options = await fixture();
  const lease = await acquireAuthoringLease(options.composerConfig.workspaceRoot, "live-editor");
  try { await expect(captureAuthoringWorkspace(options)).rejects.toMatchObject({ code: "authoring-busy" }); }
  finally { await lease.release(); }
  await rm(options.composerConfig.paths.data, { recursive: true });
  await expect(captureAuthoringWorkspace(options)).rejects.toThrow("existing canonical storage");
  await expect(readFile(join(options.composerConfig.paths.data, "workspaces/current.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects changed snapshot data and mismatched renderer or installed pack", async () => {
  const options = await fixture(); const snapshot = await captureAuthoringWorkspace(options);
  const tampered = structuredClone(snapshot); tampered.assets.files[0]!.base64 = "AAAA";
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, snapshot: tampered })).rejects.toThrow("digest mismatch");
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, snapshot, renderer: { ...options.renderer, id: "other" } })).rejects.toThrow("identity mismatch");
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, snapshot, packIdentity: { ...options.packIdentity, digest: "b".repeat(64) } })).rejects.toThrow("identity mismatch");
});

it("keeps source detection by default and allows an explicit workspace authority beside historical source", async () => {
  const options = await fixture();
  await writeFile(join(options.composerConfig.workspaceRoot, "site-project.json"), "historical source");
  expect((await captureHost({ config: options.composerConfig, pack: options.pack })).sourceAuthored).toBe(false);
  expect((await captureHost({ config: { ...options.composerConfig, authoringAuthority: "source" }, pack: options.pack })).sourceAuthored).toBe(true);
});

it("captures only explicit shipping files and refuses traversal, then builds from captured bytes", async () => {
  const options = await fixture();
  await mkdir(join(options.composerConfig.workspaceRoot, "public"));
  await writeFile(join(options.composerConfig.workspaceRoot, "public/site.css"), "body{color:red}");
  const inputs = { ...options, publicFiles: [{ fileName: "assets/site.css", sourcePath: "public/site.css" }] };
  const snapshot = await captureAuthoringWorkspace(inputs);
  await writeFile(join(options.composerConfig.workspaceRoot, "public/site.css"), "body{color:blue}");
  const build = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot });
  expect(Buffer.from(build.assetFiles.find(file => file.fileName === "assets/site.css")!.source).toString()).toBe("body{color:red}");
  expect(await isAuthoringWorkspaceSnapshotCurrent(inputs, snapshot)).toBe(false);
  await expect(captureAuthoringWorkspace({ ...options, publicFiles: [{ fileName: "../leak", sourcePath: "public/site.css" }] })).rejects.toThrow("normalized");
});

it("attests actual renderer source bytes and compiler/contract identity through the public helper runtime", async () => {
  const options = await fixture(); const root = options.composerConfig.workspaceRoot;
  await mkdir(join(root, "styles"), { recursive: true });
  await writeFile(options.composerConfig.paths.styles, "body { color: red; }");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "capture-proof", type: "module", exports: { "./components": "./components.mjs", "./renderer": "./renderer.mjs", "./jsx-runtime": "./jsx-runtime.mjs", "./jsx-dev-runtime": "./jsx-runtime.mjs" } }));
  await writeFile(join(root, "components.mjs"), "export const Paragraph = props => props.text;\n");
  await writeFile(join(root, "renderer.mjs"), "export const renderDocument = () => '<body>First</body>';\n");
  await writeFile(options.composerConfig.configPath, "export default {};\n");
  await writeFile(join(root, "jsx-runtime.mjs"), "export const jsx = () => null;\n");
  const composerConfig = { ...options.composerConfig, hostDocument: { module: "capture-proof/renderer", jsxImportSource: "capture-proof", rendererId: "proof", rendererVersion: "1" } };
  const identity = await resolveAuthoringPackIdentity({ composerConfig, pack: options.pack, packIdentity: resolveComponentPack(root, "capture-proof/components") });
  expect(identity.compiler).toMatch(/^site-project-release\/2:[a-f0-9]{64}$/);
  expect(identity.contractDigest).toMatch(/^[a-f0-9]{64}$/);
  const before = await resolveAuthoringRendererIdentity({ composerConfig });
  await writeFile(join(root, "renderer.mjs"), "export const renderDocument = () => '<body>Changed</body>';\n");
  const after = await resolveAuthoringRendererIdentity({ composerConfig });
  expect(after.digest).not.toBe(before.digest);
  expect(after.id).toBe(before.id);
  expect(after.version).toBe(before.version);
  await writeFile(join(root, "jsx-runtime.mjs"), "export const jsx = () => 'changed runtime';\n");
  expect((await resolveAuthoringRendererIdentity({ composerConfig })).digest).not.toBe(after.digest);
});
