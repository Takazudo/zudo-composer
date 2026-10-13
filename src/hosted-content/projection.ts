import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { AssetReferenceLock } from "../assets/references/resolver";
import { createComponentCatalog } from "../composer/model/types";
import { compileSiteProject } from "../site-project/compiler/compiler";
import type { SiteBuildPlan, SiteCompiledRoute } from "../site-project/compiler/types";
import { validateSiteProject } from "../site-project/model/validation";
import type { SiteProject } from "../site-project/model/types";
import { canonicalSerialize } from "./canonical";
import type { HostedProvider, HostedServiceOptions, JsonValue } from "./types";

/** Fixed host structure prepared at build time: templates, outlets, mappings, sitemap and attachments. */
export interface HostedSitePlan {
  project: SiteProject;
  /** Manifest-only pack data; runtime component functions never enter the projection. */
  componentPack: ComponentPackManifest;
  /** Exact-version Assets lock captured with the static build, required when Content uses managed Assets. */
  assetLock?: AssetReferenceLock;
}
/** A compiled route without generated JSX source: the neutral composition every renderer consumes. */
export type HostedProjectedRoute = Omit<SiteCompiledRoute, "modules">;
export interface HostedProjectionDiagnostic { code: string; message: string; path: string; pathname?: string }
export type HostedSiteProjection =
  | { status: "ready"; projectId: string; navigation: SiteBuildPlan["navigation"]; routes: HostedProjectedRoute[] }
  /** A type-valid incomplete draft may not compile; this is preview data, never an exception. */
  | { status: "blocked"; diagnostics: HostedProjectionDiagnostic[] };

const blocked = (diagnostics: readonly HostedProjectionDiagnostic[]): HostedSiteProjection =>
  ({ status: "blocked", diagnostics: diagnostics.map(({ code, message, path, pathname }) => ({ code, message, path, ...(pathname ? { pathname } : {}) })) });

/**
 * Worker-safe route projection over one Content snapshot, using the same pure compiler as
 * `compileStaticSite`. Release policy applies, so only published Entries participate; hosted
 * delivery candidates already mark every permitted Entry published.
 */
export async function projectHostedSite(plan: HostedSitePlan, providers: HostedProvider[]): Promise<HostedSiteProjection> {
  const project = structuredClone(plan.project);
  const diagnostics: HostedProjectionDiagnostic[] = [];
  for (const provider of providers) {
    const target = project.providers.content.find((item) => item.id === provider.providerId);
    if (!target) diagnostics.push({ code: "provider-not-planned", message: `Content provider ${provider.providerId} is not part of the site plan.`, path: "$.providers.content" });
    else if (canonicalSerialize(target.models) !== canonicalSerialize(provider.models)) diagnostics.push({ code: "definition-mismatch", message: `Content models of ${provider.providerId} differ from the site plan.`, path: "$.providers.content" });
    else target.entries = structuredClone(provider.entries);
  }
  if (diagnostics.length) return blocked(diagnostics);
  const validated = validateSiteProject(project, { componentPack: plan.componentPack });
  if (!validated.ok) return blocked(validated.diagnostics);
  const compilation = await compileSiteProject(validated.project, { componentCatalog: createComponentCatalog(plan.componentPack), policy: "release", ...(plan.assetLock ? { assetLock: plan.assetLock } : {}) });
  if (compilation.status === "blocked") return blocked(compilation.diagnostics);
  return structuredClone({ status: "ready", projectId: compilation.build.projectId, navigation: compilation.build.navigation,
    routes: compilation.build.routes.map((route) => { const { modules, ...neutral } = route; void modules; return neutral; }) });
}

/** A `project` service callback whose render data is the JSON projection of the whole site. */
export function createHostedSiteProjector(plan: HostedSitePlan): HostedServiceOptions["project"] {
  const fixed = structuredClone(plan);
  return async (providers) => JSON.parse(JSON.stringify(await projectHostedSite(fixed, providers))) as JsonValue;
}
