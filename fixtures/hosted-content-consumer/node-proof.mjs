import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { defineSite, node } from "zudo-composer/authoring";
import { compileStaticSite } from "zudo-composer/site-build";
import { projectHostedSite } from "zudo-composer/hosted-content";
import { fixedHostDefinition } from "./renderer/src/project.ts";
import { createFixtureSeed } from "./fixture-data.mjs";

// Host-owned pack metadata describes the same protected layout/outlet and OfferPage identity.
// Node compilation consumes neutral records; these runtime functions are never used as renderers.
function ApprovedLayout() { return null; }
function OfferPage() { return null; }
export const componentPack = defineComponentPack({ packId: "host-offer", packVersion: "1.0.0", components: [
  defineComponent()(ApprovedLayout, { id: "host:ApprovedLayout", schemaVersion: 1, title: "Approved layout", category: "Host", description: "Fixed host layout",
    source: { module: "independent-host/components", exportKind: "named", exportName: "ApprovedLayout" },
    slots: [{ id: "main", prop: "children", label: "Main", cardinality: "many" }] }),
  defineComponent()(OfferPage, { id: "host:OfferPage", schemaVersion: 1, title: "Offer page", category: "Host", description: "Host content mapping",
    source: { module: "independent-host/components", exportKind: "named", exportName: "OfferPage" }, defaults: { title: "Fixed fallback" },
    fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } }] }),
] });
export const hostedSitePlan = compilation => ({ project: compilation.project, componentPack: componentPack.manifest });
export const hostedProviders = compilation => compilation.project.providers.content.map(provider => ({ providerId: provider.id, models: provider.models, entries: provider.entries }));
export const neutralRoutes = compilation => compilation.build.routes.map(route => { const { modules, ...neutral } = route; void modules; return neutral; });
export async function proveNodeCompilation() {
  const directory = await mkdtemp(join(tmpdir(), "hosted-node-proof-"));
  try {
    const site = defineSite({ id: "hosted-node-proof", name: "Host Node proof", componentPack });
    const template = site.template({ id: fixedHostDefinition.template.id, name: "Approved layout",
      root: [node("host:ApprovedLayout", {}, { main: [] }, "layout-frame")],
      outlet: { id: "main", target: { parentId: "layout-frame", slotId: "main" } } });
    const page = site.page({ id: fixedHostDefinition.composition.id, name: "Home page", template,
      root: [node("host:OfferPage", { title: "Static fallback" }, {}, "offer-page")] });
    const { mapping: hostMapping } = fixedHostDefinition;
    const fixturePage = createFixtureSeed().state.providers.find(provider => provider.providerId === hostMapping.providerId).entries.find(entry => entry.id === hostMapping.pageEntryId);
    const mappedTitle = fixturePage.values[hostMapping.fields.title];
    const pageModel = site.model({ id: hostMapping.pageModelId, name: "Page", kind: "single", fields: [{ id: hostMapping.fields.title, key: "title", kind: "text" }] });
    site.entry(pageModel, { id: hostMapping.pageEntryId, lifecycle: "published", values: { title: mappedTitle } });
    const mapping = site.mapping({ name: "Home content", model: pageModel, composition: page,
      bindings: [{ field: "title", nodeId: "offer-page", prop: "title" }] });
    site.sitemap({ name: "Host routes", root: { id: fixedHostDefinition.route.id, title: "Home", slug: "", mapping } });
    const projectPath = join(directory, "site-project.json");
    await writeFile(projectPath, JSON.stringify(site.toSiteProject()));
    const compilation = await compileStaticSite({ projectPath, pack: componentPack, assetsStoreRoot: join(directory, "no-assets") });
    const route = compilation.build.routes[0];
    assert.equal(route.pathname, fixedHostDefinition.route.pathname);
    assert.equal(route.composition.linkedSource.ref.recordId, fixedHostDefinition.template.id);
    assert.equal(route.composition.linkedSource.outlet.target.slotId, fixedHostDefinition.template.outlet);
    assert.equal(route.composition.document.root[0].componentId, fixedHostDefinition.composition.componentId);
    assert.equal(route.composition.document.root[0].props.title, mappedTitle);
    assert(route.modules.every(module => !module.code.includes("../../src/")));
    // The Worker-safe projection over the same Content yields byte-identical neutral routes.
    const projection = await projectHostedSite(hostedSitePlan(compilation), hostedProviders(compilation));
    assert.equal(projection.status, "ready");
    assert.equal(JSON.stringify(projection.routes), JSON.stringify(neutralRoutes(compilation)));
    console.log(JSON.stringify({ proof: "public-node-compilation", route: route.pathname, linkedTemplate: route.composition.linkedSource.ref.recordId,
      outlet: route.composition.linkedSource.outlet.target.slotId, mappedTitle: route.composition.document.root[0].props.title, projectionParity: "byte-identical" }));
    return compilation;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await proveNodeCompilation();
