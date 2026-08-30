// Shared current-contract fixtures for inspector and export UI tests.

import type { ComponentManifest, FieldDefinition, PublicSourceDefinition } from "@zudo-composer/component-contract";
import type {
  CompositionDocument,
  CompositionNode,
  JsonObject,
} from "../../../../composer/browser";
import {
  COMPOSITION_SCHEMA_VERSION,
  createComponentCatalog,
} from "../../../../composer/browser";
import { createFixturePackManifest } from "../../../../composer/__tests__/fixtures";

function src(module: string, exportName: string): PublicSourceDefinition {
  return { module, exportName, exportKind: "named" };
}

export const TEST_COMPONENT_IDS = {
  panel: "test.panel",
  widget: "test.widget",
  label: "test.label",
} as const;

export const testManifestEntries: ComponentManifest[] = [
  {
    id: TEST_COMPONENT_IDS.panel,
    schemaVersion: 1,
    title: "Panel",
    category: "Layout",
    description: "Two-slot test panel.",
    source: src("@fixtures/panel", "Panel"),
    defaults: {},
    fields: [],
    slots: [
      { id: "left", prop: "left", label: "Left", cardinality: "single" },
      { id: "right", prop: "right", label: "Right", cardinality: "many" },
    ],
  },
  {
    // Every scalar editor kind the inspector must render, on one component.
    id: TEST_COMPONENT_IDS.widget,
    schemaVersion: 1,
    title: "Widget",
    category: "Content",
    description: "All field kinds for inspector tests.",
    source: src("@fixtures/widget", "Widget"),
    defaults: {
      title: "Untitled",
      note: "Line one",
      enabled: true,
      count: 3,
      variant: "solid",
      tint: "#336699",
    },
    fields: [
      { schema: { type: "string" }, editor: { kind: "text" }, prop: "title", label: "Title" } as FieldDefinition,
      {
        schema: { type: "string" },
        editor: { kind: "text", multiline: true },
        prop: "note",
        label: "Note",
        inlineEdit: true,
      } as FieldDefinition,
      { schema: { type: "boolean" }, editor: { kind: "boolean" }, prop: "enabled", label: "Enabled" } as FieldDefinition,
      { schema: { type: "number", min: 0, max: 10, step: 1 }, editor: { kind: "number" }, prop: "count", label: "Count" } as FieldDefinition,
      {
        schema: { type: "string", enum: ["solid", "ghost"] },
        editor: { kind: "select" },
        prop: "variant",
        label: "Variant",
      } as FieldDefinition,
      { schema: { type: "string" }, editor: { kind: "color" }, prop: "tint", label: "Tint" } as FieldDefinition,
    ],
    slots: [],
  },
  {
    id: TEST_COMPONENT_IDS.label,
    schemaVersion: 1,
    title: "Label",
    category: "Content",
    description: "Simple label fixture.",
    source: src("@fixtures/label", "Label"),
    defaults: { text: "Hello" },
    fields: [{ schema: { type: "string" }, editor: { kind: "text" }, prop: "text", label: "Text" } as FieldDefinition],
    slots: [],
  },
];

export const testPackManifest = createFixturePackManifest(testManifestEntries);
export const testManifest = createComponentCatalog(testPackManifest);

let counter = 0;
/** Reset the fixture node-id counter so a test gets deterministic ids. */
export function resetTestIds(): void {
  counter = 0;
}

export function makeNode(
  componentId: string,
  props: JsonObject = {},
  slots: Record<string, CompositionNode[]> = {},
  id?: string,
): CompositionNode {
  counter += 1;
  return {
    id: id ?? `${componentId}-${counter}`,
    componentId,
    componentVersion: 1,
    props,
    slots,
  };
}

export function makeDocument(root: CompositionNode[], name = "Test document"): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "test-doc", name, root };
}
