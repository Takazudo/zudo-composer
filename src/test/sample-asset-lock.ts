import { resolve } from "node:path";
import type { ComponentCatalog } from "../composer/model/types";
import { createFilesystemAssetStore } from "../assets/storage/filesystem";
import type { VersionedAssetStore } from "../assets/library";
import type { AssetReferenceLock } from "../assets/references";
import { captureSiteProjectAssetLock } from "../site-project/assets/capture";
import type { SiteProject } from "../site-project/model/types";
import { loadSampleSiteProject } from "./site-project-fixture";

/** Sample Studio's own committed Assets store: real catalog plus the pinned
 * `sha256-*` bytes at `packages/demo-sample/cms/assets`. */
export const SAMPLE_ASSETS_STORE_ROOT = resolve(import.meta.dirname, "../../packages/demo-sample/cms/assets");

export interface SampleSiteProjectWithAssetLock {
  project: SiteProject;
  assetStore: VersionedAssetStore;
  lock: AssetReferenceLock | undefined;
}

/** A real, read-only handle onto Sample Studio's committed Assets store. */
export function sampleAssetStore(): Promise<VersionedAssetStore> {
  return createFilesystemAssetStore({ assetsStoreRoot: SAMPLE_ASSETS_STORE_ROOT });
}

/**
 * Capture an exact-version Assets lock for `project` against Sample Studio's
 * real committed store, the way a release does: a real `VersionedAssetStore`,
 * then `captureSiteProjectAssetLock` (mirrors `server/site-build/compile.ts`).
 * `project` may be the committed sample or an injected copy of it — either
 * way release-policy compilation never blocks on `asset-impact-incomplete`.
 */
export async function captureSampleAssetLock(
  project: SiteProject,
  catalog: ComponentCatalog,
  assetStore?: VersionedAssetStore,
): Promise<SampleSiteProjectWithAssetLock> {
  const store = assetStore ?? (await sampleAssetStore());
  const captured = await captureSiteProjectAssetLock(project, catalog, store);
  if (captured.status !== "ready") {
    throw new Error(`Sample Studio Assets capture blocked: ${captured.diagnostics.map(({ message }) => message).join(" ")}`);
  }
  return { project, assetStore: store, lock: captured.lock };
}

/** The committed Sample Studio `SiteProject`, validated against `catalog`'s
 * pack and paired with a captured exact-version Assets lock from its real
 * committed store. */
export async function loadSampleSiteProjectWithAssetLock(catalog: ComponentCatalog): Promise<SampleSiteProjectWithAssetLock> {
  const project = loadSampleSiteProject({ componentPack: catalog.pack });
  return captureSampleAssetLock(project, catalog);
}
