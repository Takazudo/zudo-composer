import type { SiteProject } from "../model";
import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedAssetStore } from "../../assets/library";
import type { AssetSnapshot } from "../../assets/model";
import { createAssetReferenceLock } from "../../assets/references";
import { compileSiteProject } from "../compiler/compiler";
import type { SiteCompilerDiagnostic } from "../compiler/types";
import { resolveSiteProjectAsset } from "./impact";
/** Inspect impact plus the compile diagnostics that made it incomplete, if any:
 * the raw root cause `captureSiteProjectAssetLock` carries as `causes`, kept out
 * of `inspectSiteProjectAsset`'s own return so `usage.ts` stays unaffected. */
async function inspectSiteProjectAssetWithCauses(project: SiteProject, catalog: ComponentCatalog, snapshot?: AssetSnapshot, providerId?: string) {
  const compilation = await compileSiteProject(project, { componentCatalog: catalog, policy: "authoring-preview" });
  const routes = compilation.status === "ready" ? compilation.build.routes : compilation.routes;
  const { index } = resolveSiteProjectAsset(project, catalog, { snapshot, routes, providerId });
  if (compilation.status === "blocked") {
    index.complete = false;
    for (const diagnostic of compilation.diagnostics) index.advisory.push({ location: { domain: "materialization", providerId: project.activeSitemap.providerId, recordId: project.activeSitemap.recordId, valuePath: [], pathname: diagnostic.pathname }, reason: `Route materialization is incomplete: ${diagnostic.message}` });
  }
  return { index, causes: compilation.status === "blocked" ? compilation.diagnostics : [] as readonly SiteCompilerDiagnostic[] };
}
export async function inspectSiteProjectAsset(project: SiteProject, catalog: ComponentCatalog, snapshot?: AssetSnapshot, providerId?: string) {
  return (await inspectSiteProjectAssetWithCauses(project, catalog, snapshot, providerId)).index;
}
export async function captureSiteProjectAssetLock(project: SiteProject, catalog: ComponentCatalog, store: VersionedAssetStore | undefined, suppliedSnapshot?: AssetSnapshot) {
  try {
  const snapshot = suppliedSnapshot ?? await store?.snapshot();
  const { index, causes } = await inspectSiteProjectAssetWithCauses(project, catalog, snapshot, store?.provider.id);
  if (!index.complete) return { status: "blocked" as const, index, causes, diagnostics: [{ code: "unrecognized" as const, message: "Assets impact inspection is incomplete; exact release capture is blocked." }] };
  if (!index.references.length && !store) return { status: "ready" as const, index, lock: undefined };
  const result = await createAssetReferenceLock(store, index.references.map(({ ref }) => ref), snapshot);
  // `index.complete` is true here, so compilation never blocked: `causes` is
  // always empty, but every branch must carry it for a stable narrowed shape.
  return { ...result, index, causes };
  } catch (error) {
    return { status: "blocked" as const, index: { complete: false, references: [], advisory: [] }, causes: [] as readonly SiteCompilerDiagnostic[], diagnostics: [{ code: "unavailable" as const, message: error instanceof Error ? error.message : "Assets impact capture failed." }] };
  }
}
