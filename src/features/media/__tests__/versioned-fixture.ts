import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createFilesystemAssetStore } from "../../../assets/storage/filesystem";
import type { AssetFileProvider, AssetFileProviderStore } from "../../../assets/storage/file-provider";
import type { AssetContentServices } from "../../../assets/integration/content";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
export const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
export const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic media");
export async function providerFixture() {
  const root = await mkdtemp(join(tmpdir(), "media-ui-")); roots.push(root);
  const filesystem = await createFilesystemAssetStore({ assetsStoreRoot: root });
  const blobBytes = (file: Blob) => new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(file); });
  const store = new Proxy(filesystem, { get(target, property) {
    if (property === "upload") return async (file: File, options: { folderId?: string | null } = {}) => target.upload({ fileName: file.name, declaredMimeType: file.type || "application/octet-stream", bytes: await blobBytes(file), ...options });
    if (property === "replace") return async (id: string, file: Blob, precondition: { expectedRevision: number }) => target.replace(id, { bytes: await blobBytes(file) }, precondition);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as AssetFileProviderStore;
  const provider: AssetFileProvider = { descriptor: filesystem.provider, store, initialization: { initialize: () => filesystem.initialize(), retry: () => filesystem.initialize(), startFresh: async () => { throw new Error("Unavailable"); } } };
  return { provider, filesystem, root };
}
export function completeServices(overrides: Partial<AssetContentServices> = {}): AssetContentServices {
  return { subscribeChanges: () => () => undefined, scan: async () => ({ status: "complete", locations: [], tokens: {}, message: "Complete structured scan; raw references may exist." }), isCurrent: async () => true, targets: async () => [], insert: async () => { throw new Error("No test insertion configured."); }, ...overrides };
}
