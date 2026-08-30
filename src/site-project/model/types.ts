import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { CompositionRecord } from "../../composer/library";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model";
import type { MappingRecord } from "../../mapping/model";
import type { SitemapRecord } from "../../sitemapper/library";
import type { RecordId } from "../../shared";
import type { SiteProjectProviderId } from "./provider-registry";

export const SITE_PROJECT_SCHEMA_VERSION = 1 as const;

export interface SiteProjectComponentPackRequirement {
  contractVersion: ComponentPackManifest["contractVersion"];
  packId: string;
  packVersion: string;
}

export interface SiteProjectRecordRef<TProviderId extends string = string> {
  providerId: TProviderId;
  recordId: RecordId;
}

export interface SiteProjectCompositionProvider {
  id: SiteProjectProviderId<"compositions">;
  records: CompositionRecord[];
}

export interface SiteProjectContentProvider {
  id: SiteProjectProviderId<"content">;
  models: ContentModelRecord[];
  entries: ContentEntryRecord[];
}

export interface SiteProjectMappingProvider {
  id: SiteProjectProviderId<"mappings">;
  records: MappingRecord[];
}

export interface SiteProjectSitemapProvider {
  id: SiteProjectProviderId<"sitemaps">;
  records: SitemapRecord[];
}

export interface SiteProjectProviders {
  compositions: SiteProjectCompositionProvider[];
  content: SiteProjectContentProvider[];
  mappings: SiteProjectMappingProvider[];
  sitemaps: SiteProjectSitemapProvider[];
}

/** The portable, JSON-safe whole-site aggregate. */
export interface SiteProject {
  schemaVersion: typeof SITE_PROJECT_SCHEMA_VERSION;
  id: RecordId;
  name: string;
  componentPack: SiteProjectComponentPackRequirement;
  providers: SiteProjectProviders;
  activeSitemap: SiteProjectRecordRef<SiteProjectProviderId<"sitemaps">>;
}

export type SiteProjectDiagnosticSeverity = "error";

export type SiteProjectDiagnosticCode =
  | "invalid-project"
  | "invalid-keys"
  | "not-json-safe"
  | "future-schema"
  | "invalid-schema-version"
  | "unsafe-id"
  | "invalid-name"
  | "invalid-component-pack"
  | "component-pack-mismatch"
  | "invalid-provider"
  | "unknown-provider"
  | "duplicate-provider"
  | "duplicate-record"
  | "malformed-record"
  | "component-pack-incompatible"
  | "dangling-composition-binding"
  | "invalid-composition-binding"
  | "invalid-active-sitemap"
  | "dangling-content-model"
  | "wrong-content-provider"
  | "dangling-entry-field"
  | "invalid-entry-value"
  | "single-content-cardinality"
  | "dangling-mapping-reference"
  | "wrong-mapping-provider"
  | "dangling-mapping-field"
  | "dangling-mapping-target"
  | "dangling-sitemap-reference"
  | "wrong-sitemap-provider"
  | "dangling-sitemap-route-field";

export interface SiteProjectDiagnostic {
  severity: SiteProjectDiagnosticSeverity;
  code: SiteProjectDiagnosticCode;
  message: string;
  /** Canonical JSONPath into the SiteProject input. */
  path: string;
}

export interface SiteProjectValidationContext {
  /** Manifest-only public component-pack data. Runtime component functions are never accepted. */
  componentPack: ComponentPackManifest;
}

export type SiteProjectValidation =
  | { ok: true; project: SiteProject; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly SiteProjectDiagnostic[] };

export type SiteProjectParseResult =
  | { ok: true; project: SiteProject; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly SiteProjectDiagnostic[] };
