import type { ComponentCatalog } from "../../composer/model/types";
import type { SiteProject } from "../model";
import { serializeSiteProject } from "../model/canonical";
import type { VersionedMediaStore } from "../../media/library";
import type { MediaImpactIndex, MediaImpactLocation } from "./types";
import { inspectSiteProjectMedia } from "./capture";
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
        const project = await options.readProject(), revision = serializeSiteProject(project);
        const index = await inspectSiteProjectMedia(project, options.catalog, await options.mediaStore?.snapshot());
        if (serializeSiteProject(await options.readProject()) !== revision) { index.complete = false; index.advisory.push({ location: { domain: "materialization", providerId: project.activeSitemap.providerId, recordId: project.activeSitemap.recordId, valuePath: [] }, reason: "Project changed during impact inspection." }); }
        return { index, revision };
      })();
      pending = run; void run.finally(() => { if (pending === run) pending = undefined; }).catch(() => undefined); return run;
    },
    async isCurrent(revision) { try { return serializeSiteProject(await options.readProject()) === revision; } catch { return false; } },
    href: options.href,
  };
}
