import type { SiteProject } from "../../src/site-project/model/types";
import type { CompletedRelease, SiteProjectActiveSelection } from "../../src/site-project/api/types";
import type { MediaType } from "../../src/media/model";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";

/** Read-only development seam. No path, mutation, or filesystem capability crosses it. */
export interface ActivatedSiteReleaseData { project: SiteProject; release: CompletedRelease }
export async function readActivatedSiteRelease(options?: LocalSiteProjectStoreOptions): Promise<ActivatedSiteReleaseData | null> {
  const result = await createLocalSiteProjectStore(options).readActiveRelease();
  if (result.status === "unavailable") throw new Error(`Activated release is unavailable: ${result.message}`);
  if (result.status === "not-found") throw new Error("Activated release lookup failed.");
  return result.value;
}

export interface ActivatedSiteMediaData { bytes: Uint8Array; mediaType: MediaType; identity: SiteProjectActiveSelection }
export async function readActivatedSiteMedia(pathname: string, options?: LocalSiteProjectStoreOptions): Promise<ActivatedSiteMediaData | null> {
  const result = await createLocalSiteProjectStore(options).readActiveMedia(pathname);
  if (result.status === "unavailable") throw new Error(`Activated Media is unavailable: ${result.message}`);
  return result.status === "not-found" ? null : result.value;
}
