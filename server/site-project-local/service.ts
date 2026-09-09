import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createComponentCatalog } from "../../src/composer/model/types";
import { createSiteProjectApiService } from "../../src/site-project/api/service";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import type { ResolvedComponentPack } from "../../plugins/component-pack.d.mts";
import type { SiteProjectApiService, ReleaseToolchain, SiteProjectApiDependencies } from "../../src/site-project/api/types";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem";
import type { VersionedAssetStore } from "../../src/assets/library";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";
import { DEFAULT_SETTINGS } from "../config/settings";
import { resolveWorkspaceRoot } from "../../plugins/roots.mjs";
import { releaseJson } from "../../src/site-project/api/review";
import { resolveLocalReleaseToolchain } from "./toolchain-config";
export { resolveLocalReleaseToolchain } from "./toolchain-config";

/**
 * `pack` is required and has no default: server-side validation must run
 * against the pack the host configured, or it would accept components the
 * browser cannot render. `packIdentity` is what the release is stamped with,
 * so it is required unless the caller supplies a `toolchain` outright.
 */
export interface LocalSiteProjectServiceOptions extends LocalSiteProjectStoreOptions { pack: TrustedComponentPack; packIdentity?: ResolvedComponentPack; workspaceRoot?: string; assetsStoreRoot?: string; assetStore?: VersionedAssetStore; toolchain?: ReleaseToolchain; isWorkingCurrent?: SiteProjectApiDependencies["isWorkingCurrent"]; reconcilePublication?: SiteProjectApiDependencies["reconcilePublication"] }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export function createLocalSiteProjectApiService(options: LocalSiteProjectServiceOptions): SiteProjectApiService {
  // The host's configured `assetsDir`. Every lane resolves it from the config
  // and passes it; the default only covers a caller that supplies neither.
  const assetRoot = resolve(options.assetsStoreRoot ?? resolve(resolveWorkspaceRoot(options.workspaceRoot), DEFAULT_SETTINGS.assetsDir));
  const catalog = createComponentCatalog(options.pack.manifest);
  const store = createLocalSiteProjectStore({ ...options, componentPack: catalog.pack, readAsset: options.readAsset ?? (async (pin) => {
    for (const path of [assetRoot, join(assetRoot, "versions")]) { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe pinned Assets source directory."); }
    const root = await realpath(assetRoot), versions = await realpath(join(assetRoot, "versions")); if (versions !== join(root, "versions")) throw new Error("Pinned source escaped Assets root.");
    const handle = await open(join(versions, basename(pin.url)), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat(); if (!stat.isFile() || stat.size !== pin.byteLength) { await handle.close(); throw new Error("Pinned Assets source is unavailable."); }
    return (async function* () { try { for await (const chunk of handle.createReadStream({ autoClose: false })) yield new Uint8Array(chunk); } finally { await handle.close(); } })();
  }) });
  const create = async () => {
    const toolchain = await resolveLocalReleaseToolchain(options);
    let assetStore = options.assetStore;
    if (!assetStore) { try { await lstat(join(assetRoot, "catalog.json")); assetStore = await createFilesystemAssetStore({ assetsStoreRoot: assetRoot }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    return createSiteProjectApiService({ componentCatalog: catalog, projectStore: store, buildStore: store, hash: async (text) => sha(text), toolchain, assetStore, isWorkingCurrent: options.isWorkingCurrent, reconcilePublication: options.reconcilePublication });
  };
  // The reason is carried, not swallowed. Every failure here used to reach the
  // Review route as one unactionable sentence, so a host wired without its pack
  // and a host whose Assets directory is unreadable were indistinguishable — and
  // the route reports the message verbatim to whoever has to fix it.
  const handle: SiteProjectApiService["handle"] = async (request) => {
    try { return await (await create()).handle(request); }
    catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, error: { code: "unavailable", message: `Release toolchain or Assets capability is unavailable. ${reason}` } };
    }
  };
  return { handle, serialize: async (request) => releaseJson(await handle(request)) };
}
