import type { CompositionDocument } from "../../composer/model/types";
import type { ComponentCatalog } from "../../composer/model/types";
import type { LinkedJsxModuleKind } from "../../composer/source/plan-linked-jsx";
import type { SiteProject, SiteProjectRecordRef } from "../model/types";

export interface CompileSiteProjectOptions {
  /** Manifest-only catalog used by Mapping, reuse, and JSX generation. */
  componentCatalog: ComponentCatalog;
}

export interface SiteCompilerDiagnostic {
  severity: "blocking";
  code: string;
  message: string;
  /** Stable identity-based path into the SiteProject aggregate. */
  path: string;
  pathname?: string;
  nodeId?: string;
  entry?: SiteProjectRecordRef;
}

export interface SiteCompiledModule {
  recordId: string;
  moduleSpecifier: string;
  kind: LinkedJsxModuleKind;
  code: string;
}

export interface SiteCompiledRouteSource {
  kind: "composition" | "mapping";
  ref: SiteProjectRecordRef;
}

export interface SiteCompiledRouteComposition {
  /** Stable provider-qualified identity of the canonical local Composition. */
  local: SiteProjectRecordRef;
  /** Deterministic route-variant identity used only for source planning. */
  routeRecordId: string;
  /** Evaluated local document. Its canonical source id is deliberately retained. */
  document: CompositionDocument;
  linkedSource?: {
    ref: SiteProjectRecordRef;
    outlet: { id: string; label: string };
    document: CompositionDocument;
  };
}

export interface SiteCompiledRoute {
  pathname: string;
  sitemapNode: { id: string; path: string };
  source: SiteCompiledRouteSource;
  selectedEntry?: SiteProjectRecordRef;
  composition: SiteCompiledRouteComposition;
  modules: readonly SiteCompiledModule[];
}

export interface SiteBuildPlan {
  projectId: string;
  activeSitemap: SiteProjectRecordRef;
  routes: readonly SiteCompiledRoute[];
  /** Route targets plus code-identical, deduplicated dependency modules. */
  modules: readonly SiteCompiledModule[];
}

export type SiteProjectCompilation =
  | { status: "ready"; build: SiteBuildPlan; diagnostics: readonly [] }
  | {
      status: "blocked";
      /** Successfully materialized attempts remain visible for complete failure reporting. */
      routes: readonly SiteCompiledRoute[];
      diagnostics: readonly SiteCompilerDiagnostic[];
    };

/** Compile accepts the validated aggregate type and performs no provider or runtime I/O. */
export type SiteProjectCompiler = (
  project: SiteProject,
  options: CompileSiteProjectOptions,
) => Promise<SiteProjectCompilation>;
