// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store";
import { demoFileNames, seedDemoAsset } from "../seed-demo-assets";

const roots: string[] = [];
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "demo-assets-"));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function files(root: string) {
  const names = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
  return Promise.all(names.map(async (name) => [name, (await readFile(name)).toString("base64")]));
}

describe("dogfood demo Assets seed", () => {
  it("seeds small valid images, preserves unrelated records/folders, and reruns without changing any bytes", async () => {
    const root = await sandbox();
    const store = await createFilesystemAssetStore({ assetsStoreRoot: root });
    const source = await readFile(new URL("../demo-assets/demo-sunrise.png", import.meta.url));
    const folder = await store.createFolder({ name: "Personal", parentId: null }, await store.mutationToken());
    const unrelated = await store.upload({ fileName: "personal.png", bytes: source, declaredMimeType: "image/png", folderId: folder.id, note: "Keep this note" });
    const sameName = await store.upload({ fileName: "demo-lagoon.png", bytes: source, declaredMimeType: "image/png" });
    expect(await seedDemoAsset(root)).toEqual({ added: 4, skipped: 0 });
    const snapshot = await store.snapshot();
    expect(snapshot.records).toHaveLength(6);
    expect(snapshot.records).toContainEqual(unrelated);
    expect(snapshot.records).toContainEqual(sameName);
    expect(snapshot.folders).toEqual([folder]);
    for (const record of snapshot.records.filter(({ id }) => ![unrelated.id, sameName.id].includes(id))) {
      expect(demoFileNames).toContain(record.document.fileName);
      const version = record.document.versions[0];
      expect(version.byteLength).toBeLessThanOrEqual(60 * 1024);
      expect(version.mimeType).toBe("image/png");
      expect((await store.get(record.id)).status).toBe("loaded");
      const bytes = await readFile(join(root, "versions", version.url.split("/").at(-1)!));
      expect(bytes.readUInt32BE(16)).toBe(480);
      expect(bytes.readUInt32BE(20)).toBe(320);
    }
    const before = await files(root);
    expect(await seedDemoAsset(root)).toEqual({ added: 0, skipped: 4 });
    expect(await files(root)).toEqual(before);
  });

  it("does not resurrect trashed assets or duplicate a demo whose current bytes were replaced", async () => {
    const root = await sandbox();
    await seedDemoAsset(root);
    const store = await createFilesystemAssetStore({ assetsStoreRoot: root });
    const [first, second] = (await store.snapshot()).records;
    await store.trash(first.id, { expectedRevision: first.revision });
    const bytes = await readFile(new URL("../demo-assets/demo-twilight.png", import.meta.url));
    await store.replace(second.id, { bytes }, { expectedRevision: second.revision });
    const before = await files(root);
    expect(await seedDemoAsset(root)).toEqual({ added: 0, skipped: 4 });
    expect(await files(root)).toEqual(before);
  });

  it("fails closed and preserves a malformed existing catalog", async () => {
    const root = await sandbox();
    await writeFile(join(root, "catalog.json"), "broken catalog\n");
    await expect(seedDemoAsset(root)).rejects.toMatchObject({ code: "recovery-required" });
    expect(await readFile(join(root, "catalog.json"), "utf8")).toBe("broken catalog\n");
    expect(await readdir(join(root, "versions"))).toEqual([]);
  });
});
