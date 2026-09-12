import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import * as authoring from "zudo-composer/authoring";
import * as siteBuild from "zudo-composer/site-build";
import { loadHostContext } from "zudo-composer/vite";

assert.deepEqual(Object.keys(authoring).sort(), ["assetAuthoringUrl", "assetMimeTypeForExtension", "canonicalStringifyJson", "createFilesystemAssetStore", "validateSiteProject"]);
assert.deepEqual(Object.keys(siteBuild).sort(), ["SITE_HEADERS", "SITE_MANIFEST", "compileStaticSite", "createSiteManifest", "siteHeaders", "verifySiteStaticArtifact"]);
assert.equal(authoring.assetAuthoringUrl("proof"), "/uploaded-assets/asset-proof");
assert.equal(authoring.assetMimeTypeForExtension("PDF"), "application/pdf");
assert.equal(authoring.canonicalStringifyJson({ z: 1, a: [2] }), '{"a":[2],"z":1}\n');

const { pack, packIdentity, workspaceRoot } = await loadHostContext({ workspaceRoot: process.cwd() });
assert.equal(workspaceRoot, process.cwd());
assert.equal(packIdentity.packageRoot, process.cwd());
assert.equal(packIdentity.specifier, "public-entry-host/components");
const assetsStoreRoot = join(workspaceRoot, "cms/assets");
const store = await authoring.createFilesystemAssetStore({ assetsStoreRoot });
const record = await store.upload({ fileName: "proof.txt", declaredMimeType: "text/plain", bytes: new TextEncoder().encode("Installed authoring") });
assert.equal((await store.snapshot()).records[0].id, record.id);
assert.equal((await (await authoring.createFilesystemAssetStore({ assetsStoreRoot })).snapshot()).records[0].id, record.id);

const timestamp = "2026-09-12T00:00:00.000Z";
const project = {
  schemaVersion: 2, id: "installed-proof", name: "Installed proof",
  componentPack: { contractVersion: pack.manifest.contractVersion, packId: pack.manifest.packId, packVersion: pack.manifest.packVersion },
  providers: {
    compositions: [{ id: "files", records: [{ id: "home", createdAt: timestamp, updatedAt: timestamp, document: {
      schemaVersion: 2, id: "home", name: "Home", root: [{ id: "banner", componentId: "proof.banner", componentVersion: 1, props: { headline: "Packed site" }, slots: {} }],
    } }] }],
    content: [{ id: "content-filesystem", models: [], entries: [] }],
    mappings: [{ id: "mapping-filesystem", records: [] }],
    sitemaps: [{ id: "sitemap-filesystem", records: [{ id: "main", createdAt: timestamp, updatedAt: timestamp, document: {
      schemaVersion: 3, id: "main", name: "Main", navigation: { primary: [], footer: [] },
      root: [{ id: "home", title: "Home", source: { kind: "composition", ref: { providerId: "files", recordId: "home" } }, children: [] }],
    } }] }],
  },
  activeSitemap: { providerId: "sitemap-filesystem", recordId: "main" }, collectionAttachments: [],
};
const validation = authoring.validateSiteProject(project, { componentPack: pack.manifest });
assert.equal(validation.ok, true, JSON.stringify(validation.diagnostics));
assert.equal(authoring.validateSiteProject({}, { componentPack: pack.manifest }).ok, false);
const projectPath = join(workspaceRoot, "site-project.json");
await writeFile(projectPath, authoring.canonicalStringifyJson(project));
const compiled = await siteBuild.compileStaticSite({ projectPath, pack, assetsStoreRoot });
assert.deepEqual(compiled.build.routes.map(({ pathname }) => pathname), ["/"]);
assert.equal(compiled.project.id, project.id);
assert.match(compiled.projectSourceRevision, /^[a-f0-9]{64}$/);

const directory = join(workspaceRoot, "dist-site");
await mkdir(directory);
await writeFile(join(directory, "index.html"), "<!doctype html><title>Packed site</title>");
await writeFile(join(directory, siteBuild.SITE_HEADERS), siteBuild.siteHeaders([]));
const manifest = await siteBuild.createSiteManifest({ directory, projectId: project.id, sourceRevision: "a".repeat(40), projectSourceRevision: compiled.projectSourceRevision, routes: ["/"] });
await writeFile(join(directory, siteBuild.SITE_MANIFEST), JSON.stringify(manifest));
assert.deepEqual(await siteBuild.verifySiteStaticArtifact({ directory, expectedSourceRevision: "a".repeat(40) }), manifest);
assert.ok((await readFile(join(assetsStoreRoot, "catalog.json"), "utf8")).includes(record.id));
console.log("Packed public entries passed: authoring, filesystem persistence, host context, static compilation and artifact verification.");
