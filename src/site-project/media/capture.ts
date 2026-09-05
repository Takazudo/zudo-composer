import type { SiteProject } from "../model";
import type { ComponentCatalog } from "../../composer/model/types";
import type { VersionedMediaStore } from "../../media/library";
import type { MediaSnapshot } from "../../media/model";
import { createMediaReferenceLock } from "../../media/references";
import { compileSiteProject } from "../compiler/compiler";
import { resolveSiteProjectMedia } from "./impact";
export async function inspectSiteProjectMedia(project: SiteProject, catalog: ComponentCatalog, snapshot?: MediaSnapshot, providerId?: string) {
  const compilation = await compileSiteProject(project, { componentCatalog: catalog, policy: "authoring-preview" });
  const routes = compilation.status === "ready" ? compilation.build.routes : compilation.routes;
  const { index } = resolveSiteProjectMedia(project, catalog, { snapshot, routes, providerId });
  if (compilation.status === "blocked") {
    index.complete = false;
    for (const diagnostic of compilation.diagnostics) index.advisory.push({ location: { domain: "materialization", providerId: project.activeSitemap.providerId, recordId: project.activeSitemap.recordId, valuePath: [], pathname: diagnostic.pathname }, reason: `Route materialization is incomplete: ${diagnostic.message}` });
  }
  return index;
}
export async function captureSiteProjectMediaLock(project: SiteProject, catalog: ComponentCatalog, store: VersionedMediaStore | undefined) {
  try {
  const snapshot = await store?.snapshot();
  const index = await inspectSiteProjectMedia(project, catalog, snapshot, store?.provider.id);
  if (!index.complete) return { status: "blocked" as const, index, diagnostics: [{ code: "unrecognized" as const, message: "Media impact inspection is incomplete; exact release capture is blocked." }] };
  if (!index.references.length && !store) return { status: "ready" as const, index, lock: undefined };
  const result = await createMediaReferenceLock(store, index.references.map(({ ref }) => ref), snapshot);
  return { ...result, index };
  } catch (error) {
    return { status: "blocked" as const, index: { complete: false, references: [], advisory: [] }, diagnostics: [{ code: "unavailable" as const, message: error instanceof Error ? error.message : "Media impact capture failed." }] };
  }
}
