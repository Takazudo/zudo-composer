// @vitest-environment node
import { readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostedAssetHeaders } from "../../src/assets/model/asset-kinds.mjs";
import { assertDemoEditorText, DEMO_EDITOR_SEED, HOSTED_DEMO_HEADERS, sha256, verifyDemoEditorArtifact } from "./artifact.mjs";
import { writeEditorArtifact } from "./__fixtures__/editor-artifact";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(options: Parameters<typeof writeEditorArtifact>[0] = {}) {
  const value = await writeEditorArtifact(options);
  roots.push(value.root);
  return value;
}

describe("demo editor artifact contract", () => {
  it.each([true, false])("verifies the exact asset inventory without a fixed count (minimal=%s)", async (minimalAssets) => {
    const value = await fixture({ minimalAssets });
    const artifact = await verifyDemoEditorArtifact({ directory: value.root });
    expect(artifact.manifest.mode).toBe("disposable-demo-editor");
    expect(artifact.manifest.hostId).toBe(value.seed.hostId);
    expect(artifact.manifest.projectId).toBe(value.seed.project.id);
    const expectedVersions = new Set(value.seed.assets.records.flatMap(({ document }) => document.versions.map(({ url }) => url.slice(1))));
    expect(new Set(Object.keys(artifact.manifest.assets))).toEqual(expectedVersions);
    // Sample Studio's own five real seeded images are always required
    // (#695); the non-minimal variant also merges in the repo's generic
    // PNG/PDF/ZIP fixture catalog for non-webp MIME coverage.
    expect(expectedVersions.size).toBe(minimalAssets ? 5 : 11);
    expect(artifact.files.filter(({ path }) => path.startsWith("uploaded-assets/")).map(({ path }) => path)).toEqual(Object.keys(artifact.manifest.assets));
    expect(artifact.files.find(({ path }) => path === DEMO_EDITOR_SEED)?.mime).toBe("application/json");
  });

  it.each(["hostId", "projectId", "projectSourceRevision", "routes"] as const)("rejects %s tampering by comparing with the bundled project", async (field) => {
    const value = await fixture();
    if (field === "routes") value.manifest.routes.push("/site/phantom");
    else if (field === "projectSourceRevision") value.manifest.projectSourceRevision = "a".repeat(64);
    else value.manifest[field] = "wrong-host";
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow(`${field} differs from its bundled seed`);
  });

  it.each(["/composer", "/site/about"])("rejects a removed verified route %s", async (route) => {
    const value = await fixture();
    value.manifest.routes = value.manifest.routes.filter((path) => path !== route);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow(route === "/composer" ? "route is missing" : "routes differs");
  });

  it("rejects duplicate and unsafe navigation routes", async () => {
    const value = await fixture();
    const routes = [...value.manifest.routes];
    for (const route of ["/composer", "//outside.example", "/site/a/../b", "/site/x?query=1", "/site/x#fragment", "/site/x\\y", "/site/%2e%2e/elsewhere"]) {
      value.manifest.routes = [...routes, route];
      await value.saveManifest();
      await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow(/unique|Invalid demo editor route/);
    }
  });

  it("rejects missing manifest assets and files, and extra uploaded bytes", async () => {
    const value = await fixture();
    const [path, metadata] = Object.entries(value.manifest.assets)[0]!;
    delete value.manifest.assets[path];
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("missing from manifest assets");
    value.manifest.assets[path] = metadata;
    const checksum = value.manifest.files[path]!;
    delete value.manifest.files[path];
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("missing from manifest");
    value.manifest.files[path] = checksum;
    await value.saveManifest();
    await value.saveFile(`uploaded-assets/sha256-${sha256("extra")}.txt`, "extra");
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("missing from manifest");
  });

  it("rejects a removed snapshot version even after both manifest lists and headers are updated", async () => {
    const value = await fixture();
    const [path] = Object.keys(value.manifest.assets);
    delete value.manifest.assets[path!];
    delete value.manifest.files[path!];
    await rm(join(value.root, path!));
    const headers = hostedAssetHeaders(Object.entries(value.manifest.assets).map(([path, { byteLength }]) => ({ path, byteLength })));
    await value.saveFile(HOSTED_DEMO_HEADERS, headers);
    value.manifest.files[HOSTED_DEMO_HEADERS] = sha256(headers);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("must equal the bundled snapshot versions");
  });

  it("checks catalog byte lengths and checksum-named bytes beyond the final file hash", async () => {
    const value = await fixture();
    const [path, metadata] = Object.entries(value.manifest.assets)[0]!;
    metadata.byteLength++;
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("Demo asset byte length");
    metadata.byteLength--;
    const changed = Buffer.from(value.files.get(path)!);
    changed[changed.length - 1] ^= 1;
    await value.saveFile(path, changed);
    value.manifest.files[path] = sha256(changed);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("Demo asset checksum");
    metadata.sha256 = sha256(changed);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("name does not match its checksum");
  });

  it("rejects snapshot metadata drift even when the seed file is rehashed", async () => {
    const value = await fixture();
    value.seed.assets.records[0]!.document.versions[0]!.byteLength++;
    const source = JSON.stringify(value.seed);
    await value.saveFile(DEMO_EDITOR_SEED, source);
    value.manifest.files[DEMO_EDITOR_SEED] = sha256(source);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("checksum or MIME mismatch");
  });

  it("rejects symlinked artifacts and files", async () => {
    const value = await fixture();
    await symlink(value.root, join(value.root, "linked-root"), "dir");
    await expect(verifyDemoEditorArtifact({ directory: join(value.root, "linked-root") })).rejects.toThrow("real directory");
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("symlinks");
  });
});

describe("forbidden-marker regressions", () => {
  it("permits benign host-pack prose but rejects real filesystem and server imports", async () => {
    const directory = join(import.meta.dirname, "__fixtures__/markers");
    const benign = await readFile(join(directory, "benign-demo-pack.js.txt"), "utf8");
    expect(() => assertDemoEditorText(benign, "assets/demo-pack.js")).not.toThrow();
    for (const file of ["import-filesystem.js.txt", "import-server.js.txt"]) {
      const source = await readFile(join(directory, file), "utf8");
      expect(() => assertDemoEditorText(source, "assets/demo-pack.js")).toThrow("forbidden marker");
    }
  });

  it.each([
    'import "./src/runtime.js";',
    'export { pack } from "./styleguide/runtime.js";',
    'const runtime = import("./projects/runtime.js");',
    'const runtime = require("./builds/runtime.js");',
    'const runtime = import(`./projects/${name}.js`);',
    'const runtime = import("./src/" + name + ".js");',
    'const runtime = require.resolve("./styleguide/runtime.js");',
    'import "./components.stories.js";',
    'import { readFile } from "node:fs/promises";',
    'const runtime = import("../../server/site-project-local/index.mjs");',
  ])("retains executable module exclusions: %s", (source) => {
    expect(() => assertDemoEditorText(source, "assets/demo-pack.js")).toThrow("forbidden marker");
  });

  it("scans emitted chunks even when they are outside the preview import graph", async () => {
    const value = await fixture();
    const path = "assets/unreferenced-server.js";
    const source = 'import "node:fs";';
    await value.saveFile(path, source);
    value.manifest.files[path] = sha256(source);
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("forbidden marker");
  });

  it("retains the preview graph's authoring-UI boundary", async () => {
    const value = await fixture();
    for (const [path, source] of [["assets/preview-entry-test.js", 'import "./shared-preview.js";'], ["assets/shared-preview.js", 'export const title = "Composition library";']]) {
      await value.saveFile(path!, source!);
      value.manifest.files[path!] = sha256(source!);
    }
    await value.saveManifest();
    await expect(verifyDemoEditorArtifact({ directory: value.root })).rejects.toThrow("preview graph leaked host marker");
  });
});
