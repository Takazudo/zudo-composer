import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  type ComponentManifest,
} from "@zudo-composer/component-contract";
import {
  COMPOSITION_SCHEMA_VERSION,
  createComponentCatalog,
  type CompositionDocument,
  type JsonObject,
} from "../../model/types";
import { generateJsx } from "../generate-jsx";

const hero: ComponentManifest = {
  id: "ui.hero", schemaVersion: 1, title: "Hero", category: "Content", description: "Hero fixture",
  source: { module: "@fixtures/hero", exportKind: "named", exportName: "Hero" },
  defaults: { actions: [{ label: "Default", href: "/" }] },
  fields: [{
    prop: "actions", label: "Actions",
    schema: { type: "array", items: {
      schema: { type: "object", fields: [
        { key: "label", label: "Label", required: true, schema: { type: "string" }, editor: { kind: "text" } },
        { key: "href", label: "URL", required: true, schema: { type: "string" }, editor: { kind: "text" } },
        { key: "variant", label: "Variant", schema: { type: "string", enum: ["primary", "secondary"] }, editor: { kind: "select" } },
      ] },
      editor: { kind: "group" },
    } },
    editor: { kind: "list" },
  }],
  slots: [],
};

describe("Hero.actions JSX round-trip", () => {
  it("emits compiling JSX whose action expression reparses exactly", () => {
    const actions: JsonObject[] = [
      { label: "Read docs", href: "/docs", variant: "secondary" },
      { label: "Start", href: "/start" },
    ];
    const document: CompositionDocument = {
      schemaVersion: COMPOSITION_SCHEMA_VERSION,
      id: "hero-doc",
      name: "Hero",
      root: [{ id: "hero", componentId: "ui.hero", componentVersion: 1, props: { actions }, slots: {} }],
    };
    const manifest = createComponentCatalog({
      kind: COMPONENT_PACK_KIND,
      contractVersion: CONTRACT_VERSION,
      packId: "@fixtures/hero",
      packVersion: "1.0.0",
      components: [hero],
    });
    const result = generateJsx(document, manifest);
    expect(result.ok).toBe(true);
    const diagnostics = ts.transpileModule(result.code, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    }).diagnostics ?? [];
    expect(diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    const expression = result.code.match(/actions=\{(\[[^\n]+\])\}/)?.[1];
    expect(expression).toBeDefined();
    expect(JSON.parse(expression!)).toEqual(actions);
  });
});
