import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedMediaStore } from "../../media/library";
import type { MediaSnapshot } from "../../media/model";
import { checkMediaLockPreconditions, verifyMediaLockIntegrity } from "../../media/references";
import { compileSiteProject, type SiteProjectCompilation } from "../compiler";
import type { SiteProject } from "../model";
import { captureSiteProjectMediaLock } from "./capture";

/** Detached preflight by default. Only an aggregate capture guard can claim
 * captured consistency; candidate baseline checks are not a release snapshot. */
export async function compileWithCapturedMedia(project: SiteProject, options: {
  catalog: ComponentCatalog; mediaStore?: VersionedMediaStore;
  snapshot?: MediaSnapshot;
  checkBaseline?(): Promise<boolean>;
  isCaptureCurrent?(): Promise<boolean>;
}): Promise<SiteProjectCompilation & { consistency: "captured" | "detached" }> {
  const consistency = options.isCaptureCurrent ? "captured" as const : "detached" as const;
  const blocked = (message: string): SiteProjectCompilation & { consistency: "captured" | "detached" } => ({ consistency, status: "blocked", routes: [], diagnostics: [{ severity: "blocking", code: "media-capture-blocked", message, path: "$.mediaLock" }] });
  try {
    if (options.isCaptureCurrent && (!options.snapshot || !options.mediaStore)) return blocked("Aggregate Media capture is unavailable.");
    const captured = await captureSiteProjectMediaLock(project, options.catalog, options.mediaStore, options.snapshot);
    if (captured.status === "blocked") return blocked(captured.diagnostics.map(({ message }) => message).join(" "));
    const { lock } = captured;
    const current = async () => {
      if (lock && (!options.mediaStore || !await verifyMediaLockIntegrity(lock, options.mediaStore))) return false;
      if (options.checkBaseline && !await options.checkBaseline()) return false;
      if (options.isCaptureCurrent) return options.isCaptureCurrent();
      return !lock || (!!options.mediaStore && await checkMediaLockPreconditions(lock, options.mediaStore));
    };
    if (!await current()) return blocked("Project or Media changed during exact-version capture, or pinned bytes are unavailable.");
    const compilation = await compileSiteProject(project, { componentCatalog: options.catalog, policy: "release", mediaLock: lock });
    if (!await current()) return blocked("Project or Media changed during compilation, or pinned bytes are unavailable.");
    return { ...compilation, consistency };
  } catch (error) { return blocked(error instanceof Error ? error.message : "Exact Media compilation failed."); }
}
