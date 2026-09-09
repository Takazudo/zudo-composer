import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFilesystemAssetStore } from "../../storage/filesystem";
import { createAssetReferenceLock, resolvePinnedAsset, checkAssetLockPreconditions, verifyAssetLockIntegrity, LiveAssetReferenceResolver, parseManagedAssetUrl, validateAssetReferenceLock, serializeAssetReferenceLock } from "../resolver";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "media-reference-")); roots.push(root);
  const store = await createFilesystemAssetStore({ assetsStoreRoot: root });
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  const record = await store.upload({ fileName: "image.png", declaredMimeType: "image/png", bytes });
  return { root, store, bytes, record, ref: { providerId: store.provider.id, assetId: record.id } };
}
describe("managed reference locking", () => {
  it("recognizes only canonical authoring URLs", () => {
    expect(parseManagedAssetUrl("/uploaded-assets/asset-hero")).toEqual({ providerId: "asset-files", assetId: "hero" });
    for (const value of ["https://other.test/uploaded-assets/asset-hero", "/uploaded-assets/asset-hero?q=x", "text /uploaded-assets/asset-hero", "/uploaded-assets/asset-../x"]) expect(parseManagedAssetUrl(value)).toBeUndefined();
  });
  it("deduplicates exact locks and never retargets an old pin after replacement", async () => {
    const { store, bytes, record, ref } = await setup();
    const locked = await createAssetReferenceLock(store, [ref, ref]); expect(locked.status).toBe("ready"); if (locked.status !== "ready") return;
    expect(locked.lock.pins).toHaveLength(1); const before = JSON.stringify(locked.lock);
    expect(await checkAssetLockPreconditions(locked.lock, store)).toBe(true);
    await store.replace(record.id, { bytes: new Uint8Array([...bytes, 9]) }, { expectedRevision: record.revision });
    expect(await checkAssetLockPreconditions(locked.lock, store)).toBe(false);
    expect(resolvePinnedAsset(ref, locked.lock)?.versionId).toBe(record.document.currentVersionId);
    expect(await verifyAssetLockIntegrity(locked.lock, store)).toBe(true); expect(JSON.stringify(locked.lock)).toBe(before);
  });
  it("invalidates live draft heads and rejects missing, trashed and corrupt assets", async () => {
    const { store, bytes, record, ref, root } = await setup(); let invalidate!: () => void;
    const resolver = new LiveAssetReferenceResolver(store, (listener) => { invalidate = listener; return () => undefined; });
    const stop = resolver.subscribeChanges(() => undefined);
    const first = await resolver.resolve([ref]); expect(first.status).toBe("ready");
    const replaced = await store.replace(record.id, { bytes: new Uint8Array([...bytes, 8]) }, { expectedRevision: record.revision }); invalidate();
    const second = await resolver.resolve([ref]); expect(second.status).toBe("ready");
    if (second.status !== "ready" || first.status !== "ready") return;
    expect(second.lock.pins[0]!.versionId).not.toBe(first.lock.pins[0]!.versionId);
    await writeFile(join(root, "versions", second.lock.pins[0]!.url.split("/").at(-1)!), "corrupt");
    expect((await createAssetReferenceLock(store, [ref])).status).toBe("blocked");
    await store.trash(record.id, { expectedRevision: replaced.revision });
    expect(await createAssetReferenceLock(store, [ref])).toMatchObject({ status: "blocked", diagnostics: [{ code: "trashed" }] });
    expect(await createAssetReferenceLock(store, [{ ...ref, assetId: "missing" }])).toMatchObject({ status: "blocked", diagnostics: [{ code: "missing" }] }); stop();
  });
  it("canonicalizes multiple versions and rejects inconsistent metadata preconditions", async () => {
    const { store, bytes, record, ref } = await setup();
    await store.replace(record.id, { bytes: new Uint8Array([...bytes, 7]) }, { expectedRevision: record.revision });
    const exact = { ...ref, versionId: record.document.currentVersionId };
    const first = await createAssetReferenceLock(store, [ref, exact, ref]);
    const second = await createAssetReferenceLock(store, [exact, ref]);
    expect(first.status).toBe("ready"); expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") return;
    expect(serializeAssetReferenceLock(first.lock)).toBe(serializeAssetReferenceLock(second.lock));
    const invalid = structuredClone(first.lock); invalid.pins[1]!.metadataRevision++;
    expect(validateAssetReferenceLock(invalid)).toBe(false);
    expect(validateAssetReferenceLock({ ...first.lock, extra: true })).toBe(false);
  });
});
