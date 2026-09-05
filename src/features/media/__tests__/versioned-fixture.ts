import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createFilesystemMediaStore } from "../../../media/storage/filesystem";
import type { MediaFileProvider, MediaFileProviderStore } from "../../../media/storage/file-provider";
import type { MediaContentServices } from "../../../media/integration/content";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
export const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
export const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic media");
export async function providerFixture() {
  const root = await mkdtemp(join(tmpdir(), "media-ui-")); roots.push(root);
  const filesystem = await createFilesystemMediaStore({ mediaStoreRoot: root });
  const blobBytes = (file: Blob) => new Promise<Uint8Array>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(file); });
  const store = new Proxy(filesystem, { get(target, property) {
    if (property === "upload") return async (file: File, options: { folderId?: string | null } = {}) => target.upload({ fileName: file.name, declaredMediaType: file.type || "application/octet-stream", bytes: await blobBytes(file), ...options });
    if (property === "replace") return async (id: string, file: Blob, precondition: { expectedRevision: number }) => target.replace(id, { bytes: await blobBytes(file) }, precondition);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as MediaFileProviderStore;
  const provider: MediaFileProvider = { descriptor: filesystem.provider, store, initialization: { initialize: () => filesystem.initialize(), retry: () => filesystem.initialize(), startFresh: async () => { throw new Error("Unavailable"); } } };
  return { provider, filesystem, root };
}
export function completeServices(overrides: Partial<MediaContentServices> = {}): MediaContentServices {
  return { subscribeChanges: () => () => undefined, scan: async () => ({ status: "complete", locations: [], tokens: {}, message: "Complete structured scan; raw references may exist." }), isCurrent: async () => true, targets: async () => [], insert: async () => { throw new Error("No test insertion configured."); }, ...overrides };
}
