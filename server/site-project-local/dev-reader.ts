import type { SiteProject } from "../../src/site-project/model/types";
import type { CompletedRelease, SiteProjectActiveSelection } from "../../src/site-project/api/types";
import type { MediaType } from "../../src/media/model";
import { createLocalSiteProjectStore } from "./store";
import { releaseJson } from "../../src/site-project/api/review";
import { resolveLocalReleaseToolchain } from "./toolchain-config.mjs";
import type { LocalSiteProjectStoreOptions } from "./store";

type DeliveryReaderOptions = LocalSiteProjectStoreOptions & { toolchain?: CompletedRelease["stage"]["toolchain"] };

/** Read-only development seam. No path, mutation, or filesystem capability crosses it. */
export interface ActivatedSiteReleaseData { project: SiteProject; release: CompletedRelease }
export async function readActivatedSiteRelease(options?: DeliveryReaderOptions): Promise<ActivatedSiteReleaseData | null> {
  const result = await createLocalSiteProjectStore(options).readActiveRelease();
  if (result.status === "unavailable") throw new Error(`Activated release is unavailable: ${result.message}`);
  if (result.status === "not-found") throw new Error("Activated release lookup failed.");
  if (result.value && releaseJson(result.value.release.stage.toolchain) !== releaseJson(await resolveLocalReleaseToolchain(options))) throw new Error("Activated release toolchain does not match the current installed runtime.");
  return result.value;
}

export interface ActivatedSiteMediaData { bytes: Uint8Array; mediaType: MediaType; identity: SiteProjectActiveSelection }
export async function readActivatedSiteMedia(pathname: string, options?: DeliveryReaderOptions): Promise<ActivatedSiteMediaData | null> {
  const release = await readActivatedSiteRelease(options);
  if (!release) return null;
  const result = await createLocalSiteProjectStore(options).readActiveMedia(pathname);
  if (result.status === "unavailable") throw new Error(`Activated Media is unavailable: ${result.message}`);
  if (result.status === "not-found") return null;
  if (releaseJson(result.value.identity) !== releaseJson(release.release.identity)) throw new Error("Activated release changed during Media verification.");
  return result.value;
}
