import { describe, expect, it } from "vitest";
import { isSafeRecordId } from "../../../shared";
import { compileSiteProject } from "../../index";
import { breadcrumbs } from "../../../features/delivery/chrome";
import {
  componentCatalog,
  composition,
  entry,
  globalTemplate,
  linkedComposition,
  mapping,
  mappingSource,
  model,
  page,
  project,
} from "./fixtures";

const compile = (value = project()) => compileSiteProject(value, { componentCatalog });

describe("SiteProject compiler", () => {
  it("compiles nested Cartesian contexts and breadcrumbs without selecting the first repeated ancestor", async () => {
    const value = project({ root: page("parent", "parent", mappingSource("entry-field", "title"), [page("child", "child", mappingSource("entry-field", "title"), [page("details", "details", { kind: "composition", ref: { providerId: "files", recordId: "landing" } })])]), entries: [entry("a", "Alpha"), entry("b", "Beta")] });
    const result = await compile(value); expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    expect(result.build.routes).toHaveLength(10);
    expect(new Set(result.build.routes.map((route) => route.composition.routeRecordId)).size).toBe(10);
    const route = result.build.routes.find(({ pathname }) => pathname === "/parent/b/child/a/details")!;
    expect(route.ancestors[0]).toMatchObject({ pathname: "/parent/b", selectedEntry: { providerId: "content-filesystem", modelId: "articles", recordId: "b" } });
    expect(breadcrumbs(value.providers.sitemaps[0]!.records[0]!.document, result.build.routes, "details", route.pathname).map(({ title, href }) => [title, href])).toEqual([["Beta", "/site/parent/b"], ["Alpha", "/site/parent/b/child/a"], ["details", "/site/parent/b/child/a/details"]]);
    expect(result.build.activeSitemap).toEqual(value.activeSitemap);
  });
  it("compiles a selected collection entry and uses explicit preview/release draft policy", async () => {
    const mapped = mapping(); mapped.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
    const selected = entry("chosen", "Chosen"); selected.lifecycle = "draft";
    const value = project({ root: page("fixed", "fixed", { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: mapped.id }, route: { kind: "selected-entry", entry: { providerId: "content-filesystem", modelId: "articles", recordId: selected.id } } }), mappings: [mapped], entries: [selected, entry("other")] });
    const released = await compile(value); expect(released.status).toBe("blocked");
    const preview = await compileSiteProject(value, { componentCatalog, policy: "authoring-preview" });
    expect(preview.status).toBe("ready"); if (preview.status !== "ready") return;
    expect(preview.build.routes).toHaveLength(1); expect(preview.build.routes[0]).toMatchObject({ pathname: "/fixed", selectedEntry: { recordId: "chosen", providerId: "content-filesystem", modelId: "articles" } });
  });
  it("compiles independent menu destinations and blocks an ambiguous generated family", async () => {
    const value = project({ root: page("articles", "articles", mappingSource()), entries: [entry("a"), entry("b")] });
    const sitemap = value.providers.sitemaps[0]!.records[0]!.document;
    sitemap.navigation.primary = [{ id: "family", label: "Family", visible: true, destination: { kind: "route", nodeId: "articles" } }];
    expect((await compile(value)).status).toBe("blocked");
    sitemap.navigation.primary[0]!.destination = { kind: "route", nodeId: "articles", entry: { providerId: "content-filesystem", modelId: "articles", recordId: "b" } };
    sitemap.navigation.footer = [{ id: "shop", label: "External shop", visible: true, destination: { kind: "external", url: "https://example.com/shop" } }];
    const result = await compile(value); expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    expect(result.build.navigation.primary[0]?.href).toBe("/articles/b"); expect(result.build.navigation.footer[0]).toMatchObject({ href: "https://example.com/shop", external: true });
  });
  it("materializes collection route links within each concrete ancestor family", async () => {
    const owner = globalTemplate("owner"); delete owner.document.publication;
    const articles = model(); articles.document.fields.push({ id: "related", key: "related", label: "Related", required: true, kind: "reference", target: { providerId: "content-filesystem", recordId: "articles" } });
    const items = [entry("a"), entry("b")]; for (const item of items) item.values.related = { providerId: "content-filesystem", modelId: "articles", recordId: item.id };
    const itemMapping = mapping(); itemMapping.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 100 } };
    itemMapping.document.bindings[0] = { ...itemMapping.document.bindings[0]!, sourceFieldId: "related", projection: { kind: "route-link" } };
    const groups = model(); groups.id = groups.document.id = "groups";
    const groupEntries = [entry("g1"), entry("g2")]; for (const item of groupEntries) item.modelId = "groups";
    const groupMapping = mapping("owner"); groupMapping.id = groupMapping.document.id = "group-page"; groupMapping.document.contentModel.recordId = "groups"; groupMapping.document.bindings = []; groupMapping.document.mode = structuredClone(itemMapping.document.mode);
    const value = project({ root: page("groups", "groups", { kind: "mapping", ref: { providerId: "mapping-filesystem", recordId: "group-page" }, route: { kind: "entry-field", fieldId: "slug" } }, [page("items", "items", mappingSource())]), compositions: [owner, composition("landing")], contentModel: articles, entries: [...items, ...groupEntries], mappings: [groupMapping, itemMapping], attachments: [{ id: "cards", order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: itemMapping.id } }] });
    value.providers.content[0]!.models.push(groups);
    const result = await compile(value); expect(result.status).toBe("ready"); if (result.status !== "ready") return;
    for (const group of ["g1", "g2"]) {
      const route = result.build.routes.find(({ pathname }) => pathname === `/groups/${group}`)!;
      expect(route.composition.document.root[0]!.slots.body!.map((node) => node.props.title)).toEqual([`/groups/${group}/items/a`, `/groups/${group}/items/b`]);
    }
  });
  it("compiles a static Composition into a concrete synthetic route target", async () => {
    const result = await compile();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes).toHaveLength(1);
    expect(result.build.routes[0]).toMatchObject({
      pathname: "/",
      displayTitle: "home",
      source: { kind: "composition", ref: { providerId: "files", recordId: "landing" } },
      composition: { local: { providerId: "files", recordId: "landing" }, document: { id: "landing" } },
    });
    expect(result.build.routes[0]!.composition.routeRecordId).not.toBe("landing");
    expect(isSafeRecordId(result.build.routes[0]!.composition.routeRecordId)).toBe(true);
    expect(result.build.modules).toEqual([expect.objectContaining({ kind: "standalone", code: expect.stringContaining("Static") })]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("selects exactly one Entry for a single Mapping and evaluates it before generation", async () => {
    const result = await compile(project({ root: page("about", "about", mappingSource("single")), contentModel: model("single"), entries: [entry("singleton", "Mapped title")] }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes[0]).toMatchObject({ pathname: "/about", displayTitle: "about", selectedEntry: { providerId: "content-filesystem", recordId: "singleton" }, composition: { document: { root: [{ props: { title: "Mapped title" } }] } } });
    expect(result.build.modules[0]!.code).toContain("Mapped title");
  });

  it("supplies provider-qualified route context to persisted route-link projections", async () => {
    const contentModel = model();
    contentModel.document.fields.push({ id: "related", key: "related", label: "Related", required: true, kind: "reference", target: { providerId: "content-filesystem", recordId: "articles" } });
    const first = entry("a", "Alpha"); first.values.related = { providerId: "content-filesystem", modelId: "articles", recordId: "b" };
    const second = entry("b", "Beta"); second.values.related = { providerId: "content-filesystem", modelId: "articles", recordId: "a" };
    const routeMapping = mapping();
    routeMapping.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
    routeMapping.document.bindings[0] = { ...routeMapping.document.bindings[0]!, sourceFieldId: "related", projection: { kind: "route-link" } };
    const result = await compile(project({ root: page("articles", "articles", mappingSource()), contentModel, entries: [first, second], mappings: [routeMapping] }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes.map((route) => [route.pathname, route.composition.document.root[0]?.props.title])).toEqual([
      ["/articles/a", "/articles/b"], ["/articles/b", "/articles/a"],
    ]);
  });

  it("materializes a deterministic collection attachment into the delivered named slot without mutating sources", async () => {
    const owner = globalTemplate("owner");
    delete owner.document.publication;
    const itemMapping = mapping("landing");
    itemMapping.document.mode = {
      kind: "collection",
      query: {
        publication: "published-only",
        conditions: [],
        sort: [{ fieldId: "title", direction: "asc" }],
        pins: [{ providerId: "content-filesystem", modelId: "articles", recordId: "z" }],
        limit: 3,
      },
    };
    const value = project({
      root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner" } }),
      compositions: [owner, composition("landing", "Static")],
      entries: [entry("b", "Beta"), entry("z", "Zulu"), entry("a", "Alpha")],
      mappings: [itemMapping],
      attachments: [{ id: "feed", order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "article-page" } }],
    });
    const before = structuredClone(value);
    const result = await compile(value);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const children = result.build.routes[0]!.composition.document.root[0]!.slots.body!;
    expect(children.map((node) => node.props.title)).toEqual(["Zulu", "Alpha", "Beta"]);
    expect(children.map((node) => node.id)).toEqual(["__zudo_collection_4_feed_1_z_c_landing-leaf", "__zudo_collection_4_feed_1_a_c_landing-leaf", "__zudo_collection_4_feed_1_b_c_landing-leaf"]);
    expect(value).toEqual(before);
    expect(result.build.routes[0]!.modules.some((item) => item.code.includes("Zulu"))).toBe(true);
  });

  it("uses injective length-prefixed repeat identities for adversarial valid ids", async () => {
    const compileIdentity = async (attachmentId: string, entryId: string) => {
      const owner = globalTemplate("owner"); delete owner.document.publication;
      const itemMapping = mapping("landing"); itemMapping.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 1 } };
      const result = await compile(project({ root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner" } }), compositions: [owner, composition("landing")], entries: [entry(entryId)], mappings: [itemMapping], attachments: [{ id: attachmentId, order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "article-page" } }] }));
      expect(result.status).toBe("ready");
      return result.status === "ready" ? result.build.routes[0]!.composition.document.root[0]!.slots.body![0]!.id : "";
    };
    const left = await compileIdentity("a--b", "c");
    const right = await compileIdentity("a", "b--c");
    expect(left).not.toBe(right);
    expect([left, right]).toEqual(["__zudo_collection_4_a--b_1_c_c_landing-leaf", "__zudo_collection_1_a_4_b--c_c_landing-leaf"]);
  });

  it("preflights repeated identities against authored node ids", async () => {
    const owner = globalTemplate("owner"); delete owner.document.publication;
    owner.document.root[0]!.slots.body!.push({ id: "__zudo_collection_4_feed_1_a_c_landing-leaf", componentId: "leaf", componentVersion: 1, props: { title: "Authored" }, slots: {} });
    const itemMapping = mapping("landing"); itemMapping.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 1 } };
    const result = await compile(project({ root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner" } }), compositions: [owner, composition("landing")], entries: [entry("a")], mappings: [itemMapping], attachments: [{ id: "feed", order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "article-page" } }] }));
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "attachment-node-id-conflict", entry: { providerId: "content-filesystem", recordId: "a" } })] });
  });

  it("preflights the node budget before cloning the next oversized repeat", async () => {
    const owner = globalTemplate("owner"); delete owner.document.publication;
    const large = composition("landing");
    large.document.root = Array.from({ length: 5_001 }, (_, index) => ({ id: `large-${index}`, componentId: "leaf", componentVersion: 1, props: { title: String(index) }, slots: {} }));
    const itemMapping = mapping("landing");
    itemMapping.document.bindings = [];
    itemMapping.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 2 } };
    const value = project({ root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner" } }), compositions: [owner, large], entries: [entry("a"), entry("b")], mappings: [itemMapping], attachments: [{ id: "feed", order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "article-page" } }] });
    const before = structuredClone(value);
    const result = await compile(value);
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "attachment-materialization-limit", pathname: "/" })] });
    expect(value).toEqual(before);
  });

  it("enforces attachment slot cardinality", async () => {
    const owner = globalTemplate("owner");
    delete owner.document.publication;
    owner.document.root[0]!.componentId = "single-shell";
    const itemMapping = mapping("landing");
    itemMapping.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 2 } };
    const result = await compile(project({
      root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner" } }),
      compositions: [owner, composition("landing")], entries: [entry("a"), entry("b")], mappings: [itemMapping],
      attachments: [{ id: "feed", order: 0, composition: { providerId: "files", recordId: "owner" }, target: { nodeId: "owner-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "article-page" } }],
    }));
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "attachment-slot-cardinality", pathname: "/" })] });
  });

  it("rejects recursive collection attachment graphs", async () => {
    const ownerA = globalTemplate("owner-a"); delete ownerA.document.publication;
    const ownerB = globalTemplate("owner-b"); delete ownerB.document.publication;
    const mappingA = mapping("owner-a"); mappingA.id = "map-a"; mappingA.document.id = "map-a"; mappingA.document.bindings = [];
    const mappingB = mapping("owner-b"); mappingB.id = "map-b"; mappingB.document.id = "map-b"; mappingB.document.bindings = [];
    for (const record of [mappingA, mappingB]) record.document.mode = { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 1 } };
    const result = await compile(project({
      root: page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "owner-a" } }),
      compositions: [ownerA, ownerB], entries: [entry("one")], mappings: [mappingA, mappingB],
      attachments: [
        { id: "a-to-b", order: 0, composition: { providerId: "files", recordId: "owner-a" }, target: { nodeId: "owner-a-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "map-b" } },
        { id: "b-to-a", order: 1, composition: { providerId: "files", recordId: "owner-b" }, target: { nodeId: "owner-b-root", slotId: "body" }, mapping: { providerId: "mapping-filesystem", recordId: "map-a" } },
      ],
    }));
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "attachment-cycle", pathname: "/" })] });
  });

  it("expands collection Entries with encoded Unicode routes and exact Entry selection", async () => {
    const result = await compile(project({ root: page("articles", "café", mappingSource("entry-field", "title")), entries: [entry("z", "Zulu", "東京"), entry("a", "Alpha", "crème brûlée")] }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes.map((route) => [route.pathname, route.displayTitle, route.selectedEntry?.recordId, route.composition.document.root[0]?.props.title])).toEqual([
      ["/caf%C3%A9/%E6%9D%B1%E4%BA%AC", "Zulu", "z", "Zulu"],
      ["/caf%C3%A9/cr%C3%A8me%20br%C3%BBl%C3%A9e", "Alpha", "a", "Alpha"],
    ]);
  });

  it("falls back to the Sitemap node title for an Entry with no usable configured title value", async () => {
    const value = project({ root: page("articles", "articles", mappingSource("entry-field", "display")), entries: [entry("one", "One"), entry("two", "Two")] });
    value.providers.sitemaps[0]!.records[0]!.document.root[0]!.title = "Article fallback";
    value.providers.content[0]!.models[0]!.document.fields.push({ id: "display", key: "display", label: "Display title", required: false, kind: "text" });
    value.providers.content[0]!.entries[0]!.values.display = "Entry one";
    value.providers.content[0]!.entries[1]!.values.display = "   ";
    const result = await compile(value);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes.map(({ displayTitle }) => displayTitle)).toEqual(["Entry one", "Article fallback"]);
  });

  it.each([0, 2])("blocks a single Mapping with %i Entries and exposes no build", async (count) => {
    const entries = Array.from({ length: count }, (_, index) => entry(`entry-${index}`));
    const result = await compile(project({ root: page("single", "single", mappingSource("single")), contentModel: model("single"), entries }));
    expect(result).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "single-entry-count" })] });
    expect("build" in result).toBe(false);
  });

  it("blocks wrong Mapping route modes and invalid Entry slugs", async () => {
    const wrongMode = await compile(project({ root: page("articles", "articles", mappingSource()), entries: [entry("one")], mappings: [mapping()] }));
    expect(wrongMode).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "wrong-route-mode", pathname: "/articles" })] });

    const invalidSlug = await compile(project({ root: page("articles", "articles", mappingSource()), entries: [entry("bad", "Bad", "bad/path")] }));
    expect(invalidSlug).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "entry-slug-invalid", entry: { providerId: "content-filesystem", recordId: "bad" }, pathname: "/articles" })] });
  });

  it("retains colliding route attempts while blocking the top-level verdict", async () => {
    const root = page("root", undefined, { kind: "composition", ref: { providerId: "files", recordId: "landing" } }, [
      page("one", "same", { kind: "composition", ref: { providerId: "files", recordId: "landing" } }),
      page("two", "same", { kind: "composition", ref: { providerId: "files", recordId: "other" } }),
    ]);
    const result = await compile(project({ root, compositions: [composition("landing"), composition("other")] }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.routes.filter((route) => route.pathname === "/same")).toHaveLength(2);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "route-collision")).toHaveLength(2);
    expect("build" in result).toBe(false);
  });

  it("blocks unassigned and missing Composition pages without silently omitting failure", async () => {
    const root = page("root", undefined, { kind: "unassigned" }, [page("missing", "missing", { kind: "composition", ref: { providerId: "files", recordId: "gone" } })]);
    const result = await compile(project({ root }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["unassigned-page", "composition-not-found"]));
  });

  it("blocks invalid mapped values with the exact Entry context", async () => {
    const invalid = entry("bad", undefined, "bad");
    delete invalid.values.title;
    const result = await compile(project({ root: page("articles", "articles", mappingSource()), entries: [invalid] }));
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "mapping-required-value-missing", entry: { providerId: "content-filesystem", modelId: "articles", recordId: "bad" }, pathname: "/articles/bad" }));
  });

  it("materializes linked-template context but plans JSX from the evaluated local document", async () => {
    const result = await compile(project({
      root: page("linked", "linked", mappingSource("single")),
      compositions: [globalTemplate(), linkedComposition()],
      contentModel: model("single"),
      entries: [entry("one", "Mapped linked")],
      mappings: [mapping("linked")],
    }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const route = result.build.routes[0]!;
    expect(route.composition).toMatchObject({
      document: { root: [{ props: { title: "Mapped linked" } }] },
      linkedSource: {
        ref: { providerId: "files", recordId: "shell" },
        outlet: { id: "main", label: "Main", target: { parentId: "shell-root", slotId: "body" } },
        document: { id: "shell" },
      },
    });
    const publication = route.composition.linkedSource?.document.publication;
    expect(publication?.kind).toBe("global-template");
    if (publication?.kind === "global-template") {
      expect(route.composition.linkedSource?.outlet.target).not.toBe(publication.outlet.target);
      expect(route.composition.linkedSource?.outlet.target).toEqual(publication.outlet.target);
    }
    expect(route.modules.map((module) => module.kind)).toEqual(["global-template", "linked-consumer"]);
    expect(route.modules.find((module) => module.kind === "linked-consumer")?.code).toContain("Mapped linked");
  });

  it("plans every mapped linked variant separately and deduplicates an unchanged dependency", async () => {
    const linkedMapping = mapping("linked");
    linkedMapping.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
    const result = await compile(project({
      root: page("linked", "linked", mappingSource()),
      compositions: [globalTemplate(), linkedComposition()],
      entries: [entry("one", "One"), entry("two", "Two")],
      mappings: [linkedMapping],
    }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes).toHaveLength(2);
    expect(result.build.routes.map((route) => route.modules.find((module) => module.kind === "linked-consumer")?.code)).toEqual([
      expect.stringContaining("One"),
      expect.stringContaining("Two"),
    ]);
    expect(result.build.routes.every((route) => route.modules.filter((module) => module.recordId === "shell").length === 1)).toBe(true);
    expect(result.build.modules.filter((module) => module.recordId === "shell")).toHaveLength(1);
    expect(result.build.modules.filter((module) => module.kind === "linked-consumer")).toHaveLength(2);
  });

  it("reports missing outlets and binding cycles before nested-template failures", async () => {
    const missingSource = await compile(project({ root: page("linked", undefined, { kind: "composition", ref: { providerId: "files", recordId: "linked" } }), compositions: [linkedComposition("linked", "gone")] }));
    expect(missingSource).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "template-source-not-found", pathname: "/" })] });

    const missingOutlet = await compile(project({ root: page("linked", undefined, { kind: "composition", ref: { providerId: "files", recordId: "linked" } }), compositions: [globalTemplate(), linkedComposition("linked", "shell", "gone")] }));
    expect(missingOutlet).toMatchObject({ status: "blocked", diagnostics: [expect.objectContaining({ code: "template-missing-outlet" })] });

    const a = linkedComposition("a", "b");
    const b = linkedComposition("b", "a");
    const cycle = await compile(project({ root: page("cycle", undefined, { kind: "composition", ref: { providerId: "files", recordId: "a" } }), compositions: [a, b] }));
    expect(cycle.status).toBe("blocked");
    if (cycle.status !== "blocked") return;
    expect(cycle.diagnostics.map((item) => item.code)).toContain("template-binding-cycle");
    expect(cycle.diagnostics.map((item) => item.code)).not.toContain("template-nested-template");
  });

  it("emits byte-identical manifests for semantically permuted provider records", async () => {
    const value = project({ root: page("articles", "articles", mappingSource()), entries: [entry("two", "Two"), entry("one", "One")] });
    const permuted = structuredClone(value);
    permuted.providers.compositions[0]!.records.reverse();
    permuted.providers.content[0]!.models.reverse();
    permuted.providers.content[0]!.entries.reverse();
    permuted.providers.mappings[0]!.records.reverse();
    const [left, right] = await Promise.all([compile(value), compile(permuted)]);
    expect(left.status).toBe("ready");
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
  });

  it("detaches one immutable project snapshot before route expansion", async () => {
    const value = project({ root: page("articles", "articles", mappingSource()), entries: [entry("one", "Original")] });
    const pending = compile(value);
    value.providers.content[0]!.entries[0]!.values.title = "Mutated";
    value.providers.mappings[0]!.records[0]!.document.bindings.length = 0;
    const result = await pending;
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.build.routes[0]!.composition.document.root[0]!.props.title).toBe("Original");
  });
});
