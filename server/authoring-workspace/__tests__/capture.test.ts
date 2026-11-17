import { createHash } from "node:crypto";
import { canonicalStringifyJson } from "../../../src/site-project/model/canonical";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { workspaceDomainRoots } from "../../../src/shared/workspace-scope";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem/store";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { captureAuthoringWorkspace, compileAuthoringWorkspaceSnapshot, isAuthoringWorkspaceSnapshotCurrent, isAuthoringWorkspaceSourceCurrent, resolveAuthoringPackIdentity, resolveAuthoringRendererIdentity } from "../capture";

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


it("checks migration source independently of new runtime identity without weakening exact build checks", async () => {
  const options = await fixture();
  const snapshot = await captureAuthoringWorkspace(options);
  const upgraded = { ...options, renderer: { ...options.renderer, version: "2" }, packIdentity: { ...options.packIdentity, digest: "b".repeat(64) } };
  expect(await isAuthoringWorkspaceSourceCurrent(upgraded, snapshot)).toBe(true);
  await expect(isAuthoringWorkspaceSnapshotCurrent(upgraded, snapshot)).rejects.toThrow("identity mismatch");
  await expect(compileAuthoringWorkspaceSnapshot({ ...upgraded, snapshot })).rejects.toThrow("identity mismatch");
  const host = await captureHost({ config: options.composerConfig, pack: options.pack });
  const entry = (await host.stores.content.readAll()).entries[0]!;
  const changed = structuredClone(entry); const field = Object.keys(entry.values)[0]!;
  changed.values[field] = { ...changed.values[field] as object, alt: "Later saved edit" };
  await host.stores.content.putEntry(changed);
  expect(await isAuthoringWorkspaceSourceCurrent(upgraded, snapshot)).toBe(false);
  await host.stores.content.putEntry(entry);
  expect(await isAuthoringWorkspaceSourceCurrent(upgraded, snapshot)).toBe(false);
});

it("migration preflight refuses tampered capture, busy source and changed public bytes without reseeding", async () => {
  const options = await fixture();
  await mkdir(join(options.composerConfig.workspaceRoot, "public"));
  await writeFile(join(options.composerConfig.workspaceRoot, "public/site.css"), "original");
  const inputs = { ...options, publicFiles: [{ fileName: "site.css", sourcePath: "public/site.css" }] };
  const snapshot = await captureAuthoringWorkspace(inputs);
  const invalid = structuredClone(snapshot); invalid.workspaceId = "foreign";
  await expect(isAuthoringWorkspaceSourceCurrent(inputs, invalid)).rejects.toThrow("digest mismatch");
  const lease = await acquireAuthoringLease(options.composerConfig.workspaceRoot, "source-editor");
  try { await expect(isAuthoringWorkspaceSourceCurrent(inputs, snapshot)).rejects.toMatchObject({ code: "authoring-busy" }); }
  finally { await lease.release(); }
  await writeFile(join(options.composerConfig.workspaceRoot, "public/site.css"), "changed");
  expect(await isAuthoringWorkspaceSourceCurrent(inputs, snapshot)).toBe(false);
  await rm(options.composerConfig.paths.data, { recursive: true });
  await expect(isAuthoringWorkspaceSourceCurrent(inputs, snapshot)).rejects.toThrow("existing canonical storage");
  await expect(readFile(join(options.composerConfig.paths.data, "workspaces/current.json"))).rejects.toMatchObject({ code: "ENOENT" });
});


it("migration source comparison detects different source data even at matching initial tokens", async () => {
  const first = await fixture();
  const snapshot = await captureAuthoringWorkspace(first);
  const workspaceRoot = await mkdtemp(join(tmpdir(), "copied-source-")); roots.push(workspaceRoot);
  await cp(first.composerConfig.workspaceRoot, workspaceRoot, { recursive: true });
  const composerConfig = composer({ workspaceRoot, pack: "capture-proof/components", authoringAuthority: "workspace", nativeEditing: { source: "workspace" } }, { env: {} });
  const contentRoot = workspaceDomainRoots(composerConfig.paths, snapshot.workspaceId).content;
  // A distinct initialized source can have the same generation while holding
  // different Content. Recreate only this disposable copy through its store API.
  await rm(contentRoot, { recursive: true });
  const content = await createFilesystemContentStore({ contentRoot });
  const provider = structuredClone(snapshot.project.providers.content[0]!);
  const entry = provider.entries[0]!; const field = Object.keys(entry.values)[0]!;
  entry.values[field] = { ...entry.values[field] as object, alt: "Different original" };
  await content.seed({ models: provider.models, entries: provider.entries });
  const second = { ...first, composerConfig };
  expect((await captureAuthoringWorkspace(second)).tokens).toEqual(snapshot.tokens);
  expect(await isAuthoringWorkspaceSourceCurrent(second, snapshot)).toBe(false);
});

it("checks source with a genuinely incompatible new pack without rewriting the source", async () => {
  const options = await fixture(); const snapshot = await captureAuthoringWorkspace(options);
  const pack = defineComponentPack({ packId: "capture-proof", packVersion: "2.0.0", components: [defineComponent<{ text: string }>()((props: { text: string }) => props.text, {
    id: "replacement", schemaVersion: 1, title: "Replacement", description: "New pack", category: "Proof",
    source: { module: "capture-proof/components", exportKind: "named", exportName: "Replacement" },
    defaults: { text: "" }, fields: [{ kind: "text", prop: "text", label: "Text" }],
  })] });
  expect(await isAuthoringWorkspaceSourceCurrent({ ...options, pack }, snapshot)).toBe(true);
  await expect(captureAuthoringWorkspace({ ...options, pack })).rejects.toThrow("invalid");
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, pack, snapshot })).rejects.toThrow("identity mismatch");
  expect((await captureAuthoringWorkspace(options)).digest).toBe(snapshot.digest);
});

it("migration source comparison detects changed immutable asset bytes even with unchanged catalog", async () => {
  const options = await fixture(); const snapshot = await captureAuthoringWorkspace(options);
  const file = snapshot.assets.files[0]!;
  const bytes = Buffer.from(file.base64, "base64"); bytes[0] = bytes[0]! ^ 1;
  await writeFile(join(options.composerConfig.paths.assets, "versions", file.fileName.split("/").at(-1)!), bytes);
  expect(await isAuthoringWorkspaceSourceCurrent(options, snapshot)).toBe(false);
});


it("migration source refuses rehashed asset omissions and duplicate captured files", async () => {
  const options = await fixture(); const snapshot = await captureAuthoringWorkspace(options);
  for (const files of [[], [snapshot.assets.files[0]!, snapshot.assets.files[0]!]]) {
    const altered = structuredClone(snapshot); altered.assets.files = files;
    const { digest: originalDigest, ...body } = altered;
    expect(originalDigest).toBe(snapshot.digest);
    altered.digest = createHash("sha256").update(canonicalStringifyJson(body as never)).digest("hex");
    await expect(isAuthoringWorkspaceSourceCurrent(options, altered)).rejects.toThrow("file set differs");
  }
});

it("captures and reopens an unassigned saved page with exact Assets, but builds only after source assignment", async () => {
  const options = await fixture();
  const before = await captureAuthoringWorkspace(options);
  const host = await captureHost({ config: options.composerConfig, pack: options.pack });
  const sitemap = structuredClone((await host.stores.sitemaps.snapshot()).records[0]!);
  const pending = { id: "new-page", title: "Untitled page", slug: "new-page", source: { kind: "unassigned" as const }, children: [] };
  sitemap.document.root[0]!.children.push(pending);
  await host.stores.sitemaps.put(sitemap);
  const snapshot = await captureAuthoringWorkspace(options);
  expect(snapshot.project.providers.sitemaps[0]!.records[0]!.document.root[0]!.children).toEqual([pending]);
  expect(snapshot.assets).toEqual(before.assets);
  expect(snapshot.publicFiles).toEqual(before.publicFiles);
  expect(snapshot.project.providers.content).toEqual(before.project.providers.content);
  expect(snapshot.project.providers.compositions).toEqual(before.project.providers.compositions);
  expect(snapshot.project.providers.mappings).toEqual(before.project.providers.mappings);
  expect(snapshot.tokens.sitemaps).not.toEqual(before.tokens.sitemaps);
  expect(snapshot.tokens).toEqual({ ...before.tokens, sitemaps: await host.stores.sitemaps.mutationToken() });
  expect(await isAuthoringWorkspaceSnapshotCurrent(options, snapshot)).toBe(true);
  // Each capture reopens durable stores, as a stopped editor/restarted host does.
  expect(await captureAuthoringWorkspace(options)).toEqual(snapshot);
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, snapshot })).rejects.toThrow("The Sitemap page has no assigned source.");
  const reopened = await captureHost({ config: options.composerConfig, pack: options.pack });
  const assigned = structuredClone((await reopened.stores.sitemaps.snapshot()).records[0]!);
  assigned.document.root[0]!.children[0]!.source = structuredClone(assigned.document.root[0]!.source);
  await reopened.stores.sitemaps.put(assigned);
  const complete = await captureAuthoringWorkspace(options);
  expect(await isAuthoringWorkspaceSnapshotCurrent(options, snapshot)).toBe(false);
  const built = await compileAuthoringWorkspaceSnapshot({ ...options, snapshot: complete });
  expect(built.build.routes.map(route => route.pathname)).toEqual(["/", "/new-page"]);
  expect(complete.assets).toEqual(snapshot.assets);
  // The retained incomplete snapshot remains incomplete, never silently repaired.
  await expect(compileAuthoringWorkspaceSnapshot({ ...options, snapshot })).rejects.toThrow("The Sitemap page has no assigned source.");
});

it.each(["missing", "corrupt"])("still refuses %s immutable asset bytes for an unassigned saved page without changing canonical state", async kind => {
  const options = await fixture();
  const before = await captureAuthoringWorkspace(options);
  const host = await captureHost({ config: options.composerConfig, pack: options.pack });
  const sitemap = structuredClone((await host.stores.sitemaps.snapshot()).records[0]!);
  sitemap.document.root[0]!.children.push({ id: "pending", title: "Pending", slug: "pending", source: { kind: "unassigned" }, children: [] });
  await host.stores.sitemaps.put(sitemap);
  const saved = await host.stores.sitemaps.snapshot();
  const file = join(options.composerConfig.paths.assets, "versions", before.assets.files[0]!.fileName.split("/").at(-1)!);
  if (kind === "missing") await rm(file); else await writeFile(file, "corrupt immutable bytes");
  await expect(captureAuthoringWorkspace(options)).rejects.toThrow("Referenced Assets could not be captured exactly.");
  expect(await host.stores.sitemaps.snapshot()).toEqual(saved);
  expect((await host.stores.content.readAll()).mutationToken).toEqual(before.tokens.content);
});
