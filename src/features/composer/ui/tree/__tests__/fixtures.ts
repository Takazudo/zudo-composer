// Shared current-contract fixtures for the structure rail and chooser.

import { h, type FunctionComponent } from "preact";
import { defineComponentPack, type ComponentManifest } from "@zudo-composer/component-contract";
import type { CompositionDocument, CompositionNode } from "../../../../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION, createSequentialIdFactory } from "../../../../../composer/browser";
import { createComposerComponentProvider } from "../../../component-provider";

function src(exportName: string): ComponentManifest["source"] {
  return { module: `@fixtures/${exportName.toLowerCase()}`, exportKind: "named", exportName };
}

export const FIXTURE_IDS = {
  split: "test.split",
  stack: "test.stack",
  gallery: "test.gallery",
  box: "test.box",
  text: "test.text",
  button: "test.button",
} as const;

export const fixtureCatalog: ComponentManifest[] = [
  {
    id: FIXTURE_IDS.split,
    schemaVersion: 1,
    title: "Split Layout",
    category: "Layout",
    description: "Two-column layout with named left/right slots.",
    source: src("SplitLayout"),
    defaults: { ratio: "50-50" },
    fields: [{ kind: "select", prop: "ratio", label: "Ratio", options: ["50-50", "33-67"] }],
    slots: [
      { id: "left", prop: "left", label: "Left", cardinality: "single" },
      { id: "right", prop: "right", label: "Right", cardinality: "many" },
    ],
  },
  {
    id: FIXTURE_IDS.stack,
    schemaVersion: 1,
    title: "Stack",
    category: "Layout",
    description: "Vertical stack rendering its default slot.",
    source: src("Stack"),
    defaults: { gap: "md" },
    fields: [{ kind: "select", prop: "gap", label: "Gap", options: ["sm", "md", "lg"] }],
    slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
  },
  {
    id: FIXTURE_IDS.gallery,
    schemaVersion: 1,
    title: "Gallery",
    category: "Layout",
    description: "A slot that only accepts Box components.",
    source: src("Gallery"),
    defaults: {},
    fields: [],
    slots: [
      { id: "items", prop: "children", label: "Items", cardinality: "many", accepts: [FIXTURE_IDS.box] },
    ],
  },
  {
    id: FIXTURE_IDS.box,
    schemaVersion: 1,
    title: "Box",
    category: "Content",
    description: "A generic content leaf.",
    source: src("Box"),
    defaults: { label: "Box" },
    fields: [{ kind: "text", prop: "label", label: "Label" }],
    slots: [],
  },
  {
    id: FIXTURE_IDS.text,
    schemaVersion: 1,
    title: "Text",
    category: "Content",
    description: "A scalar text leaf.",
    source: src("Text"),
    defaults: { children: "Text" },
    fields: [{ kind: "text", prop: "children", label: "Text" }],
    slots: [],
  },
  {
    id: FIXTURE_IDS.button,
    schemaVersion: 1,
    title: "Button",
    category: "Actions",
    description: "A call-to-action leaf.",
    source: src("Button"),
    defaults: { children: "Go", href: "#" },
    fields: [
      { kind: "text", prop: "children", label: "Label" },
      { kind: "text", prop: "href", label: "Href" },
    ],
    slots: [],
  },
];

const FixtureComponent: FunctionComponent<Record<string, unknown>> = (props) =>
  h("div", props);

export const fixtureComponentPack = defineComponentPack({
  packId: "@zudo-composer/test-fixtures",
  packVersion: "1.0.0",
  components: fixtureCatalog.map((entry) => ({ ...entry, component: FixtureComponent })),
});
export const fixturePackManifest = fixtureComponentPack.manifest;
export const fixtureComponentProvider = createComposerComponentProvider(fixtureComponentPack);

let counter = 0;
/** Reset the fixture node-id counter so a test gets deterministic ids. */
export function resetFixtureIds(): void {
  counter = 0;
}

export function fixtureNode(
  componentId: string,
  props: CompositionNode["props"] = {},
  slots: CompositionNode["slots"] = {},
  id?: string,
): CompositionNode {
  counter += 1;
  return {
    id: id ?? `${componentId.replace(/[^a-z0-9]+/gi, "-")}-${counter}`,
    componentId,
    componentVersion: 1,
    props,
    slots,
  };
}

export function fixtureDocument(root: CompositionNode[], name = "Fixture"): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "fixture", name, root };
}

/**
 * The canonical A/B/C right-slot walkthrough fixture: SplitLayout with A in
 * `left` and B, C in `right` — mirrors the epic's fixed reviewer walkthrough
 * (see #243) and the model's own `makeAbcDocument` shape, rebuilt here on the
 * fixture catalog above so tree/chooser tests stay self-contained.
 */
export function makeAbcDocument(): CompositionDocument {
  return fixtureDocument([
    fixtureNode(
      FIXTURE_IDS.split,
      { ratio: "50-50" },
      {
        left: [fixtureNode(FIXTURE_IDS.box, { label: "A" }, {}, "A")],
        right: [
          fixtureNode(FIXTURE_IDS.box, { label: "B" }, {}, "B"),
          fixtureNode(FIXTURE_IDS.box, { label: "C" }, {}, "C"),
        ],
      },
      "split",
    ),
  ]);
}

export const fixtureIdFactory = createSequentialIdFactory;
