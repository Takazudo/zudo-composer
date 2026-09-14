import { describe, expect, it } from "vitest";
import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  type ComponentManifest,
  type ComponentPackManifest,
} from "@zudo-composer/component-contract";
import { createComponentCatalog } from "../../model/types";
import type { CompositionDocument } from "../../model/types";
import { buildGrammar } from "../index";
import { renderGrammarMarkdown } from "../render-markdown";

const IDS = {
  categoryBody: "demo.category-body",
  sectionHeading: "demo.section-heading",
  productGrid: "demo.product-grid",
  productCard: "demo.product-card",
  demoNote: "demo.demo-note",
  openWrapper: "demo.open-wrapper",
} as const;

function component(
  id: string,
  overrides: Partial<ComponentManifest> = {},
): ComponentManifest {
  return {
    id,
    schemaVersion: 1,
    title: overrides.title ?? id,
    category: "Fixture",
    description: overrides.description ?? `Fixture for ${id}`,
    source: { module: "@fixtures/demo", exportKind: "named", exportName: id.replace(/[^a-zA-Z0-9]/g, "_") },
    defaults: {},
    fields: [],
    slots: overrides.slots ?? [],
  };
}

const manifest = createComponentCatalog({
  kind: COMPONENT_PACK_KIND,
  contractVersion: CONTRACT_VERSION,
  packId: "@fixture/demo-pack",
  packVersion: "1.2.3",
  components: [
    component(IDS.categoryBody, {
      slots: [
        {
          id: "content",
          prop: "children",
          label: "Main content",
          cardinality: "many",
          min: 1,
          // Order is significant: grammar rule order must preserve it.
          accepts: [IDS.sectionHeading, IDS.productGrid, IDS.demoNote],
        },
      ],
    }),
    component(IDS.sectionHeading, { title: "Section heading", description: "Heading with eyebrow and lead" }),
    component(IDS.productGrid, {
      title: "Product grid",
      description: "Sortable, paged listing",
      slots: [{ id: "items", prop: "items", label: "Products", cardinality: "many", accepts: [IDS.productCard] }],
    }),
    component(IDS.productCard, { title: "Product card" }),
    component(IDS.demoNote, { title: "Demo note", description: "Short editorial note" }),
    component(IDS.openWrapper, {
      slots: [{ id: "content", prop: "children", label: "Body", cardinality: "many" }],
    }),
  ],
} satisfies ComponentPackManifest);

function categoryPageTemplate(): CompositionDocument {
  return {
    schemaVersion: 2,
    id: "category-page",
    name: "Category page",
    root: [
      { id: "body-1", componentId: IDS.categoryBody, componentVersion: 1, props: {}, slots: { content: [] } },
    ],
    publication: {
      kind: "global-template",
      outlet: { id: "main", label: "Main content", target: { parentId: "body-1", slotId: "content" } },
    },
  };
}

function openPageTemplate(): CompositionDocument {
  return {
    schemaVersion: 2,
    id: "open-page",
    name: "Open page",
    root: [
      { id: "wrapper-1", componentId: IDS.openWrapper, componentVersion: 1, props: {}, slots: { content: [] } },
    ],
    publication: {
      kind: "global-template",
      outlet: { id: "main", label: "Body", target: { parentId: "wrapper-1", slotId: "content" } },
    },
  };
}

function ordinaryPage(): CompositionDocument {
  return { schemaVersion: 2, id: "ordinary", name: "Ordinary page", root: [] };
}

function staleTemplate(): CompositionDocument {
  const stale = categoryPageTemplate();
  stale.id = "stale-page";
  stale.name = "Stale page";
  stale.publication = {
    kind: "global-template",
    outlet: { id: "main", label: "Main content", target: { parentId: "missing", slotId: "content" } },
  };
  return stale;
}

describe("buildGrammar", () => {
  it("carries the pack identity and an always-present openRoot", () => {
    const grammar = buildGrammar({ manifest, templates: [categoryPageTemplate()] });
    expect(grammar.pack).toEqual({ id: "@fixture/demo-pack", version: "1.2.3" });
    expect(grammar.openRoot).toEqual({ accepts: "any" });
  });

  it("ignores Compositions that are not published Global templates", () => {
    const grammar = buildGrammar({ manifest, templates: [categoryPageTemplate(), ordinaryPage()] });
    expect(grammar.templates).toHaveLength(1);
    expect(grammar.templates[0]!.id).toBe("category-page");
  });

  it("derives the region from the outlet's container slot, preserving accepts order", () => {
    const grammar = buildGrammar({ manifest, templates: [categoryPageTemplate()] });
    const [template] = grammar.templates;
    expect(template!.open).toBe(false);
    expect(template!.region).toEqual({
      outletLabel: "Main content",
      componentId: IDS.categoryBody,
      componentTitle: IDS.categoryBody,
      slotId: "content",
      slotLabel: "Main content",
      cardinality: "many",
      min: 1,
      accepts: [
        { id: IDS.sectionHeading, title: "Section heading", description: "Heading with eyebrow and lead", accepts: null },
        {
          id: IDS.productGrid,
          title: "Product grid",
          description: "Sortable, paged listing",
          accepts: [IDS.productCard],
        },
        { id: IDS.demoNote, title: "Demo note", description: "Short editorial note", accepts: null },
      ],
    });
  });

  it("marks a template open when its outlet slot declares no accepts", () => {
    const grammar = buildGrammar({ manifest, templates: [openPageTemplate()] });
    expect(grammar.templates[0]).toEqual({ id: "open-page", name: "Open page", region: null, open: true });
  });

  it("skips a template whose outlet target does not resolve and reports it as unavailable", () => {
    const grammar = buildGrammar({ manifest, templates: [staleTemplate(), openPageTemplate()] });
    expect(grammar.templates.map((template) => template.id)).toEqual(["open-page"]);
    expect(grammar.unavailableTemplates).toEqual([
      { id: "stale-page", name: "Stale page", reason: 'outlet target "missing" was not found.' },
    ]);
  });
});

describe("renderGrammarMarkdown", () => {
  it("renders the restricted region with bounds, nested children and the rejection line", () => {
    const grammar = buildGrammar({ manifest, templates: [categoryPageTemplate()] });
    const markdown = renderGrammarMarkdown(grammar);
    expect(markdown).toContain("# Category page (template category-page)");
    expect(markdown).toContain(`Region "Main content" = ${IDS.categoryBody} › content`);
    expect(markdown).toContain("accepts (any order, at least 1):");
    expect(markdown).toContain(`${IDS.productGrid}`);
    expect(markdown).toContain(`children: ${IDS.productCard} only`);
    expect(markdown).toContain("- everything else in the pack is rejected by the model.");
  });

  it("renders an open template without a region or rejection line", () => {
    const grammar = buildGrammar({ manifest, templates: [openPageTemplate()] });
    const markdown = renderGrammarMarkdown(grammar);
    expect(markdown).toContain("# Open page (template open-page)");
    expect(markdown).toContain("- open: this template's root accepts any component in the pack.");
    expect(markdown).not.toContain("rejected by the model");
  });

  it("adds an unavailable note for each skipped template", () => {
    const grammar = buildGrammar({ manifest, templates: [staleTemplate()] });
    expect(renderGrammarMarkdown(grammar)).toBe(
      '# Stale page (template stale-page)\n- unavailable: outlet target "missing" was not found.\n\n# Pages without a template\n- accepts: any component in the pack.',
    );
  });

  it("always closes with the openRoot note for pages bound to no template", () => {
    const grammar = buildGrammar({ manifest, templates: [] });
    expect(renderGrammarMarkdown(grammar)).toBe(
      "# Pages without a template\n- accepts: any component in the pack.",
    );
  });
});
