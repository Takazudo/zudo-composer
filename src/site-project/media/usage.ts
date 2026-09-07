import type { ComponentCatalog } from "../../composer/model/types";
import type { SiteProject } from "../model";
import { serializeSiteProject } from "../model/canonical";
import type { VersionedMediaStore } from "../../media/library";
import type { MediaImpactIndex, MediaImpactLocation } from "./types";
import { inspectSiteProjectMedia } from "./capture";

/**
 * How many times an inspection re-reads a project that moved under it.
 *
 * Inspecting the project is a provider round trip since the stores moved onto
 * the filesystem, and every authoring write hints every domain, so an ordinary
 * edit lands inside that interval routinely. A project that moved is a read to
 * repeat, not a verdict: reporting the first disagreement as an incomplete
 * index blocks Media trash on a race, and nothing re-runs the scan to clear it.
 * Only a project that never holds still across these attempts is unstable.
 */
const STABLE_PROJECT_ATTEMPTS = 3;

export interface ProjectMediaUsageInspection {
  read(): Promise<{ index: MediaImpactIndex; revision: string }>;
  isCurrent(revision: string): Promise<boolean>;
  href?(location: MediaImpactLocation): string | undefined;
}
export function createProjectMediaUsageInspection(options: { readProject(): Promise<SiteProject>; catalog: ComponentCatalog; mediaStore?: VersionedMediaStore; href?(location: MediaImpactLocation): string | undefined }): ProjectMediaUsageInspection {
  let pending: Promise<{ index: MediaImpactIndex; revision: string }> | undefined;
  return {
    read() {
      if (pending) return pending;
      const run = (async () => {
        let project = await options.readProject(), revision = serializeSiteProject(project);
        for (let attempt = 1; ; attempt += 1) {
          const index = await inspectSiteProjectMedia(project, options.catalog, await options.mediaStore?.snapshot(), options.mediaStore?.provider.id);
          const after = await options.readProject(), afterRevision = serializeSiteProject(after);
          if (afterRevision === revision) return { index, revision };
          if (attempt >= STABLE_PROJECT_ATTEMPTS) {
            index.complete = false;
            index.advisory.push({ location: { domain: "materialization", providerId: project.activeSitemap.providerId, recordId: project.activeSitemap.recordId, valuePath: [] }, reason: "Project changed during impact inspection." });
            return { index, revision };
          }
          // The read that caught the change is also the next attempt's project,
          // so a moving workspace costs one extra inspection rather than two reads.
          project = after; revision = afterRevision;
        }
      })();
      pending = run; void run.finally(() => { if (pending === run) pending = undefined; }).catch(() => undefined); return run;
    },
    async isCurrent(revision) { try { return serializeSiteProject(await options.readProject()) === revision; } catch { return false; } },
    href: options.href,
  };
}
