// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { createDocSiteManifest, DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./doc-site-artifact.mjs";

const SOURCE_REVISION = "a".repeat(40);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function writeManifest(directory: string, manifest: unknown) {
  await writeFile(join(directory, DOC_SITE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function site(files: Record<string, string | Uint8Array> = {}, sourceRevision?: string) {
  const directory = await mkdtemp(join(tmpdir(), "doc-site-artifact-"));
  directories.push(directory);
  for (const [path, bytes] of Object.entries({ "index.html": "<!doctype html><h1>Docs</h1>", "assets/app.js": "console.log('docs');", ...files })) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  const manifest = await createDocSiteManifest({ directory, sourceRevision });
  await writeManifest(directory, manifest);
  return { directory, manifest };
}

describe("doc site artifact", () => {
  it("round-trips every regular file, its SHA-256, the tool identity and optional source revision", async () => {
    const png = Uint8Array.from([0, 255, 128, 13, 10]);
    const { directory, manifest } = await site({ "images/logo.png": png, "Z.txt": "upper", "a.txt": "lower", [`assets/${DOC_SITE_MANIFEST}`]: "{}" }, SOURCE_REVISION);
    const artifact = await verifyDocSiteArtifact({ directory: relative(process.cwd(), directory), expectedSourceRevision: SOURCE_REVISION });
    const metadata = JSON.parse(await readFile(join(APP_ROOT, "package.json"), "utf8"));

    expect(artifact.root).toBe(resolve(directory));
    expect(artifact.manifest).toEqual(manifest);
    expect(manifest).toMatchObject({ schemaVersion: 1, kind: "doc-site", sourceRevision: SOURCE_REVISION, routes: ["/"] });
    expect(manifest.tool).toEqual({ name: metadata.name, version: metadata.version, ...(metadata.gitHead === undefined ? {} : { gitHead: metadata.gitHead }) });
    expect(Object.keys(manifest.files)).toEqual(["Z.txt", "a.txt", "assets/app.js", `assets/${DOC_SITE_MANIFEST}`, "images/logo.png", "index.html"]);
    expect(manifest.files["images/logo.png"]).toBe(createHash("sha256").update(png).digest("hex"));
    expect(artifact.files.map((file) => file.path)).toEqual(Object.keys(manifest.files));
    expect(artifact.files.find((file) => file.path === "images/logo.png")).toEqual({ path: "images/logo.png", sha256: manifest.files["images/logo.png"], mime: "image/png" });
    expect(manifest.files).not.toHaveProperty(DOC_SITE_MANIFEST);
  });

  it("omits a missing revision and produces identical manifests even with an old manifest on disk", async () => {
    const { directory, manifest } = await site();
    expect(manifest).not.toHaveProperty("sourceRevision");
    await writeFile(join(directory, DOC_SITE_MANIFEST), "stale manifest bytes");
    const rebuilt = await createDocSiteManifest({ directory });
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(manifest));
    await writeManifest(directory, rebuilt);
    expect((await verifyDocSiteArtifact({ directory })).manifest).not.toHaveProperty("sourceRevision");
    await expect(verifyDocSiteArtifact({ directory, expectedSourceRevision: SOURCE_REVISION })).rejects.toThrow(/sourceRevision does not match/);
  });

  it("derives sorted routes from root, directory and standalone HTML while retaining 404.html only as a file", async () => {
    const { directory, manifest } = await site({
      "x.html": "standalone",
      "docs/a/b/index.html": "nested index",
      "docs/a/guide.html": "nested standalone",
      "404.html": "not found",
    });
    expect(manifest.routes).toEqual(["/", "/docs/a/b/", "/docs/a/guide", "/x"]);
    expect(manifest.files).toHaveProperty("404.html");
    expect((await verifyDocSiteArtifact({ directory })).files.find((file) => file.path === "404.html")).toMatchObject({ mime: "text/html" });
  });

  it("assigns every supported asset MIME and preserves ICO/XML alternatives", async () => {
    const mimeEntries = [
      [".html", "text/html"], [".css", "text/css"], [".js", "text/javascript"], [".mjs", "text/javascript"],
      [".json", "application/json"], [".xml", "application/xml"], [".txt", "text/plain"], [".svg", "image/svg+xml"],
      [".png", "image/png"], [".ico", "image/vnd.microsoft.icon"], [".woff2", "font/woff2"],
      [".wasm", "application/wasm"], [".webmanifest", "application/manifest+json"],
    ];
    const { directory } = await site(Object.fromEntries(mimeEntries.map(([extension]) => [`assets/file${extension}`, "asset bytes"])));
    const { files } = await verifyDocSiteArtifact({ directory });
    for (const [extension, mime] of mimeEntries) {
      const file = files.find((file) => file.path === `assets/file${extension}`);
      expect(file?.mime).toBe(mime);
      if (extension === ".ico") expect(file?.acceptedMimes).toEqual(["image/vnd.microsoft.icon", "image/x-icon"]);
      else if (extension === ".xml") expect(file?.acceptedMimes).toEqual(["application/xml", "text/xml"]);
      else expect(file).not.toHaveProperty("acceptedMimes");
    }
  });

  it("rejects a missing file and names its nested path", async () => {
    const { directory } = await site();
    await rm(join(directory, "assets/app.js"));
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow("Doc site artifact file is missing: assets/app.js");
  });

  it("rejects an extra file and names its nested path", async () => {
    const { directory } = await site();
    await writeFile(join(directory, "assets/stray.txt"), "stray");
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow("Doc site artifact file is missing from manifest: assets/stray.txt");
  });

  it("rejects changed bytes and names their path", async () => {
    const { directory } = await site();
    await writeFile(join(directory, "assets/app.js"), "changed");
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow("Doc site artifact checksum mismatch: assets/app.js");
  });

  it("rejects a manifest that lists itself", async () => {
    const { directory, manifest } = await site();
    manifest.files[DOC_SITE_MANIFEST] = createHash("sha256").update(await readFile(join(directory, DOC_SITE_MANIFEST))).digest("hex");
    await writeManifest(directory, manifest);
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(`Doc site manifest must not list itself: ${DOC_SITE_MANIFEST}`);
  });

  it("rejects a source revision different from the trusted checkout", async () => {
    const { directory } = await site({}, SOURCE_REVISION);
    await expect(verifyDocSiteArtifact({ directory, expectedSourceRevision: "b".repeat(40) })).rejects.toThrow(/sourceRevision does not match/);
  });

  it.each(["", "short", "a".repeat(39), "a".repeat(41), "g".repeat(40), ` ${SOURCE_REVISION}`, `${SOURCE_REVISION}\n`, `${SOURCE_REVISION}\r`])("rejects invalid source revisions during creation: %j", async (sourceRevision) => {
    const { directory } = await site();
    await expect(createDocSiteManifest({ directory, sourceRevision })).rejects.toThrow(/sourceRevision must be a full 40-hex Git SHA/);
  });

  it.each([null, 40, "short", "g".repeat(40), `${SOURCE_REVISION}\n`])("rejects malformed recorded source revisions: %j", async (sourceRevision) => {
    const { directory, manifest } = await site();
    await writeManifest(directory, { ...manifest, sourceRevision });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(/sourceRevision must be a full 40-hex Git SHA/);
  });

  it.each([".gif", ".map", ""])("rejects uncontracted extensions, including %j", async (extension) => {
    const { directory } = await site({ [`assets/file${extension}`]: "asset" });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(`Unknown doc site artifact extension ${extension || "(none)"}: assets/file${extension}`);
  });

  it.each([
    { schemaVersion: 2 }, { kind: "site-static" }, { tool: null }, { tool: { name: "zudo-composer" } },
    { tool: { name: "zudo-composer", version: "1.0.0", gitHead: "short" } },
    { files: null }, { files: [] }, { files: "index.html" }, { extra: true },
  ])("rejects a malformed manifest field: %j", async (patch) => {
    const { directory, manifest } = await site();
    await writeManifest(directory, { ...manifest, ...patch });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow();
  });

  it.each([null, [], "manifest"])("rejects a non-object manifest: %j", async (manifest) => {
    const { directory } = await site();
    await writeManifest(directory, manifest);
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(/manifest must be an object/);
  });

  it("preserves a valid recorded tool identity from another package version", async () => {
    const { directory, manifest } = await site();
    const tool = { name: "zudo-composer", version: "7.5.2", gitHead: "d".repeat(40) };
    await writeManifest(directory, { ...manifest, tool });
    expect((await verifyDocSiteArtifact({ directory })).manifest.tool).toEqual(tool);
  });

  it.each([undefined, null, "/", [], ["/", "/"], ["/", "/extra"], ["/x", "/"]])("rejects missing, malformed, duplicate or reordered routes: %j", async (routes) => {
    const { directory, manifest } = await site({ "x.html": "standalone" });
    await writeManifest(directory, { ...manifest, routes });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(/Doc site manifest/);
  });

  it.each([null, 64, "a".repeat(63), "g".repeat(64), `${"a".repeat(64)}\n`])("rejects malformed file hashes and names the file: %j", async (checksum) => {
    const { directory, manifest } = await site();
    await writeManifest(directory, { ...manifest, files: { ...manifest.files, "assets/app.js": checksum } });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow("Invalid doc site artifact SHA-256: assets/app.js");
  });

  it.each(["../outside.txt", "/absolute.txt", "assets\\app.js", "./index.html", "docs/../index.html", "docs//page.html"])("rejects unsafe or non-normalized manifest paths: %s", async (path) => {
    const { directory, manifest } = await site();
    await writeManifest(directory, { ...manifest, files: { ...manifest.files, [path]: "a".repeat(64) } });
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow(`Invalid doc site artifact path: ${path}`);
  });

  it("rejects symlinked files when creating or verifying artifacts", async () => {
    const { directory } = await site();
    await symlink(join(directory, "index.html"), join(directory, "assets/linked.html"));
    await expect(createDocSiteManifest({ directory })).rejects.toThrow("Doc site artifacts must not contain symlinks: assets/linked.html");
    await expect(verifyDocSiteArtifact({ directory })).rejects.toThrow("Doc site artifacts must not contain symlinks: assets/linked.html");
  });
});

describe("doc site build command", () => {
  it.each(["", "short", `${SOURCE_REVISION}\n`])("rejects an invalid explicit revision before starting the build: %j", (sourceRevision) => {
    const result = spawnSync(process.execPath, [join(APP_ROOT, "scripts/build-doc-site.mjs"), "--source-revision", sourceRevision], {
      encoding: "utf8", env: { ...process.env, GITHUB_SHA: SOURCE_REVISION, PATH: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Doc site sourceRevision must be a full 40-hex Git SHA");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("rejects an invalid GITHUB_SHA before starting the build", () => {
    const result = spawnSync(process.execPath, [join(APP_ROOT, "scripts/build-doc-site.mjs")], {
      encoding: "utf8", env: { ...process.env, GITHUB_SHA: `${SOURCE_REVISION}\n`, PATH: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Doc site sourceRevision must be a full 40-hex Git SHA");
    expect(result.stderr).not.toContain("ENOENT");
  });
});
