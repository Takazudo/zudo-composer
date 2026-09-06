import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createComponentCatalog } from "../../src/composer/model/types";
import { createSiteProjectApiService } from "../../src/site-project/api/service";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComponentPack } from "../../plugins/component-pack.d.mts";
import type { SiteProjectApiService, ReleaseToolchain, SiteProjectApiDependencies } from "../../src/site-project/api/types";
import { createFilesystemMediaStore } from "../../src/media/storage/filesystem";
import type { VersionedMediaStore } from "../../src/media/library";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";
import { releaseJson } from "../../src/site-project/api/review";
import { resolveLocalReleaseToolchain } from "./toolchain-config";
export { resolveLocalReleaseToolchain } from "./toolchain-config";

/**
 * `pack` is required and has no default: server-side validation must run
 * against the pack the host configured, or it would accept components the
 * browser cannot render. `packIdentity` is what the release is stamped with,
 * so it is required unless the caller supplies a `toolchain` outright.
 */
export interface LocalSiteProjectServiceOptions extends LocalSiteProjectStoreOptions { pack: TrustedComponentPack; packIdentity?: ResolvedComponentPack; workspaceRoot?: string; mediaStoreRoot?: string; mediaStore?: VersionedMediaStore; toolchain?: ReleaseToolchain; isWorkingCurrent?: SiteProjectApiDependencies["isWorkingCurrent"]; reconcilePublication?: SiteProjectApiDependencies["reconcilePublication"] }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export function createLocalSiteProjectApiService(options: LocalSiteProjectServiceOptions): SiteProjectApiService {
  const mediaRoot = resolve(options.mediaStoreRoot ?? resolve(process.cwd(), "media-store"));
  const catalog = createComponentCatalog(options.pack.manifest);
  const store = createLocalSiteProjectStore({ ...options, componentPack: catalog.pack, readMedia: options.readMedia ?? (async (pin) => {
    for (const path of [mediaRoot, join(mediaRoot, "versions")]) { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe pinned Media source directory."); }
    const root = await realpath(mediaRoot), versions = await realpath(join(mediaRoot, "versions")); if (versions !== join(root, "versions")) throw new Error("Pinned source escaped Media root.");
    const handle = await open(join(versions, basename(pin.url)), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat(); if (!stat.isFile() || stat.size !== pin.byteLength) { await handle.close(); throw new Error("Pinned Media source is unavailable."); }
    return (async function* () { try { for await (const chunk of handle.createReadStream({ autoClose: false })) yield new Uint8Array(chunk); } finally { await handle.close(); } })();
  }) });
  const create = async () => {
    const toolchain = await resolveLocalReleaseToolchain(options);
    let mediaStore = options.mediaStore;
    if (!mediaStore) { try { await lstat(join(mediaRoot, "catalog.json")); mediaStore = await createFilesystemMediaStore({ mediaStoreRoot: mediaRoot }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    return createSiteProjectApiService({ componentCatalog: catalog, projectStore: store, buildStore: store, hash: async (text) => sha(text), toolchain, mediaStore, isWorkingCurrent: options.isWorkingCurrent, reconcilePublication: options.reconcilePublication });
  };
  const handle: SiteProjectApiService["handle"] = async (request) => { try { return await (await create()).handle(request); } catch { return { ok: false, error: { code: "unavailable", message: "Release toolchain or Media capability is unavailable." } }; } };
  return { handle, serialize: async (request) => releaseJson(await handle(request)) };
}
