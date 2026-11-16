import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import * as authoring from "zudo-composer/authoring";
import * as editing from "zudo-composer/editing";
import * as siteBuild from "zudo-composer/site-build";
import { loadHostContext } from "zudo-composer/vite";

assert.deepEqual(Object.keys(authoring).sort(), ["ASSET_PROVIDER_ID", "COMPOSITION_PROVIDER_ID", "CONTENT_PROVIDER_ID", "DEFAULT_TIMESTAMP", "MAPPING_PROVIDER_ID", "SITEMAP_PROVIDER_ID", "assetAuthoringUrl", "assetMimeTypeForExtension", "canonicalStringifyJson", "captureAuthoringWorkspace", "createFilesystemAssetStore", "defineSite", "entryRef", "hostDocumentTargets", "imageUse", "initializeAuthoringWorkspace", "isAuthoringWorkspaceSnapshotCurrent", "isAuthoringWorkspaceSourceCurrent", "node", "renderHostDocument", "resolveAuthoringPackIdentity", "resolveAuthoringRendererIdentity", "slugify", "validateSiteProject"]);
assert.deepEqual(Object.keys(editing), ["createEditingService"]);
assert.equal(typeof editing.createEditingService, "function");
assert.equal(typeof authoring.initializeAuthoringWorkspace, "function");
assert.deepEqual(Object.keys(siteBuild).sort(), ["SITE_HEADERS", "SITE_MANIFEST", "compileAuthoringWorkspaceSnapshot", "compileStaticSite", "createSiteManifest", "siteHeaders", "verifySiteStaticArtifact"]);
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
// Public selected-entry metadata source and collection pins survive packed installation.
const identitySite = authoring.defineSite({ id: "identity-proof", name: "Identity proof", componentPack: pack });
const identityModel = identitySite.model({ name: "Courses", kind: "collection", fields: [{ key: "label", kind: "text" }] });
const identityEntry = identitySite.entry(identityModel, { id: "stable-course", values: { label: "Renamed course" } });
const identityPage = identitySite.page({ name: "Identity card", root: [authoring.node("proof.banner", { headline: "Static" }, {}, "identity-banner")] });
const identityMapping = identitySite.mapping({ name: "Identity mapping", model: identityModel, composition: identityPage,
  mode: { kind: "collection", pins: [authoring.entryRef(identityEntry)], limit: 1 },
  bindings: [{ source: { kind: "entry-id" }, nodeId: "identity-banner", prop: "headline" }] });
identitySite.sitemap({ name: "Identity sitemap", root: { title: "Identity", mapping: identityMapping } });
const identityProject = identitySite.toSiteProject();
assert.deepEqual(identityMapping.record.document.bindings[0], { id: "identity-mapping-entry-id-headline", source: { kind: "entry-id" }, target: { nodeId: "identity-banner", prop: "headline" }, transform: { kind: "identity" } });
assert.deepEqual(identityMapping.record.document.mode.query.pins, [authoring.entryRef(identityEntry)]);
assert.equal(authoring.validateSiteProject(identityProject, { componentPack: pack.manifest }).ok, true);
const identityPath = join(workspaceRoot, "identity-project.json");
await writeFile(identityPath, authoring.canonicalStringifyJson(identityProject));
const identityCompiled = await siteBuild.compileStaticSite({ projectPath: identityPath, pack, assetsStoreRoot });
assert.equal(identityCompiled.build.routes[0].composition.document.root[0].props.headline, "stable-course");

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

// Offline, disposable native workspace: use only installed public exports.
await authoring.initializeAuthoringWorkspace({ composerConfig, pack, project, workspaceId: "installed-native-proof" });
const captureOptions = { composerConfig, pack,
  packIdentity: await authoring.resolveAuthoringPackIdentity({ composerConfig, pack, packIdentity }),
  renderer: await authoring.resolveAuthoringRendererIdentity({ composerConfig }),
};
const nativeSnapshot = await authoring.captureAuthoringWorkspace(captureOptions);
assert.equal(nativeSnapshot.workspaceId, "installed-native-proof");
assert.equal(await authoring.isAuthoringWorkspaceSnapshotCurrent(captureOptions, nativeSnapshot), true);
assert.equal(await authoring.isAuthoringWorkspaceSourceCurrent({ composerConfig, pack }, nativeSnapshot), true);
const upgradedRuntime = { ...captureOptions, renderer: { ...captureOptions.renderer, version: "migration-next" } };
assert.equal(await authoring.isAuthoringWorkspaceSourceCurrent(upgradedRuntime, nativeSnapshot), true);
await assert.rejects(authoring.isAuthoringWorkspaceSnapshotCurrent(upgradedRuntime, nativeSnapshot), /identity mismatch/);
const exact = await siteBuild.compileAuthoringWorkspaceSnapshot({ ...captureOptions, snapshot: JSON.parse(JSON.stringify(nativeSnapshot)) });
assert.deepEqual(exact.build.routes.map(({ pathname }) => pathname), ["/"]);
assert.deepEqual(exact.project, nativeSnapshot.project);
const route = exact.build.routes[0];
assert.equal(authoring.hostDocumentTargets(route)[0].nodeId, "banner");
const hostRenderer = await import("public-entry-host/components");
const preview = await authoring.renderHostDocument(hostRenderer, route, {
  workspaceId: nativeSnapshot.workspaceId, revision: nativeSnapshot.digest, pathname: route.pathname,
  packId: pack.manifest.packId, packVersion: pack.manifest.packVersion,
  rendererId: captureOptions.renderer.id, rendererVersion: captureOptions.renderer.version, rendererDigest: captureOptions.renderer.digest,
}, exact.project);
assert.equal(preview.identity.revision, nativeSnapshot.digest);
assert.ok(preview.html.includes("zudo-host-document-v1"));
assert.deepEqual(preview.targets, authoring.hostDocumentTargets(route));
const tampered = globalThis.structuredClone(nativeSnapshot); tampered.project.name = "Not reviewed";
await assert.rejects(siteBuild.compileAuthoringWorkspaceSnapshot({ ...captureOptions, snapshot: tampered }), /digest mismatch/);

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
console.log("Packed public entries passed: authoring, filesystem persistence, host context, static compilation, installed tool identity and optional/exact host revision verification.");
