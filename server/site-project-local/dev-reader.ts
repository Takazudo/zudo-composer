import type { SiteProject } from "../../src/site-project/model/types";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";

export interface ActivatedSiteProjectData {
  project: SiteProject;
  revision: string;
}

/** Read-only development seam. No path, mutation, or filesystem capability crosses it. */
export async function readActivatedSiteProject(options?: LocalSiteProjectStoreOptions): Promise<ActivatedSiteProjectData | null> {
  const result = await createLocalSiteProjectStore(options).readActiveProject();
  if (result.status === "unavailable") throw new Error("Activated SiteProject data is unavailable.");
  if (result.status === "not-found") return null;
  return result.value;
}
