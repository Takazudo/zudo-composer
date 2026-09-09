import type { SiteProject } from "../../src/site-project/model/types";
import type { CompletedRelease, SiteProjectActiveSelection } from "../../src/site-project/api/types";
import type { AssetType } from "../../src/assets/model";
import { createLocalSiteProjectStore } from "./store";
import { releaseJson } from "../../src/site-project/api/review";
import { resolveLocalReleaseToolchain, type LocalReleaseToolchainOptions } from "./toolchain-config";
import type { LocalSiteProjectStoreOptions } from "./store";

/** The reader compares the activated release's toolchain against the current
 * one, so it needs the same pack identity the service stamps releases with. */
type DeliveryReaderOptions = LocalSiteProjectStoreOptions & LocalReleaseToolchainOptions;

/** Read-only development seam. No path, mutation, or filesystem capability crosses it. */
export interface ActivatedSiteReleaseData { project: SiteProject; release: CompletedRelease }
export async function readActivatedSiteRelease(options?: DeliveryReaderOptions): Promise<ActivatedSiteReleaseData | null> {
  const result = await createLocalSiteProjectStore(options).readActiveRelease();
  if (result.status === "unavailable") throw new Error(`Activated release is unavailable: ${result.message}`);
  if (result.status === "not-found") throw new Error("Activated release lookup failed.");
  if (result.value && releaseJson(result.value.release.stage.toolchain) !== releaseJson(await resolveLocalReleaseToolchain(options))) throw new Error("Activated release toolchain does not match the current installed runtime.");
  return result.value;
}

export interface ActivatedSiteAssetData { bytes: Uint8Array; mimeType: AssetType; identity: SiteProjectActiveSelection }
export async function readActivatedSiteAssets(pathname: string, options?: DeliveryReaderOptions): Promise<ActivatedSiteAssetData | null> {
  const release = await readActivatedSiteRelease(options);
  if (!release) return null;
  const result = await createLocalSiteProjectStore(options).readActiveAsset(pathname);
  if (result.status === "unavailable") throw new Error(`Activated Assets is unavailable: ${result.message}`);
  if (result.status === "not-found") return null;
  if (releaseJson(result.value.identity) !== releaseJson(release.release.identity)) throw new Error("Activated release changed during Assets verification.");
  return result.value;
}
