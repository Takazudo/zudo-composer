import type { ProductionProviderIntegration } from "../../app/provider-integration";
import type { WorkspaceCapture } from "../../app/workspace-snapshot";
import { validateAssetSnapshot } from "../../assets/model";
import { validateSiteProject, type SiteProject } from "../../site-project";
import { compileWithCapturedAsset } from "../../site-project/assets/compile";
import type { SiteBuildPlan } from "../../site-project/compiler";
import type { SitemapDocument } from "../../sitemapper/model/types";

/** The working project compiled exactly as `/website-preview` delivers it; kept free of delivery UI so authoring screens can reuse it. */
export type WorkingPreviewState =
  | { status: "provider-error"; message: string; retryable: boolean }
  | { status: "validation-error"; message: string }
  | { status: "compiler-error"; message: string }
  | { status: "ready"; sourceKind: "working-preview"; project: SiteProject; build: SiteBuildPlan; sitemap: SitemapDocument };

export function activeSitemap(project: SiteProject): SitemapDocument | undefined {
  return project.providers.sitemaps
    .find(({ id }) => id === project.activeSitemap.providerId)?.records
    .find(({ id }) => id === project.activeSitemap.recordId)?.document;
}

export async function loadWorkingPreviewSnapshot(
  providers: ProductionProviderIntegration,
  /** Receives the aggregate capture this snapshot was compiled from, so a re-capturing
   *  caller can re-check its freshness once compilation has ended. */
  onCapture?: (capture: WorkspaceCapture) => void,
  /** Rewrites the captured project before validation, e.g. to overlay an unsaved candidate; nothing is written. */
  transform?: (project: SiteProject) => SiteProject,
): Promise<WorkingPreviewState> {
  try {
    let project: SiteProject;
    let capture: WorkspaceCapture | undefined;
    if (providers.assetProvider) {
      const snapshot = await providers.captureWorkspace();
      if (snapshot.status !== "ready") return { status: "provider-error", message: snapshot.status === "unavailable" ? snapshot.error.message : `Workspace capture ${snapshot.status}; retry after completing pending edits.`, retryable: true };
      project = snapshot.project; capture = snapshot.capture; onCapture?.(capture);
    } else {
      // Static/committed assets need no authoring provider. This is explicitly
      // detached output, not proof of cross-domain release currentness.
      const snapshot = await providers.getCurrentSiteProject({ flushSessions: true });
      if (snapshot.status === "error") return { status: "provider-error", message: snapshot.error.message, retryable: snapshot.error.retryable };
      project = snapshot.project;
    }
    const validated = validateSiteProject(transform ? transform(project) : project, { componentPack: providers.componentProvider.manifest });
    if (!validated.ok) return { status: "validation-error", message: validated.diagnostics.map(({ message }) => message).join(" ") };
    const assetSnapshot = capture?.values[`assets:${providers.assetProvider?.descriptor.id}`];
    if (capture && !validateAssetSnapshot(assetSnapshot)) return { status: "compiler-error", message: "Aggregate capture has no valid Asset snapshot." };
    const compilation = await compileWithCapturedAsset(validated.project, { catalog: providers.componentProvider.catalog, assetStore: providers.assetProvider?.store,
      ...(capture ? { snapshot: assetSnapshot as import("../../assets/model").AssetSnapshot, isCaptureCurrent: () => providers.isCaptureCurrent(capture!) } : {}),
    });
    if (compilation.status === "blocked") return { status: "compiler-error", message: compilation.diagnostics.map(({ message }) => message).join(" ") };
    const sitemap = activeSitemap(validated.project);
    return sitemap ? { status: "ready", sourceKind: "working-preview", project: validated.project, build: compilation.build, sitemap } : { status: "validation-error", message: "The active Sitemap is unavailable." };
  } catch (error) {
    return { status: "provider-error", message: error instanceof Error ? error.message : "The delivery snapshot failed.", retryable: true };
  }
}

