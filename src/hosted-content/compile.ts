// Portable route projection: the same compiler the Node `compileStaticSite`
// façade runs, minus filesystem inputs and generated module source. A Worker
// projects a saved snapshot to neutral route documents with it; the host's own
// renderer turns those documents into HTML.

import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { AssetReferenceLock } from "../assets/references/resolver";
import { createComponentCatalog } from "../composer/model/types";
import { compileSiteProject } from "../site-project/compiler/compiler";
import type { SiteBuildPlan, SiteCompiledRoute, SiteCompilerDiagnostic } from "../site-project/compiler/types";
import { validateSiteProject } from "../site-project/model/validation";
import type { SiteProject, SiteProjectDiagnostic } from "../site-project/model/types";
import type { SitemapPublicationPolicy } from "../sitemapper/routes/types";

export type SiteProjectPlanRoute = Omit<SiteCompiledRoute, "modules">;

/** `SiteBuildPlan` without generated Preact module source. */
export interface SiteProjectPlan extends Omit<SiteBuildPlan, "modules" | "routes"> {
  routes: readonly SiteProjectPlanRoute[];
}

export interface CompileSiteProjectPlanOptions {
  /** `release` (default) requires every managed asset to be pinned by `assetLock`. */
  policy?: SitemapPublicationPolicy;
  /** The exact-version lock a release captured; the Node build captures it from the host asset store. */
  assetLock?: AssetReferenceLock;
}

export type SiteProjectPlanCompilation =
  | { status: "ready"; plan: SiteProjectPlan; project: SiteProject; diagnostics: readonly [] }
  | { status: "invalid"; diagnostics: readonly SiteProjectDiagnostic[] }
  | { status: "blocked"; diagnostics: readonly SiteCompilerDiagnostic[] };

export function stripSiteBuildModules(build: SiteBuildPlan): SiteProjectPlan {
  const { modules: _modules, routes, ...rest } = build;
  void _modules;
  return { ...rest, routes: routes.map(({ modules: _routeModules, ...route }) => { void _routeModules; return route; }) };
}

/** Validate an untrusted project value against the pack and project its routes. */
export async function compileSiteProjectPlan(
  project: unknown,
  componentPack: ComponentPackManifest,
  options: CompileSiteProjectPlanOptions = {},
): Promise<SiteProjectPlanCompilation> {
  const validated = validateSiteProject(project, { componentPack });
  if (!validated.ok) return { status: "invalid", diagnostics: validated.diagnostics };
  const compilation = await compileSiteProject(validated.project, {
    componentCatalog: createComponentCatalog(componentPack),
    policy: options.policy ?? "release",
    ...(options.assetLock ? { assetLock: options.assetLock } : {}),
  });
  if (compilation.status === "blocked") return { status: "blocked", diagnostics: compilation.diagnostics };
  return { status: "ready", plan: stripSiteBuildModules(compilation.build), project: validated.project, diagnostics: [] };
}
