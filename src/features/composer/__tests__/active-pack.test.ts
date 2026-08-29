import { describe, expect, it } from "vitest";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import {
  activeComponentPack,
  activeComponentProvider,
  createComposerComponentProvider,
} from "../active-pack";

describe("active Composer component provider", () => {
  it("covers every field domain and the slot constraint variants", () => {
    const section = activeComponentProvider.catalog.get("fixture.section")!;
    expect(new Set(section.fields.map(({ kind }) => kind))).toEqual(new Set(["text", "select", "boolean", "number", "color"]));
    const split = activeComponentProvider.catalog.get("fixture.split")!;
    expect(split.slots.map(({ cardinality }) => cardinality)).toEqual(["single", "many"]);
    expect(split.slots.every(({ accepts }) => (accepts?.length ?? 0) > 0)).toBe(true);
    expect(activeComponentProvider.catalog.get("fixture.prose")?.fields[0]).toMatchObject({
      kind: "text", inlineEdit: { mode: "markdown-source", multiline: true },
    });
    expect(activeComponentProvider.runtimeEntries.find(({ manifest }) => manifest.id === "fixture.button")?.runtime.adapters?.render).toBeTypeOf("function");
  });

  it("fails the provider join for missing and mismatched runtime entries", () => {
    const missing = {
      manifest: activeComponentPack.manifest,
      runtime: { ...activeComponentPack.runtime, components: {} },
    } as TrustedComponentPack;
    expect(() => createComposerComponentProvider(missing)).toThrow(/missing trusted runtime entry/i);

    const components = { ...activeComponentPack.runtime.components };
    components["fixture.section"] = { ...components["fixture.section"]!, schemaVersion: 99 };
    const mismatch = { manifest: activeComponentPack.manifest, runtime: { ...activeComponentPack.runtime, components } } as TrustedComponentPack;
    expect(() => createComposerComponentProvider(mismatch)).toThrow(/does not match manifest version/i);
  });
});
