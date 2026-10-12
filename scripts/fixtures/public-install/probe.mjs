import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import * as authoring from "zudo-composer/authoring";
import * as content from "zudo-composer/content";
import * as editing from "zudo-composer/editing";
import * as exportPublic from "zudo-composer/export";
import * as hostStorage from "zudo-composer/host-storage";
import * as previewProtocol from "zudo-composer/preview-protocol";
import * as siteBuild from "zudo-composer/site-build";
import { loadHostContext } from "zudo-composer/vite";

assert.deepEqual(Object.keys(authoring).sort(), ["ASSET_PROVIDER_ID", "COMPOSITION_PROVIDER_ID", "CONTENT_PROVIDER_ID", "DEFAULT_TIMESTAMP", "MAPPING_PROVIDER_ID", "SITEMAP_PROVIDER_ID", "assetAuthoringUrl", "assetMimeTypeForExtension", "canonicalStringifyJson", "createFilesystemAssetStore", "defineSite", "entryRef", "imageUse", "initializeAuthoringWorkspace", "node", "slugify", "validateSiteProject"]);
assert.deepEqual(Object.keys(editing), ["createEditingService"]);
assert.equal(typeof editing.createEditingService, "function");
assert.equal(typeof authoring.initializeAuthoringWorkspace, "function");
assert.deepEqual(Object.keys(siteBuild).sort(), ["SITE_HEADERS", "SITE_MANIFEST", "compileStaticSite", "createSiteManifest", "siteHeaders", "verifySiteStaticArtifact"]);
assert.deepEqual(Object.keys(content).sort(), ["CONTENT_FIELD_KINDS", "ContentPersistenceError", "DEFAULT_MARKDOWN_CONTENT_POLICY", "HOST_CONTENT_OPERATIONS", "assertContentEntryMatchesModel", "authorizeContentMutation", "canonicalStringifyJson", "canonicalizeSiteProject", "compileSiteProjectPlan", "contentEntryDigest", "contentEntrySemanticIssue", "createContentEntryRecord", "diagnoseContentEntryCompleteness", "diagnoseMarkdownValue", "isValueValidForField", "serializeSiteProject", "stripSiteBuildModules", "traverseContentSchema", "traverseContentValues", "validateContentEntryRecord", "validateContentModelRecord", "validateSiteProject"]);
assert.deepEqual(Object.keys(hostStorage).sort(), ["CONTENT_STORAGE_CONFORMANCE_CASES", "CONTENT_STORAGE_CONFORMANCE_POLICY", "contentDraftRequestDigest", "contentSnapshotId", "createContentStorageConformanceBaseline", "createMemoryContentDraftStorage", "projectWithContentSnapshot", "runContentStorageConformance", "sha256Hex"]);
assert.deepEqual(Object.keys(previewProtocol).sort(), ["HOST_PREVIEW_CHANNEL", "HOST_PREVIEW_PROTOCOL_VERSION", "createHostPreviewBridge", "hostRenderMessage", "hostRenderMessageSchema", "hostToPreviewSchema", "previewErrorMessage", "previewErrorMessageSchema", "previewReadyMessage", "previewReadyMessageSchema", "previewRenderedMessage", "previewRenderedMessageSchema", "previewToHostSchema", "readHostToPreview", "readPreviewToHost", "sameHostPreviewRequest"]);
assert.deepEqual(Object.keys(exportPublic).sort(), ["CONTENT_EXPORT_STATES", "createFakeContentExportAdapter", "validateContentExportSubmission"]);
assert.equal(content.canonicalStringifyJson({ z: 1, a: [2] }), '{"a":[2],"z":1}\n');
assert.equal(authoring.assetAuthoringUrl("proof"), "/uploaded-assets/asset-proof");
assert.equal(authoring.assetMimeTypeForExtension("PDF"), "application/pdf");
assert.equal(authoring.canonicalStringifyJson({ z: 1, a: [2] }), '{"a":[2],"z":1}\n');
assert.deepEqual(authoring.imageUse("proof", "Proof image"), { kind: "image", asset: { providerId: authoring.ASSET_PROVIDER_ID, assetId: "proof" }, alt: "Proof image", decorative: false, caption: "" });

const { composerConfig, pack, packIdentity, workspaceRoot } = await loadHostContext({ workspaceRoot: process.cwd() });
assert.equal(workspaceRoot, process.cwd());
assert.equal(packIdentity.packageRoot, process.cwd());
assert.equal(packIdentity.specifier, "public-entry-host/components");
const assetsStoreRoot = join(workspaceRoot, "cms/assets");
const store = await authoring.createFilesystemAssetStore({ assetsStoreRoot });
const record = await store.upload({ fileName: "proof.txt", declaredMimeType: "text/plain", bytes: new TextEncoder().encode("Installed authoring") });
assert.equal((await store.snapshot()).records[0].id, record.id);
assert.equal((await (await authoring.createFilesystemAssetStore({ assetsStoreRoot })).snapshot()).records[0].id, record.id);

const catalog = JSON.parse(await readFile(join(composerConfig.paths.assets, "catalog.json"), "utf8"));
assert.deepEqual(catalog.records.map((r) => ({ fileName: r.document.fileName, url: authoring.assetAuthoringUrl(r.id) })), [{ fileName: "proof.txt", url: authoring.assetAuthoringUrl(record.id) }]);
assert.equal(authoring.slugify("Packed site"), "packed-site");
const site = authoring.defineSite({ id: "installed-proof", name: "Installed proof", componentPack: pack });
const home = site.page({ id: "home", name: "Home", root: [authoring.node("proof.banner", { headline: "Packed site" }, {}, "banner")] });
site.sitemap({ id: "main", name: "Main", root: { id: "home", title: "Home", page: home } });
const project = site.toSiteProject();
assert.equal(home.record.createdAt, authoring.DEFAULT_TIMESTAMP);
const validation = authoring.validateSiteProject(project, { componentPack: pack.manifest });
assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
assert.equal(authoring.validateSiteProject({}, { componentPack: pack.manifest }).ok, false);
const projectPath = join(workspaceRoot, "site-project.json");
await writeFile(projectPath, authoring.canonicalStringifyJson(project));
const compiled = await siteBuild.compileStaticSite({ projectPath, pack, assetsStoreRoot });
assert.deepEqual(compiled.build.routes.map(({ pathname }) => pathname), ["/"]);
assert.equal(compiled.project.id, project.id);
assert.match(compiled.projectSourceRevision, /^[a-f0-9]{64}$/);
// The portable projection agrees with the Node build on the same project.
const projected = await content.compileSiteProjectPlan(JSON.parse(await readFile(projectPath, "utf8")), pack.manifest);
assert.equal(projected.status, "ready", JSON.stringify(projected));
assert.deepEqual(projected.plan, content.stripSiteBuildModules(compiled.build));
assert.ok(!("modules" in projected.plan));
assert.equal(content.validateSiteProject(project, { componentPack: pack.manifest }).ok, true);

// Restricted mutation boundary, reference storage, export fake and preview
// bridge all run from the installed portable entries.
const baseline = hostStorage.createContentStorageConformanceBaseline("installed-baseline");
await hostStorage.runContentStorageConformance((seed) => hostStorage.createMemoryContentDraftStorage(seed));
const storage = await hostStorage.createMemoryContentDraftStorage(baseline);
const draft = await storage.readDraft();
assert.equal(draft.status, "ok");
const actor = { subject: "probe@example.test" };
const authorized = content.authorizeContentMutation(hostStorage.CONTENT_STORAGE_CONFORMANCE_POLICY, actor, { kind: "put-entry-values", projectId: baseline.project.id, providerId: "content-filesystem", modelId: "notes", expectedRevision: draft.value.draftRevision, entryId: "first", values: { title: "Installed" } }, draft.value.snapshot);
assert.equal(authorized.ok, true, JSON.stringify(authorized));
assert.equal(content.authorizeContentMutation(hostStorage.CONTENT_STORAGE_CONFORMANCE_POLICY, actor, { kind: "put-entry-values", role: "admin", projectId: baseline.project.id, providerId: "content-filesystem", modelId: "notes", expectedRevision: draft.value.draftRevision, entryId: "first", values: {} }, draft.value.snapshot).code, "malformed-request");
const applied = await storage.apply({ operationId: "probe-1", actor, mutation: authorized.mutation, expectedDraftRevision: draft.value.draftRevision, expectedBaselineRevision: baseline.baselineRevision });
assert.equal(applied.status, "ok", JSON.stringify(applied));
const snapshot = await storage.snapshot({ expectedDraftRevision: applied.value.draft.draftRevision });
assert.equal(snapshot.status, "ok");
assert.equal(snapshot.value.snapshotId, await hostStorage.contentSnapshotId(snapshot.value.project));
const exporter = exportPublic.createFakeContentExportAdapter({ now: () => "2026-10-12T00:00:00.000Z" });
const submitted = await exporter.submit({ snapshotId: snapshot.value.snapshotId, projectRevision: snapshot.value.snapshotId, baselineRevision: baseline.baselineRevision, packageIdentity: { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion, contractVersion: pack.manifest.contractVersion }, idempotencyKey: "probe-export" });
assert.deepEqual(submitted, { status: "ok", value: { operationId: "export-0001", replayed: false } });
assert.equal((await exporter.status("export-0001")).value.state, "submitted");
const posted = [];
let listener = null;
const contentWindow = { postMessage: (message, origin) => posted.push([message, origin]) };
const previewIdentity = { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion };
const bridge = previewProtocol.createHostPreviewBridge({
  frame: { contentWindow },
  origin: "https://editor.example",
  hostWindow: { addEventListener: (_type, next) => { listener = next; }, removeEventListener: () => { listener = null; } },
  pack: previewIdentity,
});
const target = { snapshotId: snapshot.value.snapshotId, revision: applied.value.draft.draftRevision, route: "/" };
assert.equal(bridge.preview(target), null, "held until the frame announces ready");
listener({ data: previewProtocol.previewReadyMessage(previewIdentity, "load-1"), origin: "https://evil.example", source: contentWindow });
listener({ data: previewProtocol.previewReadyMessage(previewIdentity, "load-1"), origin: "https://editor.example", source: {} });
assert.equal(posted.length, 0, "wrong origin and wrong source are dropped");
listener({ data: previewProtocol.previewReadyMessage(previewIdentity, "load-1"), origin: "https://editor.example", source: contentWindow });
assert.deepEqual(posted, [[previewProtocol.hostRenderMessage(previewIdentity, { ...target, frameLoadId: "load-1" }), "https://editor.example"]]);
listener({ data: previewProtocol.previewRenderedMessage(previewIdentity, { ...target, frameLoadId: "load-0" }), origin: "https://editor.example", source: contentWindow });
assert.equal(bridge.state.status, "pending", "an acknowledgement from another load cannot complete the request");
listener({ data: previewProtocol.previewRenderedMessage(previewIdentity, { ...target, frameLoadId: "load-1" }), origin: "https://editor.example", source: contentWindow });
assert.equal(bridge.state.status, "rendered");
bridge.dispose();

const directory = join(workspaceRoot, "dist-site");
await mkdir(directory);
await writeFile(join(directory, "index.html"), "<!doctype html><title>Packed site</title>");
await writeFile(join(directory, siteBuild.SITE_HEADERS), siteBuild.siteHeaders([]));
const manifest = await siteBuild.createSiteManifest({ directory, projectId: project.id, sourceRevision: "a".repeat(40), projectSourceRevision: compiled.projectSourceRevision, routes: ["/"] });
const toolPackage = JSON.parse(await readFile(new URL(import.meta.resolve("zudo-composer/package.json")), "utf8"));
assert.deepEqual(manifest.tool, { name: toolPackage.name, version: toolPackage.version, ...(toolPackage.gitHead === undefined ? {} : { gitHead: toolPackage.gitHead }) });
await writeFile(join(directory, siteBuild.SITE_MANIFEST), JSON.stringify(manifest));
assert.deepEqual(await siteBuild.verifySiteStaticArtifact({ directory, expectedSourceRevision: "a".repeat(40) }), manifest);
await assert.rejects(siteBuild.verifySiteStaticArtifact({ directory, expectedSourceRevision: "b".repeat(40) }), /sourceRevision does not match/);
const withoutRevision = await siteBuild.createSiteManifest({ directory, projectId: project.id, projectSourceRevision: compiled.projectSourceRevision, routes: ["/"] });
assert.equal(Object.hasOwn(withoutRevision, "sourceRevision"), false);
assert.deepEqual(withoutRevision.tool, manifest.tool);
await writeFile(join(directory, siteBuild.SITE_MANIFEST), JSON.stringify(withoutRevision));
assert.deepEqual(await siteBuild.verifySiteStaticArtifact({ directory }), withoutRevision);
await assert.rejects(siteBuild.verifySiteStaticArtifact({ directory, expectedSourceRevision: "a".repeat(40) }), /sourceRevision does not match/);
assert.ok((await readFile(join(assetsStoreRoot, "catalog.json"), "utf8")).includes(record.id));
console.log("Packed public entries passed: authoring, filesystem persistence, host context, static compilation, portable projection parity, restricted mutation, draft storage conformance, export fake, preview guard, installed tool identity and optional/exact host revision verification.");
