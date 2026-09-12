import { describe, expect, it } from "vitest";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../../../src/composer/model/types";
import { compileSiteProject } from "../../../../src/site-project/compiler";
import { canonicalStringifyJson } from "../../../../src/site-project/model/canonical";
import { validateSiteProject } from "../../../../src/site-project/model/validation";
import type { SiteProjectApiRequest } from "../../../../src/site-project/api/types";
import { defineSite, entryRef, node, slugify } from "../authoring";
import { renderSiteProject } from "../generate";
import { seedRelease } from "../seed";

interface FrameProps { children?: unknown }
interface GridProps { items?: unknown }
interface CardProps { title: string; summary?: string; href?: string }

const Frame = ({ children }: FrameProps) => children;
const Grid = ({ items }: GridProps) => items;
const Card = ({ title }: CardProps) => title;

const componentPack = defineComponentPack({
  packId: "demo-tools-test",
  packVersion: "1.0.0",
  components: [
    defineComponent<FrameProps>()(Frame, {
      id: "t.frame", schemaVersion: 1, title: "Frame", category: "Layout", description: "",
      source: { module: "demo-tools-test/components", exportKind: "named", exportName: "Frame" },
      defaults: {}, fields: [],
      slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
    }),
    defineComponent<GridProps>()(Grid, {
      id: "t.grid", schemaVersion: 1, title: "Grid", category: "Layout", description: "",
      source: { module: "demo-tools-test/components", exportKind: "named", exportName: "Grid" },
      defaults: {}, fields: [],
      slots: [{ id: "items", prop: "items", label: "Items", cardinality: "many", accepts: ["t.card"] }],
    }),
    defineComponent<CardProps>()(Card, {
      id: "t.card", schemaVersion: 1, title: "Card", category: "Content", description: "",
      source: { module: "demo-tools-test/components", exportKind: "named", exportName: "Card" },
      defaults: { title: "Card", summary: "", href: "" },
      fields: [
        { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
        { prop: "summary", label: "Summary", schema: { type: "string" }, editor: { kind: "text" } },
        { prop: "href", label: "Link", schema: { type: "string" }, editor: { kind: "text" } },
      ],
    }),
  ],
});

/** A template, a listing page with a collection attachment, and an entry route. */
function authorSite() {
  const site = defineSite({ id: "test-site", name: "Test site", componentPack });
  const frame = site.template({ name: "Site frame", root: [node("t.frame", {}, {}, "frame")], outlet: { target: { parentId: "frame", slotId: "content" } } });
  const articles = site.model({
    name: "Articles",
    kind: "collection",
    fields: [{ key: "heading", kind: "text" }, { key: "intro", kind: "long-text" }, { key: "publishedOn", kind: "date" }, { key: "slug", kind: "slug" }],
  });
  const first = site.entry(articles, { values: { heading: "First post", intro: "One.", publishedOn: "2026-09-01", slug: "first-post" } });
  site.entry(articles, { values: { heading: "Second post", intro: "Two.", publishedOn: "2026-09-02", slug: "second-post" } });

  const card = site.page({ name: "Article card", root: [node("t.card", { title: "Card" }, {}, "card")] });
  const cardMapping = site.mapping({
    name: "Article card mapping",
    model: articles,
    composition: card,
    mode: { kind: "collection", sort: [{ field: "publishedOn", direction: "desc" }] },
    bindings: [
      { field: "heading", nodeId: "card", prop: "title" },
      { field: "intro", nodeId: "card", prop: "summary", transform: { kind: "truncate-160" } },
      { field: "slug", nodeId: "card", prop: "href", transform: { kind: "prefix", prefix: "/journal/" } },
    ],
  });
  const index = site.page({ name: "Journal", template: frame, root: [node("t.grid", {}, {}, "journal-grid")] });
  const attachment = site.attach(cardMapping, { nodeId: "journal-grid", slotId: "items" });

  const entryPage = site.page({ name: "Article page", template: frame, root: [node("t.card", { title: "Article" }, {}, "article")] });
  const entryMapping = site.mapping({
    name: "Article page mapping",
    model: articles,
    composition: entryPage,
    mode: { kind: "collection" },
    bindings: [{ field: "heading", nodeId: "article", prop: "title" }],
  });
  const home = site.page({ name: "Home", template: frame, root: [node("t.card", { title: "Welcome" })] });
  const entryRoute = { title: "Article", mapping: entryMapping, route: "entry-field" as const, field: "slug" };
  const journalRoute = { title: "Journal", slug: "journal", page: index, children: [entryRoute] };
  const homeRoute = { title: "Home", page: home, children: [journalRoute] };
  site.sitemap({ name: "Test sitemap", root: homeRoute, navigation: { primary: [{ route: homeRoute }, { route: journalRoute }], footer: [{ route: homeRoute }] } });
  return { site, first, attachment, cardMapping };
}

describe("defineSite", () => {
  it("derives safe ids from names and field keys", () => {
    expect(slugify("Product card")).toBe("product-card");
    expect(slugify("Crème brûlée  #2")).toBe("creme-brulee-2");
    const { site, first } = authorSite();
    const project = site.toSiteProject();
    expect(project.providers.content[0]!.models[0]!.document.fields.map((field) => field.id)).toEqual(["articles-heading", "articles-intro", "articles-published-on", "articles-slug"]);
    expect(first.id).toBe("articles-first-post");
    expect(entryRef(first)).toEqual({ providerId: "content-filesystem", modelId: "articles", recordId: "articles-first-post" });
    expect(project.providers.compositions[0]!.records.find((record) => record.id === "home")!.document.root[0]!.id).toBe("home-t-card-1");
  });

  it("produces a SiteProject the tool's validator accepts, as canonical JSON", () => {
    const { site } = authorSite();
    const validation = validateSiteProject(site.toSiteProject(), { componentPack: componentPack.manifest });
    expect(validation.ok, JSON.stringify(validation.diagnostics)).toBe(true);
    const { text } = renderSiteProject(site);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toBe(canonicalStringifyJson(JSON.parse(text)));
    expect(Object.keys(JSON.parse(text))).toEqual(["activeSitemap", "collectionAttachments", "componentPack", "id", "name", "providers", "schemaVersion"]);
  });

  it("round-trips a collection attachment and materialises one card per entry", async () => {
    const { site, attachment, cardMapping } = authorSite();
    const project = site.toSiteProject();
    expect(project.collectionAttachments).toEqual([{
      id: attachment.id,
      order: 0,
      composition: { providerId: "files", recordId: "journal" },
      target: { nodeId: "journal-grid", slotId: "items" },
      mapping: { providerId: "mapping-filesystem", recordId: cardMapping.id },
    }]);
    const compilation = await compileSiteProject(project, { componentCatalog: createComponentCatalog(componentPack.manifest), policy: "authoring-preview" });
    expect(compilation.status, JSON.stringify(compilation.diagnostics)).toBe("ready");
    if (compilation.status !== "ready") return;
    expect(compilation.build.routes.map((route) => route.pathname).sort()).toEqual(["/", "/journal", "/journal/first-post", "/journal/second-post"]);
    const journal = compilation.build.routes.find((route) => route.pathname === "/journal")!;
    const grid = journal.composition.document.root.find((item) => item.id === "journal-grid")!;
    expect(grid.slots.items!.map((item) => item.props.title)).toEqual(["Second post", "First post"]);
    expect(grid.slots.items!.map((item) => item.props.href)).toEqual(["/journal/second-post", "/journal/first-post"]);
  });

  it("refuses duplicate ids, unknown components and unknown fields", () => {
    const site = defineSite({ id: "dup", name: "Dup", componentPack });
    site.page({ name: "Home", root: [] });
    expect(() => site.page({ name: "Home", root: [] })).toThrow('Duplicate composition id "home"');
    expect(() => site.page({ name: "Other", root: [node("t.missing")] })).toThrow('Component "t.missing" is not in pack');
    const model = site.model({ name: "Things", kind: "single", fields: [{ key: "name", kind: "text" }] });
    expect(() => site.entry(model, { id: "thing", values: { nope: "x" } })).toThrow('Model "things" has no field "nope"');
    expect(() => site.attach({} as never, { nodeId: "nowhere", slotId: "items" })).toThrow('No declared composition contains node "nowhere"');
    expect(() => site.toSiteProject()).toThrow("has no sitemap");
  });
});

describe("seedRelease", () => {
  it("drives list → plan → apply → build → activate with the store's CAS values", async () => {
    const { site } = authorSite();
    const project = site.toSiteProject();
    const requests: SiteProjectApiRequest[] = [];
    const revision = "a".repeat(64);
    const buildId = "b".repeat(64);
    const active = { projectId: project.id, revision: "c".repeat(64), buildId: "d".repeat(64) };
    const call = async (request: SiteProjectApiRequest): Promise<unknown> => {
      requests.push(request);
      switch (request.operation) {
        case "list": return { projects: [{ projectId: project.id, head: active.revision }], active };
        case "plan": return { schemaVersion: 2, planDigest: "plan" };
        case "apply": return { revision, buildId };
        default: return {};
      }
    };
    const result = await seedRelease("/nowhere", { project, call });
    expect(result).toEqual({ projectId: project.id, revision, buildId });
    expect(requests.map((request) => request.operation)).toEqual(["list", "plan", "apply", "build", "activate"]);
    const plan = requests[1] as Extract<SiteProjectApiRequest, { operation: "plan" }>;
    expect(plan.expectedRevision).toBe(active.revision);
    expect(plan.expectedActive).toEqual(active);
    expect(plan.selection).toEqual([
      { ref: { providerId: "content-filesystem", modelId: "articles", recordId: "articles-first-post" }, action: "publish" },
      { ref: { providerId: "content-filesystem", modelId: "articles", recordId: "articles-second-post" }, action: "publish" },
    ]);
    expect(requests[4]).toEqual({ protocolVersion: 2, operation: "activate", projectId: project.id, revision, buildId, expectedActive: active });
  });
});
