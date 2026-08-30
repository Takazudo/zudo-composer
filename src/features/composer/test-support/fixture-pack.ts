import { h, type ComponentChildren, type FunctionComponent } from "preact";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { createComposerComponentProvider } from "../component-provider";
import { COMPOSITION_SCHEMA_VERSION, type CompositionDocument } from "../headless-api";

type Props = Record<string, unknown> & { children?: ComponentChildren };
const component = (tag: "section" | "div" | "p" | "button", className: string): FunctionComponent<Props> =>
  function Fixture({ children, ...props }) { return h(tag, { ...props, class: className }, children); };

const Section = component("section", "composer-fixture-section");
const Stack = component("div", "composer-fixture-stack");
const Text = component("p", "composer-fixture-text");
const Button = component("button", "composer-fixture-button");
const Prose = component("div", "composer-fixture-prose");
const Split: FunctionComponent<Props> = ({ left, right }) => h(
  "div",
  { class: "composer-fixture-split" },
  h("div", { class: "composer-fixture-split-column" }, left as ComponentChildren),
  h("div", { class: "composer-fixture-split-column" }, right as ComponentChildren),
);

/** Comprehensive synthetic contract surface for focused UI tests only. */
export const fixtureComponentPack = defineComponentPack({
  packId: "@zudo-composer/fixture-ui",
  packVersion: "1.0.0",
  components: [
    {
      id: "fixture.section", schemaVersion: 1, title: "Section", category: "Layout",
      description: "A titled page section.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Section" },
      defaults: { title: "New section", tone: "neutral", bordered: true, spacing: 24, accent: "#6750a4" },
      fields: [
        { schema: { type: "string" }, editor: { kind: "text", multiline: false, mode: "plain" }, prop: "title", label: "Title", inlineEdit: true },
        { schema: { type: "string", enum: ["neutral", "accent"] }, editor: { kind: "select" }, prop: "tone", label: "Tone" },
        { schema: { type: "boolean" }, editor: { kind: "boolean" }, prop: "bordered", label: "Bordered" },
        { schema: { type: "number", min: 0, max: 64, step: 4 }, editor: { kind: "number" }, prop: "spacing", label: "Spacing" },
        { schema: { type: "string" }, editor: { kind: "color" }, prop: "accent", label: "Accent" },
      ],
      slots: [{ id: "content", prop: "children", label: "Content", accepts: ["fixture.stack", "fixture.split", "fixture.text", "fixture.prose", "fixture.button"], cardinality: "many" }],
      component: Section,
      adapters: { inlineEditor: { field: "title", resolveElement: (root: unknown) => root as Element | null } },
    },
    {
      id: "fixture.stack", schemaVersion: 1, title: "Stack", category: "Layout",
      description: "A vertical content stack.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Stack" },
      defaults: {}, fields: [],
      slots: [{ id: "children", prop: "children", label: "Children", accepts: ["fixture.stack", "fixture.split", "fixture.text", "fixture.prose", "fixture.button"], cardinality: "many" }],
      component: Stack,
    },
    {
      id: "fixture.split", schemaVersion: 1, title: "Split", category: "Layout",
      description: "Two parallel content regions.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Split" },
      defaults: {}, fields: [],
      slots: [
        { id: "left", prop: "left", label: "Left", accepts: ["fixture.text", "fixture.prose", "fixture.button"], cardinality: "single" },
        { id: "right", prop: "right", label: "Right", accepts: ["fixture.text", "fixture.prose", "fixture.button"], cardinality: "many" },
      ],
      component: Split,
    },
    {
      id: "fixture.text", schemaVersion: 1, title: "Text", category: "Content",
      description: "Inline editable text.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Text" },
      defaults: { children: "Write something" },
      fields: [{ schema: { type: "string" }, editor: { kind: "text", multiline: true, mode: "plain" }, prop: "children", label: "Text", inlineEdit: true }],
      slots: [], component: Text,
      adapters: { inlineEditor: { field: "children", resolveElement: (root: unknown) => root as Element | null } },
    },
    {
      id: "fixture.prose", schemaVersion: 1, title: "Prose", category: "Content",
      description: "Explicit-save markdown source.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Prose" },
      defaults: { children: "## Markdown" },
      fields: [{ schema: { type: "string" }, editor: { kind: "text", multiline: true, mode: "markdown-source" }, prop: "children", label: "Markdown", inlineEdit: true }],
      slots: [], component: Prose,
      adapters: { inlineEditor: { field: "children", resolveElement: (root: unknown) => root as Element | null } },
    },
    {
      id: "fixture.button", schemaVersion: 1, title: "Button", category: "Actions",
      description: "A simple call to action.",
      source: { module: "@zudo-composer/fixture-ui", exportKind: "named", exportName: "Button" },
      defaults: { children: "Continue" },
      fields: [{ schema: { type: "string" }, editor: { kind: "text", multiline: false, mode: "plain" }, prop: "children", label: "Label", inlineEdit: true }],
      slots: [], component: Button,
      adapters: {
        render: (props: Record<string, unknown>) => h(Button, props),
        inlineEditor: { field: "children", resolveElement: (root: unknown) => root as Element | null },
      },
    },
  ],
});

export const fixtureComponentProvider = createComposerComponentProvider(fixtureComponentPack);
export const fixtureComponentManifest = fixtureComponentProvider.manifest;

export function createFixtureSampleDocument(): CompositionDocument {
  return {
    schemaVersion: COMPOSITION_SCHEMA_VERSION,
    id: "sample",
    name: "Product overview",
    root: [{
      id: "sample-section", componentId: "fixture.section", componentVersion: 1,
      props: { title: "Product overview" },
      slots: { content: [
        { id: "sample-text", componentId: "fixture.text", componentVersion: 1, props: { children: "Compose this page visually." }, slots: {} },
        { id: "sample-button", componentId: "fixture.button", componentVersion: 1, props: { children: "Get started" }, slots: {} },
      ] },
    }],
  };
}
