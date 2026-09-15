import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CompositionNode, SiteProject } from "zudo-composer/site-project";
import { componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

/** Deep-equal comparator for a template's duplicated chrome nodes, ignoring node ids. */
function stripNodeIds(list: readonly CompositionNode[]): unknown {
  return list.map((node) => ({
    componentId: node.componentId,
    componentVersion: node.componentVersion,
    props: node.props,
    slots: Object.fromEntries(Object.entries(node.slots).map(([slotId, children]) => [slotId, stripNodeIds(children)])),
  }));
}

const SHIPPED = [
  "shop.header",
  "shop.nav-link",
  "shop.cart-button",
  "shop.footer",
  "shop.breadcrumbs",
  "shop.demo-note",
  "shop.container",
  "shop.category-body",
  "shop.stack",
  "shop.grid",
  "shop.split",
  "shop.section",
  "shop.section-heading",
  "shop.product-grid",
  "shop.product-card",
  "shop.category-tile",
  "shop.status-badge",
  "shop.price-tag",
  "shop.pagination",
  "shop.hero",
  "shop.image",
  "shop.prose",
  "shop.faq-accordion",
  "shop.faq-item",
  "shop.product-hero",
  "shop.product-gallery",
  "shop.gallery-image",
  "shop.spec-table",
  "shop.add-to-cart",
  "shop.related-products",
  "shop.cart-page",
  "shop.cart-summary",
  "shop.checkout-form",
  "shop.newsletter",
  "shop.contact-form",
];

describe("demo-webshop", () => {
  it("declares the home route against its own pack", async () => {
    const project = JSON.parse(await readFile(resolve(packageRoot, "site-project.json"), "utf8")) as SiteProject;
    expect(project.componentPack).toEqual({ contractVersion: 2, packId: "demo-webshop", packVersion: "1.0.0" });
    expect(project.providers.sitemaps[0]?.records[0]?.document.root[0]?.source).toEqual({ kind: "composition", ref: { providerId: "files", recordId: "home" } });
  });

  it("registers every component from the one self-reference module", () => {
    const components = componentPack.manifest.components;
    expect(components.map((component) => component.id)).toEqual(SHIPPED);
    expect(new Set(components.map((component) => component.source.module))).toEqual(new Set(["demo-webshop/components"]));
  });

  it("gives every component a default for every field", () => {
    for (const component of componentPack.manifest.components) {
      expect(component.fields.length + component.slots.length, component.id).toBeGreaterThan(0);
      for (const field of component.fields) expect(component.defaults, `${component.id}.${field.prop}`).toHaveProperty(field.prop);
    }
  });

  it("names the item component in every list slot", () => {
    const slot = (id: string, slotId: string) =>
      componentPack.manifest.components.find((component) => component.id === id)?.slots.find((candidate) => candidate.id === slotId);
    expect(slot("shop.product-grid", "items")).toMatchObject({ cardinality: "many", accepts: ["shop.product-card"] });
    expect(slot("shop.faq-accordion", "items")).toMatchObject({ cardinality: "many", accepts: ["shop.faq-item"] });
    expect(slot("shop.header", "nav")).toMatchObject({ cardinality: "many", accepts: ["shop.nav-link"] });
    expect(slot("shop.header", "actions")).toMatchObject({ cardinality: "single", accepts: ["shop.cart-button"] });
    expect(slot("shop.footer", "nav")).toMatchObject({ cardinality: "many", accepts: ["shop.nav-link"] });
    expect(slot("shop.related-products", "items")).toMatchObject({ cardinality: "many", accepts: ["shop.product-card"] });
    expect(slot("shop.product-hero", "media")).toMatchObject({ cardinality: "single", accepts: ["shop.product-gallery"] });
    expect(slot("shop.product-gallery", "images")).toMatchObject({ cardinality: "many", accepts: ["shop.gallery-image"] });
  });

  it("binds the three category pages to the Category page template's shop.category-body outlet", async () => {
    const project = JSON.parse(await readFile(resolve(packageRoot, "site-project.json"), "utf8")) as SiteProject;
    const compositions = project.providers.compositions.flatMap((provider) => provider.records);
    const categoryTemplate = compositions.find((record) => record.document.name === "Category page");
    expect(categoryTemplate?.document.publication).toMatchObject({ kind: "global-template", outlet: { target: { parentId: "category-main", slotId: "content" } } });
    const outletId = categoryTemplate?.document.publication?.kind === "global-template" ? categoryTemplate.document.publication.outlet.id : undefined;
    const categoryMainNode = categoryTemplate?.document.root.flatMap((node) => node.slots.content ?? []).find((node) => node.id === "category-main");
    expect(categoryMainNode?.componentId).toBe("shop.category-body");
    for (const pageId of ["cat-desk", "cat-carry", "cat-light"]) {
      const page = compositions.find((record) => record.id === pageId);
      expect(page?.document.binding, pageId).toEqual({ sourceRecordId: categoryTemplate?.id, outletId });
    }
  });

  it("duplicates Site frame's header and footer on Category page without drift", async () => {
    const project = JSON.parse(await readFile(resolve(packageRoot, "site-project.json"), "utf8")) as SiteProject;
    const compositions = project.providers.compositions.flatMap((provider) => provider.records);
    const siteFrame = compositions.find((record) => record.document.name === "Site frame")!;
    const categoryTemplate = compositions.find((record) => record.document.name === "Category page")!;
    const header = (root: readonly CompositionNode[]) => root.find((node) => node.componentId === "shop.header")!;
    const footer = (root: readonly CompositionNode[]) => root.find((node) => node.componentId === "shop.footer")!;
    expect(stripNodeIds([header(categoryTemplate.document.root)])).toEqual(stripNodeIds([header(siteFrame.document.root)]));
    expect(stripNodeIds([footer(categoryTemplate.document.root)])).toEqual(stripNodeIds([footer(siteFrame.document.root)]));
  });
});
