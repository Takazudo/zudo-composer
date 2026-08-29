import type { ContentEntrySnapshot, ContentModelRecord } from "../../content";
import type { MappingCatalog, MappingCatalogEntry, MappingRecord } from "../../mapping";
import type { MappingRef, SitemapDocument } from "../model";

export type SitemapRouteDiagnosticCode =
  | "mapping-not-found" | "mapping-invalid" | "mapping-provider-failure"
  | "content-model-not-found" | "content-model-invalid" | "content-provider-failure"
  | "wrong-route-mode" | "route-field-missing" | "route-field-not-slug"
  | "entry-slug-missing" | "entry-slug-invalid" | "incompatible-mapping"
  | "route-fragment-invalid" | "route-collision" | "unsupported-external-base";

export interface SitemapRouteDiagnostic {
  code: SitemapRouteDiagnosticCode;
  message: string;
  nodeId: string;
  entryId?: string;
  path?: string;
}

export interface DerivedSitemapRoute {
  pathname: string;
  nodeId: string;
  sourceKind: "unassigned" | "composition" | "mapping";
  entryId?: string;
}

export interface SitemapRouteExpansion {
  routes: readonly DerivedSitemapRoute[];
  derivedRouteCount: number;
  samplePath?: string;
  diagnostics: readonly SitemapRouteDiagnostic[];
  nodes: ReadonlyMap<string, SitemapNodeRouteInfo>;
}

export interface SitemapNodeRouteInfo {
  derivedRouteCount: number;
  samplePath?: string;
  status: "ready" | "blocked";
  diagnostics: readonly SitemapRouteDiagnostic[];
}

export type MappingDefinitionReadiness =
  | { status: "ready" }
  | { status: "blocked"; diagnostics: readonly { code: string; message: string }[] };

export type MappingDefinitionReadinessResolver = (mapping: MappingRecord) => Promise<MappingDefinitionReadiness>;

export interface MappingRouteCatalog {
  list(): ReturnType<MappingCatalog["list"]>;
  resolveMapping(ref: MappingRef): Promise<
    | { status: "resolved"; record: MappingRecord }
    | { status: "not-found" }
    | { status: "invalid"; reason: string }
    | { status: "provider-error"; reason: string }
  >;
  resolveDefinitionReadiness(mapping: MappingRecord): Promise<MappingDefinitionReadiness>;
  resolveContentSnapshot(mapping: MappingRecord): Promise<
    | { status: "resolved"; model: ContentModelRecord; snapshot: ContentEntrySnapshot }
    | { status: "not-found" }
    | { status: "invalid"; reason: string }
    | { status: "provider-error"; reason: string }
  >;
}

export interface MappingAssignmentCatalog {
  list(): Promise<{ entries: readonly MappingCatalogEntry[]; failures: readonly { providerId: string; providerLabel: string; reason: string }[] }>;
  routes: MappingRouteCatalog;
}

export interface ExpandSitemapRoutesOptions {
  document: SitemapDocument;
  catalog: Pick<MappingRouteCatalog, "resolveMapping" | "resolveDefinitionReadiness" | "resolveContentSnapshot">;
}
