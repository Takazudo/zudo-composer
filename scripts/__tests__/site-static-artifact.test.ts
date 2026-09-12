import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SITE_HEADERS, SITE_MANIFEST, createSiteManifest, siteHeaders, verifySiteStaticArtifact } from "../../server/site-build/artifact.mjs";
import { collectStaticSiteAssets } from "../../server/site-build/assets";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

const PIN_BYTES = Buffer.from("pinned asset bytes");
const PIN_PATH = `uploaded-assets/sha256-${createHash("sha256").update(PIN_BYTES).digest("hex")}.png`;
const SOURCE_REVISION = "a".repeat(40);

async function site(files: Record<string, string | Uint8Array> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "site-static-"));
  directories.push(directory);
  const all: Record<string, string | Uint8Array> = {
    "index.html": "<!doctype html><div id=\"app\"></div><script type=\"module\" src=\"/assets/index-abc.js\"></script>",
    "assets/index-abc.js": "console.log('site');",
    "uploaded-assets/logo.svg": "<svg></svg>",
    [PIN_PATH]: PIN_BYTES,
    [SITE_HEADERS]: siteHeaders([{ path: PIN_PATH, byteLength: PIN_BYTES.byteLength }]),
    ...files,
  };
  for (const [path, bytes] of Object.entries(all)) { await mkdir(join(directory, path, ".."), { recursive: true }); await writeFile(join(directory, path), bytes); }
  const manifest = await createSiteManifest({ directory, projectId: "demo", sourceRevision: SOURCE_REVISION, projectSourceRevision: "b".repeat(64), routes: ["/", "/about"] });
  await writeFile(join(directory, SITE_MANIFEST), JSON.stringify(manifest));
  return directory;
}

async function uploads(files: Record<string, string | Uint8Array>, relativeRoot = "public/uploaded-assets"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "site-public-assets-"));
  directories.push(directory);
  const publicAssets = join(directory, relativeRoot);
  await mkdir(publicAssets, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(publicAssets, path, ".."), { recursive: true });
    await writeFile(join(publicAssets, path), bytes);
  }
  return publicAssets;
}

describe("static site public assets", () => {
  it.each(["public/uploaded-assets", "public/library"])("copies exact public bytes directly from the resolved %s directory", async (relativeRoot) => {
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a]);
    const publicAssets = await uploads({ "nested/logo.png": bytes, ".gitkeep": "", "nested/.gitkeep": "" }, relativeRoot);
    const assets = await collectStaticSiteAssets({ assetFiles: [], publicAssets });
    expect(assets.files).toEqual([{ fileName: "uploaded-assets/nested/logo.png", source: bytes }]);
    expect(assets.headers).toBe(siteHeaders([]));
  });

  it("retains release pins when the public directory is absent", async () => {
    const publicAssets = join(await uploads({}), "missing");
    const assetFiles = [{ fileName: PIN_PATH, source: PIN_BYTES }];
    const assets = await collectStaticSiteAssets({ assetFiles, publicAssets });
    expect(assets.files).toEqual(assetFiles);
    expect(assets.headers).toBe(siteHeaders([{ path: PIN_PATH, byteLength: PIN_BYTES.byteLength }]));
  });

  it("deduplicates identical public and release bytes but rejects conflicting claims", async () => {
    const publicAssets = await uploads({ [PIN_PATH.slice("uploaded-assets/".length)]: PIN_BYTES });
    const assetFiles = [{ fileName: PIN_PATH, source: PIN_BYTES }];
    const assets = await collectStaticSiteAssets({ assetFiles, publicAssets });
    expect(assets.files).toEqual(assetFiles);
    expect(assets.headers).toBe(siteHeaders([{ path: PIN_PATH, byteLength: PIN_BYTES.byteLength }]));

    await writeFile(join(publicAssets, PIN_PATH.slice("uploaded-assets/".length)), "stale public copy");
    await expect(collectStaticSiteAssets({ assetFiles, publicAssets })).rejects.toThrow(`Two different files claim ${PIN_PATH}.`);
  });

  it("includes unreferenced public checksum assets in the artifact and header rules", async () => {
    const publicBytes = Buffer.from("committed download\n");
    const publicName = `sha256-${createHash("sha256").update(publicBytes).digest("hex")}.txt`;
    const publicAssets = await uploads({ [publicName]: publicBytes });
    const assets = await collectStaticSiteAssets({ assetFiles: [{ fileName: PIN_PATH, source: PIN_BYTES }], publicAssets });
    const directory = await site({ ...Object.fromEntries(assets.files.map(({ fileName, source }) => [fileName, source])), [SITE_HEADERS]: assets.headers });
    const manifest = await verifySiteStaticArtifact({ directory });
    expect(manifest.files[`uploaded-assets/${publicName}`]).toBe(createHash("sha256").update(publicBytes).digest("hex"));
    expect(await readFile(join(directory, "uploaded-assets", publicName))).toEqual(publicBytes);
    expect(assets.headers).toContain(`/uploaded-assets/${publicName}\n  Content-Type: text/plain`);
  });

  it("keeps rejecting stale public bytes under a checksum name even without a release collision", async () => {
    const publicName = `sha256-${"0".repeat(64)}.png`;
    const publicAssets = await uploads({ [publicName]: "stale public bytes" });
    const assets = await collectStaticSiteAssets({ assetFiles: [{ fileName: PIN_PATH, source: PIN_BYTES }], publicAssets });
    const directory = await site({ ...Object.fromEntries(assets.files.map(({ fileName, source }) => [fileName, source])), [SITE_HEADERS]: assets.headers });
    await expect(verifySiteStaticArtifact({ directory })).rejects.toThrow(`Pinned asset name does not match its bytes: uploaded-assets/${publicName}`);
  });
});

describe("static site artifact", () => {
  it("describes every file, the routes and both revisions", async () => {
    const directory = await site();
    const manifest = await verifySiteStaticArtifact({ directory, expectedSourceRevision: SOURCE_REVISION });
    expect(Object.keys(manifest.files)).toEqual([SITE_HEADERS, "assets/index-abc.js", "index.html", PIN_PATH, "uploaded-assets/logo.svg"].sort());
    expect(manifest.routes).toEqual(["/", "/about"]);
    expect(manifest.projectId).toBe("demo");
  });

  it("gives hashed output and pinned assets immutable header rules", () => {
    const headers = siteHeaders([{ path: PIN_PATH, byteLength: PIN_BYTES.byteLength }]);
    expect(headers).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
    expect(headers).toContain(`/${PIN_PATH}\n  Content-Type: image/png`);
    expect(siteHeaders([])).toBe("/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  });

  it("rejects a tampered, unlisted or leaking file and a wrong source revision", async () => {
    const tampered = await site();
    await writeFile(join(tampered, "assets/index-abc.js"), "changed");
    await expect(verifySiteStaticArtifact({ directory: tampered })).rejects.toThrow(/checksum/);

    const extra = await site();
    await writeFile(join(extra, "stray.txt"), "stray");
    await expect(verifySiteStaticArtifact({ directory: extra })).rejects.toThrow(/missing from manifest/);

    const leaking = await site({ "assets/index-abc.js": "import 'node:fs';" });
    await expect(verifySiteStaticArtifact({ directory: leaking })).rejects.toThrow(/forbidden marker/);

    await expect(verifySiteStaticArtifact({ directory: await site(), expectedSourceRevision: "c".repeat(40) })).rejects.toThrow(/sourceRevision/);
  });

  it("rejects a pinned asset whose name does not match its bytes", async () => {
    const misnamed = `uploaded-assets/sha256-${"0".repeat(64)}.png`;
    const directory = await site({ [misnamed]: PIN_BYTES, [SITE_HEADERS]: siteHeaders([{ path: misnamed, byteLength: PIN_BYTES.byteLength }, { path: PIN_PATH, byteLength: PIN_BYTES.byteLength }]) });
    await expect(verifySiteStaticArtifact({ directory })).rejects.toThrow(/does not match its bytes/);
  });
});
