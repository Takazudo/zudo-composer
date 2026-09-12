// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store";
import { demoFileNames, seedDemoAsset } from "../seed-demo-assets";

const roots: string[] = [];
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "demo-assets-"));
  roots.push(root);
  await writeFile(join(root, "zudo-composer.config.ts"), 'export default { pack: "host/components", dataDir: "fixture-data" };\n');
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function files(root: string) {
  const names = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  return Promise.all(names.map(async (name) => [name, (await readFile(name)).toString("base64")]));
}

describe("dogfood demo Assets seed", () => {
  it("keeps the manifest and complete committed fixture list pinned", async () => {
    expect(demoFileNames).toEqual([
      "demo-sunrise.png", "demo-lagoon.png", "demo-orchard.png", "demo-twilight.png",
      "demo-guide.pdf", "demo-archive.zip", "studio-workbench.webp", "studio-wall.webp",
      "studio-review.webp", "journal-question.webp", "journal-map.webp",
    ]);
    const directory = new URL("../demo-assets/", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8")) as { file: string }[];
    expect(manifest.map(({ file }) => file)).toEqual(demoFileNames);
    expect((await readdir(directory)).filter((name) => name !== "manifest.json").sort()).toEqual([...demoFileNames].sort());
  });

  it("seeds valid images and non-image assets, preserves unrelated records/folders, and reruns without changing any bytes", async () => {
    const root = await sandbox();
    const assetsStoreRoot = join(root, "fixture-data/assets");
    const store = await createFilesystemAssetStore({ assetsStoreRoot });
    const source = await readFile(new URL("../demo-assets/demo-sunrise.png", import.meta.url));
    const folder = await store.createFolder({ name: "Personal", parentId: null }, await store.mutationToken());
    const unrelated = await store.upload({ fileName: "personal.png", bytes: source, declaredMimeType: "image/png", folderId: folder.id, note: "Keep this note" });
    const sameName = await store.upload({ fileName: "demo-lagoon.png", bytes: source, declaredMimeType: "image/png" });
    expect(await seedDemoAsset(root)).toEqual({ added: demoFileNames.length, skipped: 0 });
    const snapshot = await store.snapshot();
    expect(snapshot.records).toHaveLength(demoFileNames.length + 2);
    expect(snapshot.records).toContainEqual(unrelated);
    expect(snapshot.records).toContainEqual(sameName);
    expect(snapshot.folders).toEqual([folder]);
    for (const record of snapshot.records.filter(({ id }) => ![unrelated.id, sameName.id].includes(id))) {
      expect(demoFileNames).toContain(record.document.fileName);
      const version = record.document.versions[0];
      expect(version.byteLength).toBeLessThanOrEqual(version.mimeType === "image/webp" ? 250 * 1024 : 60 * 1024);
      expect((await store.get(record.id)).status).toBe("loaded");
      const bytes = await readFile(join(assetsStoreRoot, "versions", version.url.split("/").at(-1)!));
      if (version.mimeType === "image/png") {
        expect(bytes.readUInt32BE(16)).toBe(480);
        expect(bytes.readUInt32BE(20)).toBe(320);
      } else if (version.mimeType === "image/webp") {
        expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
        expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
      } else if (version.mimeType === "application/pdf") {
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      } else {
        expect(version.mimeType).toBe("application/zip");
        expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
      }
    }
    const before = await files(assetsStoreRoot);
    expect(await seedDemoAsset(root)).toEqual({ added: 0, skipped: demoFileNames.length });
    expect(await files(assetsStoreRoot)).toEqual(before);
    await expect(readdir(join(root, "cms"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not resurrect trashed assets or duplicate a demo whose current bytes were replaced", async () => {
    const root = await sandbox();
    await seedDemoAsset(root);
    const assetsStoreRoot = join(root, "fixture-data/assets");
    const store = await createFilesystemAssetStore({ assetsStoreRoot });
    const [first, second] = (await store.snapshot()).records;
    await store.trash(first.id, { expectedRevision: first.revision });
    const bytes = await readFile(new URL("../demo-assets/demo-twilight.png", import.meta.url));
    await store.replace(second.id, { bytes }, { expectedRevision: second.revision });
    const before = await files(assetsStoreRoot);
    expect(await seedDemoAsset(root)).toEqual({ added: 0, skipped: demoFileNames.length });
    expect(await files(assetsStoreRoot)).toEqual(before);
  });

  it("fails closed and preserves a malformed existing catalog", async () => {
    const root = await sandbox();
    const assetsStoreRoot = join(root, "fixture-data/assets");
    await mkdir(assetsStoreRoot, { recursive: true });
    await writeFile(join(assetsStoreRoot, "catalog.json"), "broken catalog\n");
    await expect(seedDemoAsset(root)).rejects.toMatchObject({ code: "recovery-required" });
    expect(await readFile(join(assetsStoreRoot, "catalog.json"), "utf8")).toBe("broken catalog\n");
    expect(await readdir(join(assetsStoreRoot, "versions"))).toEqual([]);
  });

  it("retains the process diagnostic when import cannot start in the requested host", async () => {
    const root = await sandbox();
    await expect(seedDemoAsset(join(root, "missing-host"))).rejects.toThrow(/did not return one JSON response: .*ENOENT/);
  });
});
