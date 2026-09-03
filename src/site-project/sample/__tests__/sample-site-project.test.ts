import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createComponentCatalog, type CompositionNode } from "../../../composer/model/types";
import { activeSiteProjectValidationContext } from "../../../app/site-project-manifest";
import { compileSiteProject } from "../../compiler";
import { serializeSiteProject, validateSiteProject } from "../../model";
import { loadSampleSiteProject } from "../index";

const EXPECTED_COMPONENT_IDS = [
  "ui.callout",
  "ui.card",
  "ui.prose-md",
  "ui.prose-p",
  "ui.placeholder-box",
  "ui.auto-grid",
  "ui.container",
  "ui.cta-button",
  "ui.hero",
  "ui.section-heading",
  "ui.split-layout",
  "ui.stack",
] as const;

function visitNodes(nodes: readonly CompositionNode[], visit: (node: CompositionNode) => void): void {
  for (const node of nodes) {
    visit(node);
    for (const children of Object.values(node.slots)) visitNodes(children, visit);
  }
}

function findNode(nodes: readonly CompositionNode[], id: string): CompositionNode {
  let match: CompositionNode | undefined;
  visitNodes(nodes, (node) => {
    if (node.id === id) match = node;
  });
  if (!match) throw new Error(`Missing sample node ${id}.`);
  return match;
}

const project = loadSampleSiteProject(activeSiteProjectValidationContext);
const catalog = createComponentCatalog(activeSiteProjectValidationContext.componentPack);

describe("sample SiteProject", () => {
  it("is a deterministic provider-scoped aggregate with an exact record inventory", () => {
    expect(project).toMatchObject({
      schemaVersion: 1,
      id: "sample-studio-site",
      name: "Sample Studio",
      componentPack: { contractVersion: 2, packId: "@zudo-sg/ui", packVersion: "1.0.0" },
      activeSitemap: { providerId: "sitemap-indexeddb", recordId: "sample-studio-sitemap" },
    });
    expect(validateSiteProject(project, activeSiteProjectValidationContext)).toEqual({
      ok: true,
      project,
      diagnostics: [],
    });

    const compositions = project.providers.compositions[0]!;
    const content = project.providers.content[0]!;
    const mappings = project.providers.mappings[0]!;
    const sitemaps = project.providers.sitemaps[0]!;
    expect(project.providers).toMatchObject({
      compositions: [{ id: "indexeddb" }],
      content: [{ id: "content-indexeddb" }],
      mappings: [{ id: "mapping-indexeddb" }],
      sitemaps: [{ id: "sitemap-indexeddb" }],
    });
    expect(compositions.records.map(({ id }) => id)).toEqual([
      "about-page",
      "home-page",
      "journal-entry-page",
      "journal-index-page",
      "services-page",
      "site-frame",
    ]);
    expect(content.models.map(({ id }) => id)).toEqual(["about-content", "journal-articles"]);
    expect(content.entries.map(({ id, modelId }) => [id, modelId])).toEqual([
      ["about-entry", "about-content"],
      ["article-first-question", "journal-articles"],
      ["article-moving-parts", "journal-articles"],
      ["article-small-loops", "journal-articles"],
    ]);
    expect(mappings.records.map(({ id }) => id)).toEqual(["about-page-mapping", "journal-entry-mapping"]);
    expect(sitemaps.records.map(({ id }) => id)).toEqual(["sample-studio-sitemap"]);
    expect(new Set([
      ...compositions.records.flatMap((record) => [record.createdAt, record.updatedAt]),
      ...content.models.flatMap((record) => [record.createdAt, record.updatedAt]),
      ...content.entries.flatMap((record) => [record.createdAt, record.updatedAt]),
      ...mappings.records.flatMap((record) => [record.createdAt, record.updatedAt]),
      ...sitemaps.records.flatMap((record) => [record.createdAt, record.updatedAt]),
    ])).toEqual(new Set(["2026-08-31T00:00:00.000Z"]));
  });

  it("stores byte-stable canonical JSON and returns detached loaded copies", () => {
    const path = resolve("src/site-project/sample/sample-site-project.json");
    expect(readFileSync(path, "utf8")).toBe(serializeSiteProject(project));
    const second = loadSampleSiteProject(activeSiteProjectValidationContext);
    expect(second).not.toBe(project);
    second.name = "Changed copy";
    expect(loadSampleSiteProject(activeSiteProjectValidationContext).name).toBe("Sample Studio");
  });

  it("uses the complete public component inventory and links every page consumer to one empty outlet", () => {
    const used = new Set<string>();
    for (const record of project.providers.compositions[0]!.records) {
      visitNodes(record.document.root, (node) => used.add(node.componentId));
    }
    expect([...used].sort()).toEqual([...EXPECTED_COMPONENT_IDS].sort());
    expect([...used].sort()).toEqual([...catalog.ids()].sort());

    const records = project.providers.compositions[0]!.records;
    const frame = records.find(({ id }) => id === "site-frame")!;
    expect(frame.document).toMatchObject({
      publication: {
        kind: "global-template",
        outlet: {
          id: "main-content",
          target: { parentId: "site-frame-stack", slotId: "content" },
        },
      },
    });
    expect(findNode(frame.document.root, "site-frame-stack").slots.content).toEqual([]);
    expect(records.filter(({ id }) => id !== "site-frame").every((record) =>
      record.document.binding?.sourceRecordId === "site-frame"
      && record.document.binding.outletId === "main-content"
    )).toBe(true);
  });

  it("compiles the exact sorted path, source, Entry, and Composition inventory without diagnostics", async () => {
    const result = await compileSiteProject(project, { componentCatalog: catalog });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.diagnostics).toEqual([]);
    expect(result.build.routes.map((route) => [
      route.pathname,
      route.displayTitle,
      `${route.source.kind}:${route.source.ref.providerId}:${route.source.ref.recordId}`,
      route.selectedEntry ? `${route.selectedEntry.providerId}:${route.selectedEntry.recordId}` : null,
      `${route.composition.local.providerId}:${route.composition.local.recordId}`,
    ])).toEqual([
      ["/", "Home", "composition:indexeddb:home-page", null, "indexeddb:home-page"],
      ["/about", "About", "mapping:mapping-indexeddb:about-page-mapping", "content-indexeddb:about-entry", "indexeddb:about-page"],
      ["/journal", "Journal", "composition:indexeddb:journal-index-page", null, "indexeddb:journal-index-page"],
      ["/journal/map-the-moving-parts", "Map the moving parts", "mapping:mapping-indexeddb:journal-entry-mapping", "content-indexeddb:article-moving-parts", "indexeddb:journal-entry-page"],
      ["/journal/review-in-small-loops", "Review in small loops", "mapping:mapping-indexeddb:journal-entry-mapping", "content-indexeddb:article-small-loops", "indexeddb:journal-entry-page"],
      ["/journal/start-with-the-question", "Start with the question", "mapping:mapping-indexeddb:journal-entry-mapping", "content-indexeddb:article-first-question", "indexeddb:journal-entry-page"],
      ["/services", "Services", "composition:indexeddb:services-page", null, "indexeddb:services-page"],
    ]);
    expect(result.build.routes).toHaveLength(7);
    expect(result.build.routes.every((route) => route.composition.linkedSource?.ref.recordId === "site-frame")).toBe(true);
    expect(new Set(result.build.routes.map((route) => route.pathname)).size).toBe(7);
  });

  it("has one assigned root, no unassigned page, and an omitted authored slug on the collection template", () => {
    const root = project.providers.sitemaps[0]!.records[0]!.document.root;
    expect(root).toHaveLength(1);
    const sources: string[] = [];
    const walk = (nodes: typeof root): void => {
      for (const node of nodes) {
        sources.push(node.source.kind);
        if (node.id === "journal-entry-node") {
          expect(node).not.toHaveProperty("slug");
          expect(node.source).toMatchObject({ route: { kind: "entry-field", fieldId: "article-slug-field", titleFieldId: "article-heading-field" } });
        }
        walk(node.children);
      }
    };
    walk(root);
    expect(sources).not.toContain("unassigned");
    expect(sources).toEqual(["composition", "mapping", "composition", "composition", "mapping"]);
  });

  it("maps Entry-specific values while preserving explicit static Composition props", async () => {
    const result = await compileSiteProject(project, { componentCatalog: catalog });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const about = result.build.routes.find((route) => route.pathname === "/about")!;
    expect(findNode(about.composition.document.root, "about-heading").props).toEqual({
      eyebrow: "Studio note",
      heading: "A studio built around useful clarity",
      intro: "Sample Studio helps small teams make steady progress when the shape of the work is still emerging.",
      as: "h1",
    });
    expect(findNode(about.composition.document.root, "about-body").props.markdown).toContain("Work made visible");

    const expected = {
      "article-moving-parts": ["Map the moving parts", "A lightweight map can reveal where timing, ownership, and information need attention.", "Aug 12, 2026", "Draw the relationships"],
      "article-small-loops": ["Review in small loops", "Small reviews turn abstract agreement into specific, timely feedback.", "Aug 19, 2026", "Share something concrete"],
      "article-first-question": ["Start with the question", "Before choosing a format or feature, name the question the work must answer.", "Aug 5, 2026", "Begin with purpose"],
    } as const;
    for (const route of result.build.routes.filter((candidate) => candidate.source.ref.recordId === "journal-entry-mapping")) {
      const [heading, intro, date, bodyFragment] = expected[route.selectedEntry!.recordId as keyof typeof expected];
      expect(findNode(route.composition.document.root, "journal-entry-heading").props).toEqual({
        eyebrow: "Studio journal",
        heading,
        intro,
        as: "h1",
      });
      expect(findNode(route.composition.document.root, "journal-entry-date").props.children).toBe(date);
      expect(findNode(route.composition.document.root, "journal-entry-body").props.markdown).toContain(bodyFragment);
    }
  });
});
