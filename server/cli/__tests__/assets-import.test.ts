import { copyFile, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_MAX_BYTE_LENGTH } from "../../../src/assets/model";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { composer } from "../../config";
import { createAssetImportService } from "../assets-import-service";
import { runAssetImportCli } from "../assets-import-runner";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const image = new URL("../../../scripts/demo-assets/demo-sunrise.png", import.meta.url);
const otherImage = new URL("../../../scripts/demo-assets/demo-twilight.png", import.meta.url);

async function host() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "asset-import-")));
  roots.push(root);
  const sources = join(root, "images-src");
  await mkdir(sources);
  await copyFile(image, join(sources, "photo.png"));
  const config = composer({ workspaceRoot: root, pack: "host/components", dataDir: "authoring-data" }, { env: {} });
  const service = createAssetImportService(config);
  async function importManifest(manifest: unknown) {
    await writeFile(join(sources, "manifest.json"), JSON.stringify(manifest));
    return service.handle({ manifest: "images-src/manifest.json" });
  }
  return { root, sources, config, service, importManifest };
}

async function storeBytes(root: string) {
  const paths = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  return Promise.all(paths.map(async (path) => [path, (await readFile(path)).toString("base64")]));
}

describe("asset manifest import", () => {
  it("uses name and checksum across active assets, trash and retained versions, preserving all store bytes on a rerun", async () => {
    const fixture = await host();
    await mkdir(join(fixture.sources, "nested"));
    await copyFile(image, join(fixture.sources, "same-bytes.png"));
    await copyFile(otherImage, join(fixture.sources, "nested/photo.png"));
    const entries = [
      { file: "photo.png", alt: "fallback", note: "preferred", use: "hero", aspect: "3:2" },
      { file: "same-bytes.png", alt: "other name" },
      { file: "nested/photo.png", note: "", alt: "unused" },
      { file: "photo.png", note: "do not update the existing note" },
    ];
    expect(await fixture.importManifest(entries)).toEqual({ ok: true, result: { added: 3, skipped: 1 } });
    const store = await createFilesystemAssetStore({ assetsStoreRoot: fixture.config.paths.assets });
    const snapshot = await store.snapshot();
    expect(snapshot.records.map(({ document }) => [document.fileName, document.note])).toEqual([
      ["photo.png", "preferred"], ["same-bytes.png", "other name"], ["photo.png", ""],
    ]);
    const [first, second] = snapshot.records;
    await store.trash(first.id, { expectedRevision: first.revision });
    await store.replace(second.id, { bytes: await readFile(otherImage) }, { expectedRevision: second.revision });
    const before = await storeBytes(fixture.config.paths.assets);
    expect(await fixture.importManifest(entries)).toEqual({ ok: true, result: { added: 0, skipped: 4 } });
    expect(await storeBytes(fixture.config.paths.assets)).toEqual(before);
    await expect(readdir(join(fixture.root, "cms"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    null, {}, [null], [{ file: 3 }], [{ file: "" }], [{ file: "../photo.png" }], [{ file: "/photo.png" }],
    [{ file: "C:/photo.png" }], [{ file: "C:photo.png" }], [{ file: "nested\\photo.png" }],
    [{ file: "./photo.png" }], [{ file: "nested//photo.png" }], [{ file: "photo\u0000.png" }],
    [{ file: "photo.png", note: null }], [{ file: "photo.png", alt: 3 }], [{ file: "photo.png", note: "x".repeat(10001) }],
  ].map((manifest) => ({ manifest })))("rejects malformed entries and escaping paths before creating a store (%#)", async ({ manifest }) => {
    const fixture = await host();
    expect(await fixture.importManifest(manifest)).toMatchObject({ ok: false, error: { code: "validation" } });
    await expect(readdir(fixture.config.paths.assets)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates all entries before uploading any of them", async () => {
    const fixture = await host();
    expect(await fixture.importManifest([{ file: "photo.png" }, { file: "missing.png" }]))
      .toMatchObject({ ok: false, error: { code: "not-found" } });
    await expect(readdir(fixture.config.paths.assets)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects directories, symlinked files and directory symlinks that escape the manifest root", async () => {
    const fixture = await host();
    await mkdir(join(fixture.root, "external"));
    await copyFile(image, join(fixture.root, "external/photo.png"));
    await symlink(join(fixture.root, "external/photo.png"), join(fixture.sources, "linked.png"));
    await symlink(join(fixture.root, "external"), join(fixture.sources, "linked-directory"), "dir");
    await mkdir(join(fixture.sources, "directory.png"));
    for (const file of ["linked.png", "linked-directory/photo.png", "directory.png"]) {
      expect(await fixture.importManifest([{ file }])).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    await expect(readdir(fixture.config.paths.assets)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported, mismatched, empty and oversized bytes before creating a store", async () => {
    const fixture = await host();
    await copyFile(image, join(fixture.sources, "wrong.jpg"));
    await writeFile(join(fixture.sources, "bad.png"), "not an image");
    await writeFile(join(fixture.sources, "empty.png"), "");
    await writeFile(join(fixture.sources, "unknown.exe"), "executable");
    const large = await open(join(fixture.sources, "large.png"), "w");
    try { await large.truncate(ASSET_MAX_BYTE_LENGTH + 1); } finally { await large.close(); }
    for (const file of ["wrong.jpg", "bad.png", "empty.png", "unknown.exe", "large.png"]) {
      expect(await fixture.importManifest([{ file }])).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    await expect(readdir(fixture.config.paths.assets)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed UTF-8 or JSON manifests and a non-file manifest", async () => {
    const fixture = await host();
    for (const bytes of [Buffer.from("[{}]\n[]"), Buffer.from([0xff])]) {
      await writeFile(join(fixture.sources, "manifest.json"), bytes);
      expect(await fixture.service.handle({ manifest: "images-src/manifest.json" })).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    expect(await fixture.service.handle({ manifest: "images-src" })).toMatchObject({ ok: false, error: { code: "validation" } });
    await expect(readdir(fixture.config.paths.assets)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed against malformed existing catalogs and concurrent writer locks", async () => {
    const fixture = await host();
    await mkdir(fixture.config.paths.assets, { recursive: true });
    const catalog = join(fixture.config.paths.assets, "catalog.json");
    await writeFile(catalog, "malformed\n");
    expect(await fixture.importManifest([{ file: "photo.png" }])).toMatchObject({ ok: false, error: { code: "recovery-required" } });
    expect(await readFile(catalog, "utf8")).toBe("malformed\n");
    await rm(catalog);
    await writeFile(join(fixture.config.paths.assets, ".mutation.lock"), "another writer");
    const before = await storeBytes(fixture.config.paths.assets);
    expect(await fixture.importManifest([{ file: "photo.png" }])).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await storeBytes(fixture.config.paths.assets)).toEqual(before);
  });
});

function cliIo(input: Buffer | string) {
  let stdout = "";
  let stderr = "";
  return {
    stdin: Readable.from([input]),
    stdout: new Writable({ write(chunk, _encoding, done) { stdout += String(chunk); done(); } }),
    stderr: new Writable({ write(chunk, _encoding, done) { stderr += String(chunk); done(); } }),
    output: () => ({ stdout, stderr }),
  };
}

describe("asset import JSON framing", () => {
  it.each(["", " ", "{}\n{}", "not JSON", Buffer.from([0xff]), "x".repeat(8 * 1024 * 1024 + 1)])("rejects invalid framing without calling the service (%#)", async (input) => {
    const service = { handle: vi.fn() };
    const io = cliIo(input);
    expect(await runAssetImportCli(service, io)).toBe(2);
    expect(service.handle).not.toHaveBeenCalled();
    expect(JSON.parse(io.output().stdout)).toMatchObject({ ok: false, error: { code: "malformed-request" } });
    expect(io.output().stdout.endsWith("\n")).toBe(true);
    expect(io.output().stderr).toBe("");
  });

  it("emits canonical success and reserves stdout for exactly one response on an internal error", async () => {
    const success = cliIo('{ "manifest": "images-src/manifest.json" }\n');
    const handle = vi.fn(async () => ({ ok: true as const, result: { skipped: 2, added: 1 } }));
    expect(await runAssetImportCli({ handle }, success)).toBe(0);
    expect(handle).toHaveBeenCalledWith({ manifest: "images-src/manifest.json" });
    expect(success.output()).toEqual({ stdout: '{"ok":true,"result":{"added":1,"skipped":2}}\n', stderr: "" });
    const failure = cliIo("{}");
    expect(await runAssetImportCli({ handle: async () => { throw new Error("disk offline"); } }, failure)).toBe(1);
    expect(failure.output().stdout).toBe('{"error":{"code":"internal","message":"The Assets import failed unexpectedly."},"ok":false}\n');
    expect(failure.output().stderr).toContain("disk offline");
  });

  it.each([null, [], {}, { manifest: "" }, { manifest: 1 }, { manifest: "a.json", assetsDir: "/somewhere" }].map((request) => ({ request })))("rejects malformed request schemas (%#)", async ({ request }) => {
    const fixture = await host();
    const io = cliIo(JSON.stringify(request));
    expect(await runAssetImportCli(fixture.service, io)).toBe(2);
    expect(JSON.parse(io.output().stdout)).toMatchObject({ ok: false, error: { code: "malformed-request" } });
  });
});
