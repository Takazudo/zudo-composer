import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedAssetStore } from "../../assets/library";
import type { AssetSnapshot } from "../../assets/model";
import { checkAssetLockPreconditions, verifyAssetLockIntegrity } from "../../assets/references";
import { compileSiteProject, type SiteProjectCompilation } from "../compiler";
import type { SiteProject } from "../model";
import { captureSiteProjectAssetLock } from "./capture";

/** Detached preflight by default. Only an aggregate capture guard can claim
 * captured consistency; candidate baseline checks are not a release snapshot. */
export async function compileWithCapturedAsset(project: SiteProject, options: {
  catalog: ComponentCatalog; assetStore?: VersionedAssetStore;
  snapshot?: AssetSnapshot;
  checkBaseline?(): Promise<boolean>;
  isCaptureCurrent?(): Promise<boolean>;
}): Promise<SiteProjectCompilation & { consistency: "captured" | "detached" }> {
  const consistency = options.isCaptureCurrent ? "captured" as const : "detached" as const;
  const blocked = (message: string): SiteProjectCompilation & { consistency: "captured" | "detached" } => ({ consistency, status: "blocked", routes: [], diagnostics: [{ severity: "blocking", code: "asset-capture-blocked", message, path: "$.assetLock" }] });
  try {
    if (options.isCaptureCurrent && (!options.snapshot || !options.assetStore)) return blocked("Aggregate Assets capture is unavailable.");
    const captured = await captureSiteProjectAssetLock(project, options.catalog, options.assetStore, options.snapshot);
    if (captured.status === "blocked") return blocked(captured.diagnostics.map(({ message }) => message).join(" "));
    const { lock } = captured;
    const current = async () => {
      if (lock && (!options.assetStore || !await verifyAssetLockIntegrity(lock, options.assetStore))) return false;
      if (options.checkBaseline && !await options.checkBaseline()) return false;
      if (options.isCaptureCurrent) return options.isCaptureCurrent();
      return !lock || (!!options.assetStore && await checkAssetLockPreconditions(lock, options.assetStore));
    };
    if (!await current()) return blocked("Project or Assets changed during exact-version capture, or pinned bytes are unavailable.");
    const compilation = await compileSiteProject(project, { componentCatalog: options.catalog, policy: "release", assetLock: lock });
    if (!await current()) return blocked("Project or Assets changed during compilation, or pinned bytes are unavailable.");
    return { ...compilation, consistency };
  } catch (error) { return blocked(error instanceof Error ? error.message : "Exact Assets compilation failed."); }
}
