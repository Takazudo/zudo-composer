import { describe, expect, it } from "vitest";
import { activeComponentProvider } from "../../../features/composer/active-pack";
import { activeSiteProjectValidationContext } from "../../../app/site-project-manifest";
import { buildContentGraphIndex, getContentPublicationChanges, selectContentPublicationCandidate } from "../../../content/library";
import { compileSiteProject } from "../../compiler";
import { serializeSiteProject, validateSiteProject } from "../../model";
import type { CompositionNode } from "../../../composer/model/types";
import {
  CATALOG_EDITORIAL_CONTENT_PROVIDER,
  CATALOG_EDITORIAL_IDS,
  createCatalogEditorialSiteProject,
  loadCatalogEditorialSiteProject,
} from "../catalog-editorial";

const IDS = CATALOG_EDITORIAL_IDS;
const resource = { providerId: "media-files", assetId: "verified-example-pdf" };
const load = () => loadCatalogEditorialSiteProject(activeSiteProjectValidationContext, resource);

function visitNodes(nodes: readonly CompositionNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    result.push(node.id);
    for (const children of Object.values(node.slots)) visitNodes(children, result);
  }
  return result;
}

describe("catalog editorial SiteProject example", () => {
  it("is a detached current-schema graph with generic models, task views, ordered relations, and media-use values", () => {
    const project = load();
    expect(validateSiteProject(project, activeSiteProjectValidationContext)).toEqual({ ok: true, project, diagnostics: [] });
    expect(project).toMatchObject({ schemaVersion: 2, id: "catalog-editorial-example", name: "Fieldwork Catalog" });

    const content = project.providers.content[0]!;
    expect(content.models.map((record) => record.document.name)).toEqual(["Products", "Guides", "News", "Support resources", "Series", "Site settings"]);
    expect(content.models.every((record) => record.document.presentation?.views.some((view) => view.label === "Writing task"))).toBe(true);
    expect(content.models.find((record) => record.id === IDS.models.settings)!.document.kind).toBe("single");
    expect(content.entries.filter((entry) => entry.modelId === IDS.models.settings)).toHaveLength(1);

    const series = content.entries.find((entry) => entry.id === IDS.entries.series[0])!;
    expect(series.values[IDS.fields.seriesProducts]).toEqual([
      { providerId: CATALOG_EDITORIAL_CONTENT_PROVIDER, modelId: IDS.models.products, recordId: IDS.entries.products[0] },
      { providerId: CATALOG_EDITORIAL_CONTENT_PROVIDER, modelId: IDS.models.products, recordId: IDS.entries.products[1] },
      { providerId: CATALOG_EDITORIAL_CONTENT_PROVIDER, modelId: IDS.models.products, recordId: IDS.entries.products[2] },
    ]);
    const product = content.entries.find((entry) => entry.id === IDS.entries.products[0])!;
    expect(product.values[IDS.fields.productShopUrl]).toBe("https://shop.example.test/catalog/quiet-timer");
    expect(product.values[IDS.fields.productResource]).toMatchObject({ kind: "link", asset: resource, label: expect.stringContaining("Quiet Timer") });

    const graph = buildContentGraphIndex([{ providerId: content.id, mutationToken: 0, models: content.models, entries: content.entries }]);
    expect(graph.diagnostics.filter((item) => item.code !== "incomplete")).toEqual([]);
    expect(graph.relations.some((edge) => edge.owner.entry.recordId === IDS.entries.series[0] && edge.ordered && edge.target.recordId === IDS.entries.products[0])).toBe(true);
    expect(graph.mediaUses.length).toBeGreaterThanOrEqual(4);
    const draftEdges = graph.relations.filter((edge) => edge.owner.entry.recordId === IDS.entries.news[3]);
    expect(draftEdges.map((edge) => edge.target.recordId)).toEqual([
      IDS.entries.guides[1], IDS.entries.guides[0], IDS.entries.support[1], IDS.entries.support[2], IDS.entries.products[1],
    ]);
  });

  it("compiles repeated latest-news output, provider-qualified nested route families, and independent menus", async () => {
    const result = await compileSiteProject(load(), { componentCatalog: activeComponentProvider.catalog, policy: "authoring-preview" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(result.build.routes.map((route) => route.pathname)).toContain("/catalog/products/quiet-timer/guides/starting-with-one-interval");
    expect(result.build.routes.some((route) => route.pathname.endsWith("/stories/field-notes-from-a-quieter-launch"))).toBe(true);
    expect(result.build.routes.some((route) => route.pathname.endsWith("/stories/supply-notes-for-the-next-season"))).toBe(true);
    const nested = result.build.routes.find((route) => route.pathname === "/catalog/products/quiet-timer/guides/starting-with-one-interval")!;
    expect(nested.ancestors.map((ancestor) => ancestor.selectedEntry?.recordId)).toEqual([undefined, undefined, IDS.entries.products[0]]);

    const home = result.build.routes.find((route) => route.pathname === "/")!;
    const repeated = visitNodes(home.composition.document.root).filter((id) => id.includes("catalog-latest-news-attachment") && id.endsWith("_h_catalog-news-card"));
    expect(repeated).toEqual([
      "__zudo_collection_u_catalog-latest-news-attachment_g_news-field-notes_h_catalog-news-card",
      "__zudo_collection_u_catalog-latest-news-attachment_j_news-small-routines_h_catalog-news-card",
    ]);
    expect(result.build.navigation.primary.map((item) => item.label)).toEqual(["Home", "Catalog", "Journal", "Support"]);
    expect(result.build.navigation.footer.map((item) => item.label)).toEqual(["Series", "External shop", "Support resources"]);
    expect(result.build.navigation.primary.map((item) => item.id)).not.toEqual(result.build.navigation.footer.map((item) => item.id));
    expect(result.build.navigation.footer.find((item) => item.label === "External shop")).toMatchObject({ external: true, href: "https://shop.example.test/catalog" });
    const nodes = (items: readonly CompositionNode[]): CompositionNode[] => items.flatMap((item) => [item, ...Object.values(item.slots).flatMap(nodes)]);
    expect(nodes(home.composition.document.root).filter((node) => node.componentId === "ui.card").map((node) => node.props.title)).toEqual(["Field notes from a quieter launch", "Small routines, durable tools"]);
    const product = result.build.routes.find((route) => route.pathname === "/catalog/products/quiet-timer")!;
    expect(nodes(product.composition.document.root).find((node) => node.id === "catalog-product-shop")?.props.href).toBe("https://shop.example.test/catalog/quiet-timer");
    expect(nodes(nested.composition.document.root).find((node) => node.id === "catalog-guide-product")?.props.href).toBe("/catalog/products/quiet-timer");
  });

  it("supports selecting a draft with its dependency edges without overwriting the source fixture", () => {
    const project = load();
    const second = createCatalogEditorialSiteProject(resource);
    expect(serializeSiteProject(second)).toBe(serializeSiteProject(project));
    second.name = "Changed detached copy";
    expect(load().name).toBe("Fieldwork Catalog");

    const content = project.providers.content[0]!;
    const snapshot = { providerId: content.id, mutationToken: 0, models: content.models, entries: content.entries };
    const draft = content.entries.find((entry) => entry.id === IDS.entries.news[3])!;
    const changes = getContentPublicationChanges([snapshot], []);
    const change = changes.find((item) => item.ref.recordId === draft.id);
    expect(change).toMatchObject({ kind: "new", ref: { providerId: content.id, modelId: IDS.models.news } });
    const candidate = selectContentPublicationCandidate([snapshot], [], [{ ref: { providerId: content.id, modelId: IDS.models.news, recordId: draft.id }, action: "publish" }]);
    expect(candidate[0]!.entries).toHaveLength(1);
    expect(candidate[0]!.entries[0]).toMatchObject({ id: draft.id, lifecycle: "published", modelId: IDS.models.news });
  });
});
