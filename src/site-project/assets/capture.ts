import type { SiteProject } from "../model";
import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedAssetStore } from "../../assets/library";
import type { AssetSnapshot } from "../../assets/model";
import { createAssetReferenceLock } from "../../assets/references";
import { compileSiteProject } from "../compiler/compiler";
import type { SiteCompilerDiagnostic } from "../compiler/types";
import type { SitemapNode } from "../../sitemapper/model/types";
import { resolveSiteProjectAsset } from "./impact";
function unassignedPageHasNoMaterialization(project: SiteProject, diagnostic: SiteCompilerDiagnostic): boolean {
  if (diagnostic.code !== "unassigned-page" || !diagnostic.nodeId) return false;
  const sitemap = project.providers.sitemaps.find(provider => provider.id === project.activeSitemap.providerId)
    ?.records.find(record => record.id === project.activeSitemap.recordId);
  if (!sitemap) return false;
  const matches: SitemapNode[] = [];
  const visit = (nodes: readonly SitemapNode[]) => { for (const node of nodes) { if (node.id === diagnostic.nodeId) matches.push(node); visit(node.children); } };
  visit(sitemap.document.root);
  return matches.length === 1 && matches[0]!.source.kind === "unassigned";
}
/** Keep materialization causes separate from Asset diagnostics for strict callers. */
async function inspectSiteProjectAssetWithCauses(project: SiteProject, catalog: ComponentCatalog, snapshot?: AssetSnapshot, providerId?: string, authoringSnapshot = false) {
  const compilation = await compileSiteProject(project, { componentCatalog: catalog, policy: "authoring-preview" });
  const routes = compilation.status === "ready" ? compilation.build.routes : compilation.routes;
  const { index } = resolveSiteProjectAsset(project, catalog, { snapshot, routes, providerId });
  // Saved Content, every Composition (including defaults), and all materialized
  // routes are scanned above. An unassigned page has no source to materialize.
  // This exception is only for durable authoring snapshots, never release/trash.
  const causes = compilation.status === "blocked" ? compilation.diagnostics : [];
  const incomplete = authoringSnapshot ? causes.filter(diagnostic => !unassignedPageHasNoMaterialization(project, diagnostic)) : causes;
  if (compilation.status === "blocked" && (!causes.length || incomplete.length)) {
    index.complete = false;
    for (const diagnostic of incomplete) index.advisory.push({ location: { domain: "materialization", providerId: project.activeSitemap.providerId, recordId: project.activeSitemap.recordId, valuePath: [], pathname: diagnostic.pathname }, reason: `Route materialization is incomplete: ${diagnostic.message}` });
  }
  return { index, causes };
}
export async function inspectSiteProjectAsset(project: SiteProject, catalog: ComponentCatalog, snapshot?: AssetSnapshot, providerId?: string) {
  return (await inspectSiteProjectAssetWithCauses(project, catalog, snapshot, providerId)).index;
}
export async function captureSiteProjectAssetLock(project: SiteProject, catalog: ComponentCatalog, store: VersionedAssetStore | undefined, suppliedSnapshot?: AssetSnapshot) {
  return captureAssetLock(project, catalog, store, suppliedSnapshot, false);
}
/** Internal durable-capture entry point. Does not certify release readiness. */
export async function captureAuthoringProjectAssetLock(project: SiteProject, catalog: ComponentCatalog, store: VersionedAssetStore | undefined, suppliedSnapshot?: AssetSnapshot) {
  return captureAssetLock(project, catalog, store, suppliedSnapshot, true);
}
async function captureAssetLock(project: SiteProject, catalog: ComponentCatalog, store: VersionedAssetStore | undefined, suppliedSnapshot: AssetSnapshot | undefined, authoringSnapshot: boolean) {
  try {
  const snapshot = suppliedSnapshot ?? await store?.snapshot();
  const { index, causes } = await inspectSiteProjectAssetWithCauses(project, catalog, snapshot, store?.provider.id, authoringSnapshot);
  if (!index.complete) return { status: "blocked" as const, index, causes, diagnostics: [{ code: "unrecognized" as const, message: "Assets impact inspection is incomplete; exact release capture is blocked." }] };
  if (!index.references.length && !store) return { status: "ready" as const, index, lock: undefined };
  const result = await createAssetReferenceLock(store, index.references.map(({ ref }) => ref), snapshot);
  return { ...result, index, causes };
  } catch (error) {
    return { status: "blocked" as const, index: { complete: false, references: [], advisory: [] }, causes: [] as readonly SiteCompilerDiagnostic[], diagnostics: [{ code: "unavailable" as const, message: error instanceof Error ? error.message : "Assets impact capture failed." }] };
  }
}
