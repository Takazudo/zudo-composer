import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createAssetRecord, currentAssetVersion } from "../../../library";
import { ASSET_MAX_BYTE_LENGTH, ASSET_SCHEMA_VERSION, assetVersionUrl } from "../../../model";
import { createFilesystemAssetStore } from "../store";
import type { FilesystemAssetStoreOptions } from "../types";

const sandboxes: string[] = [];
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic version");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function sandbox() { const root = await fs.mkdtemp(join(tmpdir(), "zudo-assets-store-")); sandboxes.push(root); return root; }
afterEach(async () => { await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
function options(root: string, extra: Partial<FilesystemAssetStoreOptions> = {}): FilesystemAssetStoreOptions {
  let sequence = 0;
  return { assetsStoreRoot: root, idFactory: () => `asset-${++sequence}`, now: () => "2026-09-01T00:00:00.000Z", ...extra };
}
const upload = (store: Awaited<ReturnType<typeof createFilesystemAssetStore>>, folderId?: string) => store.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes: PNG, folderId });
const bytePath = (root: string, bytes = PNG) => join(root, "versions", assetVersionUrl(digest(bytes), bytes === PDF ? "application/pdf" : "image/png").split("/").at(-1)!);

describe("versioned global Assets store", () => {
  it("persists exact sibling insertion and moves with snapshot CAS", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root));
    const create = async (name: string, index: number, parentId: string | null = null) => store.createFolder({ name, parentId, index }, await store.mutationToken());
    const a = await create("A", 0); const c = await create("C", 1); const b = await create("B", 1);
    expect((await store.snapshot()).folders.map(({ name }) => name)).toEqual(["A", "B", "C"]);
    const before = await store.mutationToken();
    await store.updateFolder(c.id, { index: 0 }, { expectedRevision: c.revision, expectedMutationToken: before });
    await expect(store.updateFolder(b.id, { index: 0 }, { expectedRevision: b.revision, expectedMutationToken: before })).rejects.toMatchObject({ code: "conflict" });
    await store.updateFolder(b.id, { parentId: a.id, index: 0 }, { expectedRevision: b.revision, expectedMutationToken: await store.mutationToken() });
    const snapshot = await (await createFilesystemAssetStore(options(root))).snapshot();
    expect(snapshot.folders.filter(({ parentId }) => parentId === null).map(({ name }) => name)).toEqual(["C", "A"]);
    expect(snapshot.folders.filter(({ parentId }) => parentId === a.id).map(({ name }) => name)).toEqual(["B"]);
    await expect(create("Outside", 10)).rejects.toMatchObject({ code: "validation" });
  });
  it("syncs byte-directory publication before the catalog and catalog parent before acknowledgment", async () => {
    const root = await fs.realpath(await sandbox()); const events: string[] = [];
    const store = await createFilesystemAssetStore(options(root, { operations: {
      open: async (path, flags, mode) => {
        const handle = await fs.open(path, flags, mode);
        if ((await handle.stat()).isDirectory()) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => { events.push(path.endsWith("/versions") ? "versions-sync" : "catalog-parent-sync"); await sync(); };
        }
        return handle;
      },
      link: async (from, to) => { await fs.link(from, to); events.push("version-link"); },
      rename: async (from, to) => { await fs.rename(from, to); if (to.endsWith("catalog.json")) events.push("catalog-rename"); },
    } }));
    await upload(store); events.push("acknowledged");
    expect(events.slice(events.indexOf("version-link"))).toEqual(["version-link", "versions-sync", "catalog-rename", "catalog-parent-sync", "acknowledged"]);
  });
  it.each(["preflight", "publication", "catalog"])("fails truthfully on %s directory fsync errors", async (failure) => {
    const root = await fs.realpath(await sandbox()); const initial = await createFilesystemAssetStore(options(root));
    const record = await upload(initial); const before = await initial.snapshot();
    let linked = false; let renamed = false;
    const store = await createFilesystemAssetStore(options(root, { operations: {
      open: async (path, flags, mode) => {
        const handle = await fs.open(path, flags, mode);
        if ((await handle.stat()).isDirectory()) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (failure === "preflight" || (failure === "publication" && linked) || (failure === "catalog" && renamed)) throw Object.assign(new Error("directory fsync unavailable"), { code: "EINVAL" });
            await sync();
          };
        }
        return handle;
      },
      link: async (from, to) => { await fs.link(from, to); linked = true; },
      rename: async (from, to) => { await fs.rename(from, to); if (to.endsWith("catalog.json")) renamed = true; },
    } }));
    await expect(store.replace(record.id, { bytes: PDF }, { expectedRevision: 1 })).rejects.toMatchObject({ code: failure === "catalog" ? "commit-uncertain" : "write-failed" });
    if (failure === "catalog") {
      expect((await initial.snapshot()).mutationToken).not.toBe(before.mutationToken);
      await expect(initial.trash(record.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: "conflict" });
      expect(await fs.readFile(join(root, ".mutation.lock"), "utf8")).toContain('"pid"');
    } else {
      expect(await initial.snapshot()).toEqual(before);
      expect(renamed).toBe(false);
    }
  });
  it("persists one current catalog, derives signatures and exposes detached snapshots", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root));
    const before = await store.mutationToken();
    const record = await store.upload({ fileName: "report.bin", declaredMimeType: "image/png", bytes: PDF });
    expect(currentAssetVersion(record)).toMatchObject({ mimeType: "application/pdf", checksum: digest(PDF), byteLength: PDF.byteLength });
    expect(await fs.readFile(bytePath(root, PDF))).toEqual(Buffer.from(PDF));
    const snapshot = await store.snapshot();
    expect(snapshot.schemaVersion).toBe(ASSET_SCHEMA_VERSION); expect(snapshot.mutationToken).not.toBe(before);
    snapshot.records[0]!.document.fileName = "detached.pdf";
    expect((await store.list())[0]!.fileName).toBe("report.bin");
    expect(await (await createFilesystemAssetStore(options(root))).mutationToken()).toBe(snapshot.mutationToken);
  });
  it("retains every immutable byte version after replace, rename, move, trash and restore", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root));
    const original = await upload(store);
    const ref = { providerId: store.provider.id, assetId: original.id, versionId: original.document.currentVersionId };
    const pin = await store.resolveVersion(ref);
    const replaced = await store.replace(original.id, { bytes: PDF }, { expectedRevision: 1 });
    expect(replaced.revision).toBe(2); expect(replaced.id).toBe(original.id); expect(replaced.document.versions).toHaveLength(2);
    const folder = await store.createFolder({ name: "Documents", parentId: null }, await store.mutationToken());
    const renamed = await store.updateMetadata(original.id, { fileName: "renamed.pdf", folderId: folder.id, note: "Notes" }, { expectedRevision: 2 });
    expect(renamed.document.currentVersionId).toBe(digest(PDF));
    const trashed = await store.trash(original.id, { expectedRevision: 3 });
    expect(await store.list()).toEqual([]); expect(await store.list({ state: "trash" })).toHaveLength(1);
    expect(await store.resolveVersion(ref)).toEqual(pin);
    expect(await store.pinManifest([ref, ref])).toEqual({ schemaVersion: 1, pins: [pin] });
    const restored = await store.restore(original.id, { expectedRevision: trashed.revision });
    expect(restored.document.state).toBe("active");
    expect(await fs.readFile(bytePath(root))).toEqual(Buffer.from(PNG));
    expect(await fs.readFile(bytePath(root, PDF))).toEqual(Buffer.from(PDF));
    await expect(store.clear()).rejects.toMatchObject({ code: "blocked" });
    await expect(store.delete(original.id)).rejects.toMatchObject({ code: "validation" });
  });
  it("rejects stale per-asset and provider-wide CAS without changing token or head", async () => {
    const root = await sandbox(); const one = await createFilesystemAssetStore(options(root)); const original = await upload(one);
    const two = await createFilesystemAssetStore(options(root)); const oldToken = await one.mutationToken();
    await two.updateMetadata(original.id, { note: "Other tab" }, { expectedRevision: 1 });
    const current = await one.snapshot(); expect(current.mutationToken).not.toBe(oldToken);
    await expect(one.replace(original.id, { bytes: PDF }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    await expect(one.updateMetadata(original.id, { note: "stale" }, { expectedRevision: 2, expectedMutationToken: oldToken })).rejects.toMatchObject({ code: "conflict" });
    expect(await one.snapshot()).toEqual(current);
  });
  it("enforces the same revision precondition across independent Node processes", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const original = await upload(store);
    const source = `import {createFilesystemAssetStore} from './src/assets/storage/filesystem/store.ts';
      const store = await createFilesystemAssetStore({assetsStoreRoot:process.argv[1]});
      try { await store.updateMetadata(process.argv[2], {note:process.argv[3]}, {expectedRevision:1}); process.stdout.write('ok'); }
      catch(error) { process.stdout.write(error.code); }`;
    const run = (note: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, root, original.id, note], { cwd: process.cwd(), timeout: 15000 });
      let output = ""; let errors = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { errors += String(chunk); });
      child.on("error", reject); child.on("close", (code) => { if (code === 0) resolve(output); else reject(new Error(errors)); });
    });
    expect((await Promise.all([run("one"), run("two")])).sort()).toEqual(["conflict", "ok"]);
    expect((await store.snapshot()).records[0]!.revision).toBe(2);
  }, 20000);
  it("fails closed on existing locks and leaves reads available", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const record = await upload(store);
    await fs.writeFile(join(root, ".mutation.lock"), "another writer");
    await expect(store.trash(record.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    expect((await store.list())[0]!.revision).toBe(1);
    expect(await fs.readFile(join(root, ".mutation.lock"), "utf8")).toBe("another writer");
  });
  it("defines folder collisions, cycles, and trash/restore parents without disk paths", async () => {
    const store = await createFilesystemAssetStore(options(await sandbox()));
    const first = await store.createFolder({ name: "Photos", parentId: null }, await store.mutationToken());
    const child = await store.createFolder({ name: "Children", parentId: first.id }, await store.mutationToken());
    await expect(store.updateFolder(first.id, { parentId: child.id }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "validation" });
    await expect(store.createFolder({ name: "photos", parentId: null }, await store.mutationToken())).rejects.toMatchObject({ code: "validation" });
    await expect(store.updateFolder(child.id, { parentId: "missing" }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "validation" });
    await expect(store.trashFolder(first.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: "validation" });
    const moved = await store.updateFolder(child.id, { parentId: null, name: "Moved" }, { expectedRevision: 1 });
    const collision = await store.createFolder({ name: "moved", parentId: first.id }, await store.mutationToken());
    await expect(store.updateFolder(collision.id, { parentId: null }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "validation" });
    await store.trashFolder(collision.id, { expectedRevision: 1 });
    await expect(store.updateFolder(child.id, { name: "Stale" }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    await store.updateFolder(child.id, { parentId: first.id }, { expectedRevision: moved.revision });
    const asset = await upload(store, child.id);
    await expect(store.trashFolder(child.id, { expectedRevision: 3 })).rejects.toMatchObject({ code: "validation" });
    await store.trash(asset.id, { expectedRevision: 1 });
    await store.trashFolder(child.id, { expectedRevision: 3 });
    await store.trashFolder(first.id, { expectedRevision: 1 });
    await expect(store.restore(asset.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: "validation" });
    await expect(store.restoreFolder(child.id, { expectedRevision: 4 })).rejects.toMatchObject({ code: "validation" });
    await store.createFolder({ name: "PHOTOS", parentId: null }, await store.mutationToken());
    await expect(store.restoreFolder(first.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: "validation" });
  });
  it("leaves old head and all old bytes unchanged when metadata commit fails and supports retry", async () => {
    const root = await sandbox(); let fail = false;
    const store = await createFilesystemAssetStore(options(root, { operations: { rename: async (from, to) => {
      if (fail && to.endsWith("catalog.json")) throw Object.assign(new Error("injected"), { code: "EIO" });
      await fs.rename(from, to);
    } } }));
    const record = await upload(store); const snapshot = await store.snapshot(); fail = true;
    await expect(store.replace(record.id, { bytes: PDF }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "write-failed" });
    expect(await store.snapshot()).toEqual(snapshot); expect(await fs.readFile(bytePath(root))).toEqual(Buffer.from(PNG));
    expect(await fs.readFile(bytePath(root, PDF))).toEqual(Buffer.from(PDF)); // Harmless retained orphan, never visible as a version.
    fail = false; await store.replace(record.id, { bytes: PDF }, { expectedRevision: 1 });
    expect((await store.snapshot()).records[0]!.document.currentVersionId).toBe(digest(PDF));
  });
  it.each(["signature", "cap", "stream", "abort"])("preserves head/token on replacement %s failure", async (failure) => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const record = await upload(store);
    const before = await store.snapshot(); const controller = new AbortController();
    const bytes = (async function* () {
      if (failure === "signature") { yield new Uint8Array(12); return; }
      yield PNG;
      if (failure === "cap") { for (let i = 0; i < 26; i++) yield new Uint8Array(1024 * 1024); }
      if (failure === "stream") throw new Error("broken stream");
      if (failure === "abort") { controller.abort(new Error("aborted")); yield PDF; }
    })();
    await expect(store.replace(record.id, { bytes, signal: controller.signal }, { expectedRevision: 1 })).rejects.toBeDefined();
    expect(await store.snapshot()).toEqual(before); expect(await fs.readFile(bytePath(root))).toEqual(Buffer.from(PNG));
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".stage") || name.endsWith(".tmp"))).toEqual([]);
  });
  it("accepts exactly the streamed 25 MiB ceiling", async () => {
    const store = await createFilesystemAssetStore(options(await sandbox()));
    const bytes = (async function* () { yield PNG; yield new Uint8Array(ASSET_MAX_BYTE_LENGTH - PNG.length); })();
    const record = await store.upload({ fileName: "large.png", declaredMimeType: "image/png", bytes });
    expect(currentAssetVersion(record).byteLength).toBe(ASSET_MAX_BYTE_LENGTH);
  });
  it("never overwrites a byte path that races immutable publication", async () => {
    const root = await sandbox(); let inject = false;
    const store = await createFilesystemAssetStore(options(root, { operations: { link: async (from, to) => {
      if (inject) await fs.writeFile(to, "racing bytes", { flag: "wx" });
      await fs.link(from, to);
    } } }));
    const record = await upload(store); const before = await store.snapshot(); inject = true;
    await expect(store.replace(record.id, { bytes: PDF }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.snapshot()).toEqual(before);
    expect(await fs.readFile(bytePath(root, PDF), "utf8")).toBe("racing bytes");
    expect(await fs.readFile(bytePath(root))).toEqual(Buffer.from(PNG));
  });
  it("captures caller-owned metadata and revision preconditions before awaits", async () => {
    const store = await createFilesystemAssetStore(options(await sandbox())); const record = await upload(store);
    const patch = { note: "captured" }; const precondition = { expectedRevision: 1 };
    const save = store.updateMetadata(record.id, patch, precondition);
    patch.note = "late change"; precondition.expectedRevision = 999;
    expect((await save).document.note).toBe("captured");
    const replacementPrecondition = { expectedRevision: 2 };
    const replace = store.replace(record.id, { bytes: PDF }, replacementPrecondition);
    replacementPrecondition.expectedRevision = 999;
    expect((await replace).revision).toBe(3);
  });
  it("observes cancellation immediately before the catalog commit point", async () => {
    const root = await sandbox(); const controller = new AbortController(); let cancel = false;
    const store = await createFilesystemAssetStore(options(root));
    const record = await upload(store); const before = await store.snapshot();
    // Trigger cancellation after the new byte version is published, while
    // commitCatalog verifies its replacement target.
    const replacementStore = await createFilesystemAssetStore(options(root, { operations: {
      link: async (from, to) => { await fs.link(from, to); cancel = true; },
      lstat: async (path) => { const result = await fs.lstat(path); if (cancel && path.endsWith("catalog.json")) controller.abort(new Error("cancel before catalog rename")); return result; },
    } }));
    await expect(replacementStore.replace(record.id, { bytes: PDF, signal: controller.signal }, { expectedRevision: 1 })).rejects.toMatchObject({ code: "write-failed" });
    expect(await store.snapshot()).toEqual(before);
  });
  it("detects missing/corrupted exact bytes independently of the current head", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const record = await upload(store);
    await store.replace(record.id, { bytes: PDF }, { expectedRevision: 1 });
    const ref = { providerId: store.provider.id, assetId: record.id, versionId: digest(PNG) };
    await fs.writeFile(bytePath(root), "corrupted");
    await expect(store.resolveVersion(ref)).rejects.toMatchObject({ code: "bytes-missing" });
    expect((await store.get(record.id)).status).toBe("loaded");
    await expect(store.replace(record.id, { bytes: PNG }, { expectedRevision: 2 })).rejects.toMatchObject({ code: "bytes-missing" });
    await fs.unlink(bytePath(root, PDF));
    expect(await store.get(record.id)).toMatchObject({ status: "bytes-missing", reason: "missing" });
    expect(await store.list()).toHaveLength(1);
    await expect(store.resolveVersion({ ...ref, providerId: "other" })).rejects.toMatchObject({ code: "validation" });
  });
  it("imports only new valid single versions with verified bytes", async () => {
    const store = await createFilesystemAssetStore(options(await sandbox()));
    const record = createAssetRecord({ fileName: "import.png", mimeType: "image/png", byteLength: PNG.length, checksum: digest(PNG) }, { id: "imported" });
    await expect(store.put(record, PDF)).rejects.toMatchObject({ code: "validation" });
    await expect(store.put(record, Uint8Array.from([...PNG.slice(0, -1), 9]))).rejects.toMatchObject({ code: "validation" });
    await store.put(record, PNG); await expect(store.put(record, PNG)).rejects.toMatchObject({ code: "conflict" });
  });
  it.each(["../escape", "encoded%2fslash", "with/slash", ".hidden", "CAPS"])("rejects unsafe id %s", async (id) => {
    const store = await createFilesystemAssetStore(options(await sandbox()));
    await expect(store.get(id)).rejects.toMatchObject({ code: "validation" });
    await expect(store.delete(id)).rejects.toMatchObject({ code: "validation" });
  });
  it("rejects display filename separators and controls", async () => {
    const store = await createFilesystemAssetStore(options(await sandbox()));
    for (const fileName of ["../pixel.png", "a\nb.png", "a".repeat(256)]) await expect(store.upload({ fileName, declaredMimeType: "image/png", bytes: PNG })).rejects.toMatchObject({ code: "validation" });
  });
  it("refuses symlinked roots, parents, catalog and immutable byte paths", async () => {
    const parent = await sandbox(); await fs.mkdir(join(parent, "target")); await fs.symlink(join(parent, "target"), join(parent, "linked"));
    await expect(createFilesystemAssetStore(options(join(parent, "linked")))).rejects.toMatchObject({ code: "blocked" });
    for (const target of ["catalog", "bytes", "versions"]) {
      const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const outside = join(root, "outside");
      await fs.writeFile(outside, "untouched");
      if (target === "versions") { await fs.rename(join(root, "versions"), join(root, "original-versions")); await fs.symlink(join(root, "original-versions"), join(root, "versions")); }
      else await fs.symlink(outside, target === "catalog" ? join(root, "catalog.json") : bytePath(root));
      await expect(upload(store)).rejects.toMatchObject({ code: "blocked" }); expect(await fs.readFile(outside, "utf8")).toBe("untouched");
    }
  });
  it("detects replaced roots and preserves malformed/future catalogs for recovery", async () => {
    const parent = await sandbox(); const root = join(parent, "store"); const store = await createFilesystemAssetStore(options(root));
    await fs.rename(root, join(parent, "old")); await fs.mkdir(root); await expect(upload(store)).rejects.toMatchObject({ code: "blocked" });
    const fresh = await createFilesystemAssetStore(options(root));
    for (const text of ["{broken", JSON.stringify({ schemaVersion: ASSET_SCHEMA_VERSION + 1 })]) {
      await fs.writeFile(join(root, "catalog.json"), text);
      expect(await fresh.initialize()).toMatchObject({ status: "recovery-required", recovery: { sourcePreserved: true } });
      await expect(upload(fresh)).rejects.toMatchObject({ code: "recovery-required" });
      expect(await fs.readFile(join(root, "catalog.json"), "utf8")).toBe(text);
    }
  });
  it("aborts a stalled signature read promptly", async () => {
    const root = await sandbox(); const store = await createFilesystemAssetStore(options(root)); const controller = new AbortController();
    const bytes = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined) }; } };
    const promise = store.upload({ fileName: "pixel.png", declaredMimeType: "image/png", bytes, signal: controller.signal });
    controller.abort(new Error("client aborted")); await expect(promise).rejects.toThrow("client aborted");
    expect(await store.list()).toEqual([]);
  });
});
