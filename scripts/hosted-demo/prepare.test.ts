// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assetVersionUrl, validateAssetSnapshot, type AssetFolder, type AssetRecord, type AssetSnapshot, type AssetType } from "../../src/assets/model";
import { prepareDemoAsset } from "./prepare";

const timestamp = "2026-09-01T00:00:00.000Z";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function version(source: Buffer, mimeType: AssetType = "image/png") {
  const checksum = createHash("sha256").update(source).digest("hex");
  return { id: checksum, checksum, url: assetVersionUrl(checksum, mimeType), mimeType, byteLength: source.byteLength, createdAt: timestamp };
}
function folder(id: string, parentId: string | null = null, state: AssetFolder["state"] = "active"): AssetFolder {
  return { id, parentId, state, name: id, revision: 1, createdAt: timestamp, updatedAt: timestamp };
}
function record(id: string, versions: AssetRecord["document"]["versions"], state: AssetRecord["document"]["state"] = "active"): AssetRecord {
  return { id, revision: 2, createdAt: timestamp, updatedAt: timestamp, document: { schemaVersion: 1, id, fileName: "An editable display name", folderId: "nested", note: "Catalog-owned", state, currentVersionId: versions.at(-1)!.id, versions } };
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "demo-assets-")));
  roots.push(root);
  await mkdir(join(root, "versions"));
  const historicalBytes = Buffer.from("%PDF-1.7 historical");
  const currentBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const historical = version(historicalBytes, "application/pdf");
  const current = version(currentBytes);
  const trash = version(Buffer.from("Trashed bytes that are intentionally absent"), "text/plain");
  const catalog: AssetSnapshot = {
    schemaVersion: 1, mutationToken: "a".repeat(64),
    records: [record("first", [historical, current]), record("second", [current]), record("trashed", [trash], "trash")],
    folders: [folder("parent"), folder("nested", "parent"), folder("empty", "parent"), folder("trashed-folder", null, "trash")],
  };
  const save = () => writeFile(join(root, "catalog.json"), JSON.stringify(catalog));
  await save();
  await writeFile(join(root, "versions", basename(historical.url)), historicalBytes);
  await writeFile(join(root, "versions", basename(current.url)), currentBytes);
  await writeFile(join(root, "versions/private.txt"), "Unreferenced bytes");
  return { root, catalog, historical, current, save };
}

it("snapshots every active record and historical version, deduplicates shared bytes, and retains active empty folders and ancestry", async () => {
  const source = await fixture();
  const { snapshot, files } = await prepareDemoAsset(source.root);
  expect(validateAssetSnapshot(snapshot)).toBe(true);
  expect(snapshot.records).toEqual(source.catalog.records.slice(0, 2));
  expect(snapshot.folders).toEqual(source.catalog.folders.slice(0, 3));
  expect(snapshot.mutationToken).toBe("0".repeat(64));
  expect(files.map(({ fileName }) => fileName)).toEqual([source.current.url.slice(1), source.historical.url.slice(1)].sort());
  expect(snapshot.records[0]!.document.versions).toHaveLength(2);
  snapshot.records[0]!.document.note = "Detached edit";
  expect(source.catalog.records[0]!.document.note).toBe("Catalog-owned");
});

it("supports a catalog with no active records while keeping its active empty folders", async () => {
  const source = await fixture();
  source.catalog.records = [];
  await source.save();
  const prepared = await prepareDemoAsset(source.root);
  expect(prepared.files).toEqual([]);
  expect(prepared.snapshot.folders.map(({ id }) => id)).toEqual(["parent", "nested", "empty"]);
});

it.each(["checksum", "length", "mime", "missing"])("rejects %s drift in a historical version", async (drift) => {
  const source = await fixture();
  const path = join(source.root, "versions", basename(source.historical.url));
  if (drift === "checksum") await writeFile(path, "%PDF-1.7 corruption");
  if (drift === "length") { source.historical.byteLength++; await source.save(); }
  if (drift === "mime") {
    const fakePng = version(Buffer.from("%PDF-1.7 historical"));
    source.catalog.records[0]!.document.versions[0] = fakePng;
    await writeFile(join(source.root, "versions", basename(fakePng.url)), "%PDF-1.7 historical");
    await source.save();
  }
  if (drift === "missing") await rm(path);
  await expect(prepareDemoAsset(source.root)).rejects.toThrow(drift === "missing" ? "ENOENT" : "checksum/byte length/MIME mismatch");
});

it("rejects conflicting metadata for a shared immutable version", async () => {
  const source = await fixture();
  source.catalog.records[1]!.document.versions = [structuredClone(source.current)];
  source.catalog.records[1]!.document.versions[0]!.byteLength++;
  await source.save();
  await expect(prepareDemoAsset(source.root)).rejects.toThrow("Conflicting demo version metadata");
});

it.each(["missing", "cycle", "trash"])("rejects %s folder ancestry", async (kind) => {
  const source = await fixture();
  if (kind === "missing") source.catalog.folders.shift();
  if (kind === "cycle") source.catalog.folders[0]!.parentId = "nested";
  if (kind === "trash") source.catalog.folders[0]!.state = "trash";
  await source.save();
  await expect(prepareDemoAsset(source.root)).rejects.toThrow("Invalid committed demo assets catalog");
});

it.each(["catalog", "version", "directory"])("rejects a symlinked %s", async (kind) => {
  const source = await fixture();
  if (kind === "directory") {
    await symlink(source.root, join(source.root, "linked-root"), "dir");
    await expect(prepareDemoAsset(join(source.root, "linked-root"))).rejects.toThrow("real committed file");
  } else {
    const path = kind === "catalog" ? join(source.root, "catalog.json") : join(source.root, "versions", basename(source.current.url));
    await rm(path);
    await symlink(join(source.root, "versions/private.txt"), path);
    await expect(prepareDemoAsset(source.root)).rejects.toThrow("real committed file");
  }
});
