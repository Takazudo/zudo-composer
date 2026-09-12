// This small demo is also copied into an installed host outside the repository.
// Every tool import must resolve through a published bare specifier.
import { defineSite, entryRef, node, type validateSiteProject } from "zudo-composer/authoring";
import type { StaticSiteCompilation } from "zudo-composer/site-build";
import type {
  Attachment,
  BindingInput,
  CollectionModeInput,
  Entry,
  EntryInput,
  FieldInput,
  Mapping,
  MappingInput,
  Model,
  ModelInput,
  NavigationRef,
  NodeInput,
  Page,
  PageInput,
  RouteInput,
  RouteSource,
  Site,
  SiteOptions,
  SitemapInput,
  Template,
  TemplateInput,
  CompositionNode,
  CompositionRecord,
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelRecord,
  ContentValueSchema,
  GlobalTemplateOutlet,
  JsonObject,
  MappingBinding,
  MappingCollectionQuery,
  MappingRecord,
  MappingSourceProjection,
  MappingTransform,
  ReleasePlan,
  SiteProject,
  SiteProjectActiveSelection,
  SiteProjectApiRequest,
  SiteProjectApiResponse,
  SiteProjectCollectionAttachment,
  SiteProjectDiagnostic,
  SiteProjectListEntry,
  SitemapNavigationItem,
  SitemapNode,
  SitemapRecord,
} from "zudo-composer/site-project";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// Consumers can name every DSL record and pass the aggregate between the
// independently generated authoring, site-build and site-project entries.
export type RecordRelationships = [
  Assert<Equal<SiteProject["providers"]["compositions"][number]["records"][number], CompositionRecord>>,
  Assert<Equal<CompositionRecord["document"]["root"][number], CompositionNode>>,
  Assert<Equal<CompositionNode["props"], JsonObject>>,
  Assert<Equal<Extract<CompositionRecord["document"]["publication"], { kind: "global-template" }>["outlet"], GlobalTemplateOutlet>>,
  Assert<Equal<SiteProject["providers"]["content"][number]["models"][number], ContentModelRecord>>,
  Assert<Equal<SiteProject["providers"]["content"][number]["entries"][number], ContentEntryRecord>>,
  Assert<Equal<ContentModelRecord["document"]["fields"][number], ContentFieldDefinition>>,
  Assert<Equal<Extract<ContentValueSchema, { kind: "object" }>["fields"][number], ContentFieldDefinition>>,
  Assert<Equal<SiteProject["providers"]["mappings"][number]["records"][number], MappingRecord>>,
  Assert<Equal<MappingRecord["document"]["bindings"][number], MappingBinding>>,
  Assert<Equal<Extract<MappingRecord["document"]["mode"], { kind: "collection" }>["query"], MappingCollectionQuery>>,
  Assert<Equal<MappingBinding["projection"], MappingSourceProjection>>,
  Assert<Equal<MappingBinding["transform"], MappingTransform>>,
  Assert<Equal<SiteProject["providers"]["sitemaps"][number]["records"][number], SitemapRecord>>,
  Assert<Equal<SitemapRecord["document"]["root"][number], SitemapNode>>,
  Assert<Equal<SitemapRecord["document"]["navigation"]["primary"][number], SitemapNavigationItem>>,
  Assert<Equal<SiteProject["collectionAttachments"][number], SiteProjectCollectionAttachment>>,
  Assert<Equal<ReturnType<typeof validateSiteProject>["diagnostics"][number], SiteProjectDiagnostic>>,
  Assert<Equal<Extract<ReturnType<typeof validateSiteProject>, { ok: true }>["project"], SiteProject>>,
  Assert<Equal<StaticSiteCompilation["project"], SiteProject>>,
  Assert<Equal<ReleasePlan["candidate"], SiteProject>>,
  Assert<Equal<ReleasePlan["expectedActive"], SiteProjectActiveSelection | null>>,
  Assert<Equal<Extract<SiteProjectApiRequest, { operation: "apply" }>["plan"], ReleasePlan>>,
];

const timestamp = "2026-09-12T00:00:00.000Z";
const home: CompositionRecord = {
  id: "home", createdAt: timestamp, updatedAt: timestamp,
  document: {
    schemaVersion: 2, id: "home", name: "Home",
    root: [{ id: "title", componentId: "proof.banner", componentVersion: 1, props: { headline: "Hello" }, slots: {} }],
  },
};
const sitemap: SitemapRecord = {
  id: "main", createdAt: timestamp, updatedAt: timestamp,
  document: {
    schemaVersion: 3, id: "main", name: "Main",
    navigation: { primary: [], footer: [] },
    root: [{ id: "home-route", title: "Home", source: { kind: "composition", ref: { providerId: "files", recordId: home.id } }, children: [] }],
  },
};

const project: SiteProject = {
  schemaVersion: 2, id: "public-entry-demo", name: "Public entry demo",
  componentPack: { contractVersion: 2, packId: "public-entry-host", packVersion: "1.0.0" },
  providers: {
    compositions: [{ id: "files", records: [home] }],
    content: [{ id: "content-filesystem", models: [], entries: [] }],
    mappings: [{ id: "mapping-filesystem", records: [] }],
    sitemaps: [{ id: "sitemap-filesystem", records: [sitemap] }],
  },
  activeSitemap: { providerId: "sitemap-filesystem", recordId: sitemap.id },
  collectionAttachments: [],
};
export default project;

export function planRelease(current: SiteProjectListEntry | undefined, active: SiteProjectActiveSelection | null): SiteProjectApiRequest {
  return {
    protocolVersion: 2, operation: "plan", project, workingPrecondition: null, selection: [],
    expectedRevision: current?.head ?? null, expectedActive: active,
  };
}

export function readResponse(response: SiteProjectApiResponse): string {
  return response.ok ? JSON.stringify(response.result) : `${response.error.code}: ${response.error.message}`;
}

// @ts-expect-error Planning a release requires its concurrency preconditions.
export const missingPreconditions: SiteProjectApiRequest = { protocolVersion: 2, operation: "plan", project, selection: [] };
// @ts-expect-error Provider ids remain specific to each authored domain.
export const wrongProvider: SiteProject["activeSitemap"] = { providerId: "files", recordId: "main" };
// @ts-expect-error A project must use the current schema.
export const wrongSchema: SiteProject = { ...project, schemaVersion: 1 };
// @ts-expect-error Authored props must stay JSON-safe.
export const functionProp: JsonObject = { callback: () => undefined };
// @ts-expect-error Records cannot refer to an unspecified component schema.
export const unversionedNode: CompositionNode = { id: "title", componentId: "proof.banner", props: {}, slots: {} };
// @ts-expect-error Store construction is internal to the tool, not a host API.
import type { SiteProjectStoreAdapter } from "zudo-composer/site-project";
// @ts-expect-error Shipped implementation sources are not an exported subpath.
import type { SiteProject as PrivateProject } from "zudo-composer/src/site-project/model/types";
export type RejectedInternalImports = [SiteProjectStoreAdapter, PrivateProject];

// The DSL's named inputs and handles keep their relationship to both runtime
// functions and portable records across independently generated subpaths.
export type AuthoringRelationships = [
  Assert<Equal<Parameters<typeof defineSite>[0], SiteOptions>>,
  Assert<Equal<ReturnType<typeof defineSite>, Site>>,
  Assert<Equal<ReturnType<typeof node>, NodeInput>>,
  Assert<Equal<Parameters<typeof entryRef>[0], Entry>>,
  Assert<Equal<Parameters<Site["template"]>[0], TemplateInput>>,
  Assert<Equal<ReturnType<Site["template"]>, Template>>,
  Assert<Equal<Parameters<Site["page"]>[0], PageInput>>,
  Assert<Equal<ReturnType<Site["page"]>, Page>>,
  Assert<Equal<Parameters<Site["model"]>[0], ModelInput>>,
  Assert<Equal<ModelInput["fields"][number], FieldInput>>,
  Assert<Equal<ReturnType<Site["model"]>, Model>>,
  Assert<Equal<Parameters<Site["entry"]>[1], EntryInput>>,
  Assert<Equal<ReturnType<Site["entry"]>, Entry>>,
  Assert<Equal<Parameters<Site["mapping"]>[0], MappingInput>>,
  Assert<Equal<MappingInput["bindings"][number], BindingInput>>,
  Assert<Equal<Extract<MappingInput["mode"], { kind: "collection" }>, CollectionModeInput>>,
  Assert<Equal<ReturnType<Site["mapping"]>, Mapping>>,
  Assert<Equal<ReturnType<Site["attach"]>, Attachment>>,
  Assert<Equal<Parameters<Site["sitemap"]>[0], SitemapInput>>,
  Assert<Equal<SitemapInput["root"], RouteInput>>,
  Assert<Equal<NavigationRef["route"], RouteInput>>,
  Assert<RouteInput extends RouteSource ? true : false>,
  Assert<Equal<ReturnType<Site["toSiteProject"]>, SiteProject>>,
  Assert<Equal<Template["record"], CompositionRecord>>,
  Assert<Equal<Page["record"], CompositionRecord>>,
  Assert<Equal<Model["record"], ContentModelRecord>>,
  Assert<Equal<Entry["record"], ContentEntryRecord>>,
  Assert<Equal<Mapping["record"], MappingRecord>>,
  Assert<Equal<Attachment["record"], SiteProjectCollectionAttachment>>,
];

export function authorProject(options: SiteOptions): SiteProject {
  const site = defineSite(options);
  const home = site.page({ name: "Home", root: [node("proof.banner", { headline: "Typed authoring" })] });
  site.sitemap({ name: "Routes", root: { title: "Home", page: home } });
  return site.toSiteProject();
}

// @ts-expect-error A site must explicitly identify its component pack.
defineSite({ id: "missing-pack", name: "Invalid" });
// @ts-expect-error Node props must contain JSON values.
node("proof.banner", { headline: undefined });
// @ts-expect-error A reference requires the complete authoring entry handle.
entryRef({ id: "only-an-id" });
