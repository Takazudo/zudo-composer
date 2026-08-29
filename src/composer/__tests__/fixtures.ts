import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  type ComponentManifest,
  type ComponentPackManifest,
  type FieldDefinition,
  type PublicSourceDefinition,
  type SlotDefinition,
} from "@zudo-composer/component-contract";
import type { CompositionDocument, CompositionNode, JsonObject } from "../model/types";
import { COMPOSITION_SCHEMA_VERSION, createComponentCatalog } from "../model/types";

export const COMPONENT_IDS = {
  splitLayout: "fixture.split-layout",
  stack: "fixture.stack",
  sectionHeading: "fixture.section-heading",
  prose: "fixture.prose",
  ctaButton: "fixture.cta-button",
  box: "fixture.box",
  widgetA: "fixture.widget-a",
  widgetB: "fixture.widget-b",
  gallery: "fixture.gallery",
} as const;

export const SLOT_IDS = {
  splitLeft: "left",
  splitRight: "right",
  stackChildren: "content",
} as const;

export const FIXTURE_COMPONENT_IDS = {
  box: COMPONENT_IDS.box,
  widgetA: COMPONENT_IDS.widgetA,
  widgetB: COMPONENT_IDS.widgetB,
  gallery: COMPONENT_IDS.gallery,
} as const;

const C = COMPONENT_IDS;
const S = SLOT_IDS;

function src(
  module: string,
  exportName: string,
  exportKind: "named" | "default" = "named",
): PublicSourceDefinition {
  return { module, exportName, exportKind };
}

function definition(
  id: string,
  source: PublicSourceDefinition,
  options: {
    defaults?: ComponentManifest["defaults"];
    fields?: readonly FieldDefinition[];
    slots?: readonly SlotDefinition[];
  } = {},
): ComponentManifest {
  return {
    id,
    schemaVersion: 1,
    title: id,
    category: "Fixture",
    description: `Fixture definition for ${id}.`,
    source,
    defaults: options.defaults ?? {},
    fields: options.fields ?? [],
    slots: options.slots ?? [],
  };
}

const fields = {
  gapSelect: { kind: "select", prop: "gap", label: "Gap", options: ["sm", "md", "lg"] } as FieldDefinition,
  ratioSelect: {
    kind: "select",
    prop: "ratio",
    label: "Ratio",
    options: ["50-50", "33-67", "67-33"],
  } as FieldDefinition,
  sizeSelect: { kind: "select", prop: "size", label: "Size", options: ["sm", "md", "lg"] } as FieldDefinition,
};

export const fixtureEntries: readonly ComponentManifest[] = [
  definition(C.splitLayout, src("@fixtures/split-layout", "SplitLayout"), {
    defaults: { ratio: "50-50", gap: "md" },
    fields: [fields.ratioSelect, fields.gapSelect],
    slots: [
      { id: S.splitLeft, prop: "left", label: "Left", cardinality: "single" },
      { id: S.splitRight, prop: "right", label: "Right", cardinality: "many" },
    ],
  }),
  definition(C.stack, src("@fixtures/stack", "Stack"), {
    defaults: { gap: "md" },
    fields: [fields.gapSelect],
    slots: [{ id: S.stackChildren, prop: "children", label: "Children", cardinality: "many" }],
  }),
  definition(C.sectionHeading, src("@fixtures/section-heading", "SectionHeading"), {
    defaults: { heading: "Heading", as: "h2" },
    fields: [
      { kind: "text", prop: "eyebrow", label: "Eyebrow" },
      { kind: "text", prop: "heading", label: "Heading" },
      { kind: "select", prop: "as", label: "As", options: ["h2", "h3"] },
    ],
  }),
  definition(C.prose, src("@fixtures/prose", "Prose"), {
    defaults: { size: "md", children: "Body text." },
    fields: [{ kind: "text", prop: "children", label: "Text" }, fields.sizeSelect],
  }),
  definition(C.ctaButton, src("@fixtures/cta-button", "CtaButton"), {
    defaults: { href: "#", variant: "solid", arrow: false, children: "Go" },
    fields: [
      { kind: "text", prop: "children", label: "Label" },
      { kind: "text", prop: "href", label: "Href" },
      { kind: "select", prop: "variant", label: "Variant", options: ["solid", "ghost"] },
      { kind: "boolean", prop: "arrow", label: "Arrow" },
    ],
  }),
  definition(C.box, src("@fixtures/box", "Box", "default"), {
    defaults: { label: "Box" },
    fields: [
      { kind: "text", prop: "label", label: "Label" },
      { kind: "number", prop: "size", label: "Size", min: 0, max: 10 },
    ],
  }),
  definition(C.widgetA, src("@fixtures/widget-a", "Widget")),
  definition(C.widgetB, src("@fixtures/widget-b", "Widget")),
  definition(C.gallery, src("@fixtures/gallery", "Gallery"), {
    slots: [
      {
        id: "items",
        prop: "children",
        label: "Items",
        cardinality: "many",
        accepts: [C.box],
      },
    ],
  }),
];

export const fixturePackManifest: ComponentPackManifest = {
  kind: COMPONENT_PACK_KIND,
  contractVersion: CONTRACT_VERSION,
  packId: "@fixture/composer-components",
  packVersion: "1.0.0",
  components: fixtureEntries,
};

export function createFixturePackManifest(
  components: readonly ComponentManifest[],
): ComponentPackManifest {
  return {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: "@fixture/test-components",
    packVersion: "1.0.0",
    components,
  };
}

export const fixtureManifest = createComponentCatalog(fixturePackManifest);

let nodeCounter = 0;
export function resetFixtureIds(): void {
  nodeCounter = 0;
}

export function node(
  componentId: string,
  props: JsonObject = {},
  slots: Record<string, CompositionNode[]> = {},
  id?: string,
): CompositionNode {
  nodeCounter += 1;
  return {
    id: id ?? `${componentId.replace(/[^a-z0-9]+/gi, "-")}-${nodeCounter}`,
    componentId,
    componentVersion: 1,
    props,
    slots,
  };
}

export function doc(root: CompositionNode[], name = "Fixture"): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "fixture", name, root };
}

export function createFixtureDocument(): CompositionDocument {
  const document = doc(
    [
      node(
        C.splitLayout,
        { ratio: "50-50", gap: "md" },
        {
          [S.splitLeft]: [
            node(C.sectionHeading, { heading: "Fixture heading", as: "h2" }, {}, "heading-1"),
          ],
          [S.splitRight]: [
            node(
              C.stack,
              { gap: "md" },
              {
                [S.stackChildren]: [
                  node(C.prose, { children: "First", size: "md" }, {}, "prose-1"),
                  node(C.prose, { children: "Second", size: "md" }, {}, "prose-2"),
                ],
              },
              "stack-1",
            ),
            node(C.ctaButton, { href: "#", children: "Go" }, {}, "cta-1"),
          ],
        },
        "split-1",
      ),
    ],
    "Product overview",
  );
  document.id = "sample";
  return document;
}

export function makeAbcDocument(): CompositionDocument {
  return doc([
    node(
      C.splitLayout,
      { ratio: "50-50", gap: "md" },
      {
        [S.splitLeft]: [node(C.box, { label: "A" }, {}, "A")],
        [S.splitRight]: [
          node(C.box, { label: "B" }, {}, "B"),
          node(C.box, { label: "C" }, {}, "C"),
        ],
      },
      "split",
    ),
  ]);
}
