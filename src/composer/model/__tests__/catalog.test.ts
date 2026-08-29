import {
  COMPONENT_PACK_KIND,
  CONTRACT_VERSION,
  ContractValidationError,
  type ComponentManifest,
  type ComponentPackManifest,
} from "@zudo-composer/component-contract";
import { describe, expect, it } from "vitest";
import { createComponentCatalog } from "../types";

const component: ComponentManifest = {
  id: "fixture.box",
  schemaVersion: 1,
  title: "Box",
  category: "Fixture",
  description: "Fixture box.",
  source: { module: "fixture-components", exportKind: "named", exportName: "Box" },
  defaults: {},
  fields: [],
  slots: [],
};

function pack(components: readonly ComponentManifest[]): ComponentPackManifest {
  return {
    kind: COMPONENT_PACK_KIND,
    contractVersion: CONTRACT_VERSION,
    packId: "fixture-pack",
    packVersion: "1.0.0",
    components,
  };
}

describe("createComponentCatalog", () => {
  it("parses a contract pack before exposing its components", () => {
    const mutable = structuredClone(component);
    const source = pack([mutable]);
    const catalog = createComponentCatalog(source);
    (mutable as { title: string }).title = "Changed after indexing";
    expect(catalog.ids()).toEqual([component.id]);
    expect(catalog.pack).toMatchObject({ packId: source.packId, packVersion: source.packVersion });
    expect(catalog.get(component.id)?.title).toBe("Box");
  });

  it("rejects duplicate component ids instead of silently overwriting", () => {
    expect(() => createComponentCatalog(pack([component, { ...component }]))).toThrow(ContractValidationError);
  });
});
