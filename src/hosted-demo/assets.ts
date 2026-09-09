import { createAssetRecord, currentAssetVersion, summarizeAsset, AssetPersistenceError, ASSET_VERSIONED_CAPABILITIES, type AssetByteSource, type AssetMutationPrecondition } from "../assets/library";
import { ASSET_MAX_BYTE_LENGTH, assetVersionUrl, validateAssetSnapshot, type AssetSnapshot, type AssetRecord, type AssetFolder, type AssetVersionRef } from "../assets/model";
import { sniffAsset } from "../assets/model/sniff";
import type { AssetFileProvider, AssetFileProviderStore } from "../assets/storage/file-provider/types";
import { notifyPersistenceChange } from "../shared/persistence-generation";
export interface DemoAssetSeed { snapshot: AssetSnapshot; bytes: Record<string, Uint8Array> }
export async function sha256(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const fail = (message: string, code: "validation" | "conflict" | "not-found" | "bytes-missing" = "validation"): never => { throw new AssetPersistenceError("put", code, message, code === "conflict"); };
async function verified(bytes: Uint8Array, declaredMimeType?: string) {
  if (!bytes.length || bytes.length > ASSET_MAX_BYTE_LENGTH) fail("Assets must contain 1 byte to 25 MiB.");
  const kind = sniffAsset(bytes, declaredMimeType); if (!kind) fail("Unsupported assets signature.");
  return { checksum: await sha256(bytes), byteLength: bytes.length, mimeType: kind!.mimeType };
}
export async function createDemoAsset(seed: DemoAssetSeed) {
  if (!validateAssetSnapshot(seed.snapshot)) fail("Invalid demo assets snapshot.");
  let snapshot = structuredClone(seed.snapshot);
  const bytes = new Map<string, Uint8Array>();
  for (const r of snapshot.records) for (const v of r.document.versions) { const data = seed.bytes[v.checksum]; if (!data) fail("Missing demo assets bytes.", "bytes-missing"); const check = await verified(data, v.mimeType); if (check.checksum !== v.checksum || check.byteLength !== v.byteLength || check.mimeType !== v.mimeType) fail("Demo assets checksum or MIME mismatch."); bytes.set(v.checksum, Uint8Array.from(data)); }
  let token = BigInt(`0x${snapshot.mutationToken}`);
  const check = (value: { revision: number }, pre: AssetMutationPrecondition) => { if (!pre || pre.expectedRevision !== value.revision || (pre.expectedMutationToken !== undefined && pre.expectedMutationToken !== snapshot.mutationToken)) fail("Assets changed. Refresh and retry.", "conflict"); };
  const cas = (expected?: string) => { if (expected !== undefined && expected !== snapshot.mutationToken) fail("Assets changed. Refresh and retry.", "conflict"); };
  function commit<T>(fn: (draft: AssetSnapshot) => T): T { const draft = structuredClone(snapshot); const result = fn(draft); draft.mutationToken = (token + 1n).toString(16).padStart(64, "0"); if (!validateAssetSnapshot(draft)) fail("Assets change violates metadata, folder or version constraints."); token++; snapshot = draft; notifyPersistenceChange("assets"); return structuredClone(result); }
  const record = (id: string, s = snapshot) => s.records.find((r) => r.id === id) ?? fail("Assets asset not found.", "not-found");
  const folder = (id: string, s = snapshot) => s.folders.find((r) => r.id === id) ?? fail("Assets folder not found.", "not-found");
  const editRecord = (id: string, pre: AssetMutationPrecondition, edit: (r: AssetRecord) => void) => { check(record(id), pre); return commit((draft) => { const r = record(id, draft); edit(r); r.revision++; r.updatedAt = new Date().toISOString(); return r; }); };
  const editFolder = (id: string, pre: AssetMutationPrecondition, edit: (r: AssetFolder) => void) => { check(folder(id), pre); return commit((draft) => { const r = folder(id, draft); edit(r); r.revision++; r.updatedAt = new Date().toISOString(); return r; }); };
  const initialize = async () => ({ status: "ready" as const, summaries: await store.list() });
  const resolveVersion = async (ref: AssetVersionRef) => { if (ref.providerId !== "asset-files") fail("Unknown assets provider."); const v = record(ref.assetId).document.versions.find((v) => v.id === ref.versionId) ?? fail("Assets version not found.", "not-found"); const data = bytes.get(v.checksum); if (!data || await sha256(data) !== v.checksum) fail("Assets version bytes missing or corrupt.", "bytes-missing"); return { ...ref, checksum: v.checksum, byteLength: v.byteLength, mimeType: v.mimeType, url: v.url }; };
  const store: AssetFileProviderStore = {
    provider: { id: "asset-files", label: "Disposable demo" }, capabilities: ASSET_VERSIONED_CAPABILITIES,
    initialize,
    async snapshot() { return structuredClone(snapshot); }, async mutationToken() { return snapshot.mutationToken; },
    async list(options = {}) { return snapshot.records.filter((r) => (options.state === "all" || r.document.state === (options.state ?? "active")) && (options.folderId === undefined || r.document.folderId === options.folderId)).map(summarizeAsset); },
    async get(id) { const r = snapshot.records.find((r) => r.id === id); return r ? { status: "loaded", record: structuredClone(r) } : { status: "not-found", id }; },
    async upload(file, options = {}) { const data = new Uint8Array(await file.arrayBuffer()); const info = await verified(data, file.type); cas(options.expectedMutationToken); const r = createAssetRecord({ ...info, fileName: file.name, folderId: options.folderId, note: options.note }); commit((draft) => { draft.records.push(r); }); bytes.set(info.checksum, data); return structuredClone(r); },
    async replace(id, file, pre) { const data = new Uint8Array(await file.arrayBuffer()); const info = await verified(data, file.type); const updated = editRecord(id, pre, (r) => { if (r.document.state !== "active") fail("Restore the asset before replacing it."); if (!r.document.versions.some((v) => v.id === info.checksum)) r.document.versions.push({ ...info, id: info.checksum, url: assetVersionUrl(info.checksum, info.mimeType), createdAt: new Date().toISOString() }); r.document.currentVersionId = info.checksum; }); bytes.set(info.checksum, data); return updated; },
    async put(r, source: AssetByteSource) { const chunks: Uint8Array[] = []; if (source instanceof ArrayBuffer) chunks.push(new Uint8Array(source)); else if (ArrayBuffer.isView(source)) chunks.push(Uint8Array.from(source)); else { const iterable = source instanceof ReadableStream ? { async *[Symbol.asyncIterator]() { const reader = source.getReader(); try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } } finally { reader.releaseLock(); } } } : source; let length = 0; for await (const chunk of iterable) { length += chunk.length; if (length > ASSET_MAX_BYTE_LENGTH) fail("Assets exceeds 25 MiB."); chunks.push(chunk); } } const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const c of chunks) { data.set(c, offset); offset += c.length; } const v = currentAssetVersion(r); const info = await verified(data, v.mimeType); if (info.checksum !== v.checksum || info.byteLength !== v.byteLength || info.mimeType !== v.mimeType) fail("Assets metadata does not match bytes."); if (snapshot.records.some((x) => x.id === r.id)) fail("Use versioned mutations for existing assets.", "conflict"); if (r.document.versions.some((version) => version.id !== info.checksum && !bytes.has(version.id))) fail("Historical version bytes are missing."); commit((draft) => { draft.records.push(structuredClone(r)); }); bytes.set(info.checksum, data); },
    async updateMetadata(id, patch, pre) { return editRecord(id, pre, (r) => { Object.assign(r.document, patch); }); },
    async trash(id, pre) { return editRecord(id, pre, (r) => { r.document.state = "trash"; }); },
    async restore(id, pre) { return editRecord(id, pre, (r) => { r.document.state = "active"; }); },
    async delete(id, pre) { if (!pre) fail("Deletion requires a revision precondition.", "conflict"); if (!snapshot.records.some((r) => r.id === id)) return false; await store.trash(id, pre!); return true; },
    async clear() { fail("Bulk permanent deletion is unavailable in the demo."); },
    async createFolder(input, expected) { if (input.index !== undefined && (!Number.isSafeInteger(input.index) || input.index < 0)) fail("Invalid folder index."); cas(expected); return commit((draft) => { const timestamp = new Date().toISOString(); const f: AssetFolder = { id: crypto.randomUUID(), name: input.name, parentId: input.parentId, state: "active", revision: 1, createdAt: timestamp, updatedAt: timestamp }; draft.folders.splice(input.index ?? draft.folders.length, 0, f); return f; }); },
    async updateFolder(id, patch, pre) { if (patch.index !== undefined && (!Number.isSafeInteger(patch.index) || patch.index < 0)) fail("Invalid folder index."); check(folder(id), pre); return commit((draft) => { const f = folder(id, draft); if (patch.name !== undefined) f.name = patch.name; if (patch.parentId !== undefined) f.parentId = patch.parentId; f.revision++; f.updatedAt = new Date().toISOString(); if (patch.index !== undefined) { draft.folders.splice(draft.folders.indexOf(f), 1); draft.folders.splice(patch.index, 0, f); } return f; }); },
    async trashFolder(id, pre) { if (snapshot.records.some((r) => r.document.folderId === id && r.document.state === "active") || snapshot.folders.some((f) => f.parentId === id && f.state === "active")) fail("Move active children before trashing a folder."); return editFolder(id, pre, (f) => { f.state = "trash"; }); },
    async restoreFolder(id, pre) { return editFolder(id, pre, (f) => { f.state = "active"; }); },
    resolveVersion,
    async pinManifest(refs) { const unique = [...new Map(refs.map((ref) => [JSON.stringify([ref.providerId, ref.assetId, ref.versionId]), ref])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0); return { schemaVersion: 1, pins: await Promise.all(unique.map(([, ref]) => resolveVersion(ref))) }; },
  };
  const previewUrls = new Map<string, string>();
  const previewUrl = (url: string): string => {
    const existing = previewUrls.get(url); if (existing) return existing;
    const version = snapshot.records.flatMap((r) => r.document.versions).find((v) => v.url === url);
    const data = version && bytes.get(version.checksum); if (!version || !data) fail("Preview bytes are missing.", "bytes-missing");
    const objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(data!)], { type: version!.mimeType }));
    previewUrls.set(url, objectUrl); return objectUrl;
  };
  const provider: AssetFileProvider = { previewUrl, descriptor: store.provider, store, initialization: { initialize, retry: initialize, startFresh: initialize } };
  return { provider, exportSeed(): DemoAssetSeed { return { snapshot: structuredClone(snapshot), bytes: Object.fromEntries([...bytes].map(([key, value]) => [key, Uint8Array.from(value)])) }; }, readUrl(path: string) { let version; if (path.startsWith("/uploaded-assets/asset-")) { const r = snapshot.records.find((r) => r.id === path.slice("/uploaded-assets/asset-".length) && r.document.state === "active"); if (r) version = currentAssetVersion(r); } else { version = snapshot.records.flatMap((r) => r.document.versions).find((v) => v.url === path); } if (!version) return null; const data = bytes.get(version.checksum); return data ? { bytes: Uint8Array.from(data), mimeType: version.mimeType, checksum: version.checksum, byteLength: version.byteLength, url: version.url } : null; } };
}
