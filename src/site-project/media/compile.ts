import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedMediaStore } from "../../media/library";
import { checkMediaLockPreconditions, verifyMediaLockIntegrity } from "../../media/references";
import { compileSiteProject, type SiteProjectCompilation } from "../compiler";
import type { SiteProject } from "../model";
import { serializeSiteProject } from "../model/canonical";
import { captureSiteProjectMediaLock } from "./capture";

/** Capture once, then compile and verify only those exact pins. No retry/latest fallback. */
export async function compileWithCapturedMedia(project: SiteProject, options: {
  catalog: ComponentCatalog; mediaStore?: VersionedMediaStore;
  readProject(): Promise<SiteProject>;
}): Promise<SiteProjectCompilation> {
  const blocked = (message: string): SiteProjectCompilation => ({ status: "blocked", routes: [], diagnostics: [{ severity: "blocking", code: "media-capture-blocked", message, path: "$.mediaLock" }] });
  try {
    const revision = serializeSiteProject(project);
    const captured = await captureSiteProjectMediaLock(project, options.catalog, options.mediaStore);
    if (captured.status === "blocked") return blocked(captured.diagnostics.map(({ message }) => message).join(" "));
    const { lock } = captured;
    const current = async () => {
      if (!lock) return true;
      if (!options.mediaStore || serializeSiteProject(await options.readProject()) !== revision) return false;
      if (!await verifyMediaLockIntegrity(lock, options.mediaStore)) return false;
      if (serializeSiteProject(await options.readProject()) !== revision) return false;
      // Last async observation is the Media precondition: a project read may
      // itself overlap a replacement, so do not acknowledge an earlier token.
      return checkMediaLockPreconditions(lock, options.mediaStore);
    };
    if (!await current()) return blocked("Project or Media changed during exact-version capture, or pinned bytes are unavailable.");
    const compilation = await compileSiteProject(project, { componentCatalog: options.catalog, policy: "release", mediaLock: lock });
    if (!await current()) return blocked("Project or Media changed during compilation, or pinned bytes are unavailable.");
    return compilation;
  } catch (error) { return blocked(error instanceof Error ? error.message : "Exact Media compilation failed."); }
}
