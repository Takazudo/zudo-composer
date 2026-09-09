import type { ComponentCatalog } from "../../composer/model/types";
import type { SiteProject } from "../model";
import { serializeSiteProject } from "../model/canonical";
import type { VersionedAssetStore } from "../../assets/library";
import type { AssetImpactIndex, AssetImpactLocation } from "./types";
import { inspectSiteProjectAsset } from "./capture";

/**
 * How many times an inspection re-reads a project that moved under it.
 *
 * Inspecting the project is a provider round trip since the stores moved onto
 * the filesystem, and every authoring write hints every domain, so an ordinary
 * edit lands inside that interval routinely. A project that moved is a read to
 * repeat, not a verdict: reporting the first disagreement as an incomplete
 * index blocks Assets trash on a race, and nothing re-runs the scan to clear it.
 * Only a project that never holds still across these attempts is unstable.
 */
const STABLE_PROJECT_ATTEMPTS = 3;

export interface ProjectAssetUsageInspection {
  read(): Promise<{ index: AssetImpactIndex; revision: string }>;
  isCurrent(revision: string): Promise<boolean>;
  href?(location: AssetImpactLocation): string | undefined;
}
export function createProjectAssetUsageInspection(options: { readProject(): Promise<SiteProject>; catalog: ComponentCatalog; assetStore?: VersionedAssetStore; href?(location: AssetImpactLocation): string | undefined }): ProjectAssetUsageInspection {
  let pending: Promise<{ index: AssetImpactIndex; revision: string }> | undefined;
  return {
    read() {
      if (pending) return pending;
      const run = (async () => {
        let project = await options.readProject(), revision = serializeSiteProject(project);
        for (let attempt = 1; ; attempt += 1) {
          const index = await inspectSiteProjectAsset(project, options.catalog, await options.assetStore?.snapshot(), options.assetStore?.provider.id);
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
