import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TrustedComponentPack } from "@zudo-composer/component-contract";
import * as publicUi from "@zudo-sg/ui";
import {
  activeComponentPack,
  activeComponentProvider,
  activeComponentRuntime,
  createComposerComponentProvider,
} from "../active-pack";
import { fixtureComponentPack } from "../test-support/fixture-pack";

const EXPECTED_IDS = [
  "ui.callout", "ui.card", "ui.prose-md", "ui.prose-p",
  "ui.placeholder-box", "ui.auto-grid", "ui.container", "ui.cta-button",
  "ui.hero", "ui.section-heading", "ui.split-layout", "ui.stack",
] as const;
const EXPECTED_BINDINGS = [
  { id: "ui.callout", schemaVersion: 1, slots: [{ id: "body", prop: "children", label: "Body", cardinality: "many" }], source: { exportKind: "named", exportName: "Callout" } },
  { id: "ui.card", schemaVersion: 1, slots: [{ id: "body", prop: "children", label: "Body", cardinality: "many" }], source: { exportKind: "named", exportName: "Card" } },
  { id: "ui.prose-md", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "ProseMd" } },
  { id: "ui.prose-p", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "ProseP" } },
  { id: "ui.placeholder-box", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "PlaceholderBox" } },
  { id: "ui.auto-grid", schemaVersion: 1, slots: [{ id: "items", prop: "children", label: "Items", cardinality: "many" }], source: { exportKind: "named", exportName: "AutoGrid" } },
  { id: "ui.container", schemaVersion: 1, slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }], source: { exportKind: "named", exportName: "Container" } },
  { id: "ui.cta-button", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "CtaButton" } },
  { id: "ui.hero", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "Hero" } },
  { id: "ui.section-heading", schemaVersion: 1, slots: [], source: { exportKind: "named", exportName: "SectionHeading" } },
  { id: "ui.split-layout", schemaVersion: 1, slots: [
    { id: "left", prop: "left", label: "Left", cardinality: "single" },
    { id: "right", prop: "right", label: "Right", cardinality: "many" },
  ], source: { exportKind: "named", exportName: "SplitLayout" } },
  { id: "ui.stack", schemaVersion: 1, slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }], source: { exportKind: "named", exportName: "Stack" } },
] as const;

describe("active @zudo-sg/ui component provider", () => {
  it("uses the exact public v1 pack and twelve schema-v1 component IDs", () => {
    expect(activeComponentProvider.manifest).toMatchObject({ packId: "@zudo-sg/ui", packVersion: "1.0.0" });
    expect(activeComponentProvider.manifest.components.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(activeComponentProvider.manifest.components.every(({ schemaVersion }) => schemaVersion === 1)).toBe(true);
    expect(activeComponentProvider.runtimeEntries).toHaveLength(EXPECTED_IDS.length);
  });

  it("keeps the manifest JSON-only and every public source on @zudo-sg/ui", () => {
    const json = JSON.stringify(activeComponentProvider.manifest);
    expect(JSON.parse(json)).toEqual(activeComponentProvider.manifest);
    expect(json).not.toMatch(/fixture\.|adapter/i);
    expect(activeComponentProvider.manifest.components.every(({ source }) => source.module === "@zudo-sg/ui")).toBe(true);
    expect(activeComponentProvider.runtimeEntries.every(({ manifest, runtime }) =>
      runtime.schemaVersion === manifest.schemaVersion && typeof runtime.component === "function"
    )).toBe(true);
  });

  it("locks every manifest slot/source binding to its exact public runtime component", () => {
    const bindings = activeComponentProvider.manifest.components.map(({ id, schemaVersion, slots, source }) => ({
      id,
      schemaVersion,
      slots,
      source: { exportKind: source.exportKind, exportName: source.exportName },
    }));
    expect(bindings).toEqual(EXPECTED_BINDINGS);
    expect(Object.keys(activeComponentRuntime.components)).toEqual(EXPECTED_IDS);
    for (const entry of activeComponentProvider.runtimeEntries) {
      const exportName = entry.manifest.source.exportName;
      expect((publicUi as Record<string, unknown>)[exportName]).toBe(entry.runtime.component);
    }
  });

  it("distinguishes installed package semver from component-pack protocol version", () => {
    const packagePath = fileURLToPath(new URL("../package.json", import.meta.resolve("@zudo-sg/ui/composer-pack")));
    const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { name: string; version: string };
    expect(metadata).toEqual(expect.objectContaining({ name: "@zudo-sg/ui", version: "0.1.0" }));
    expect(activeComponentPack.manifest.packVersion).toBe("1.0.0");
  });

  it("fails the provider join for missing and mismatched runtime entries", () => {
    const missing = {
      manifest: fixtureComponentPack.manifest,
      runtime: { ...fixtureComponentPack.runtime, components: {} },
    } as TrustedComponentPack;
    expect(() => createComposerComponentProvider(missing)).toThrow(/missing trusted runtime entry/i);

    const components = { ...fixtureComponentPack.runtime.components };
    components["fixture.section"] = { ...components["fixture.section"]!, schemaVersion: 99 };
    const mismatch = { manifest: fixtureComponentPack.manifest, runtime: { ...fixtureComponentPack.runtime, components } } as TrustedComponentPack;
    expect(() => createComposerComponentProvider(mismatch)).toThrow(/does not match manifest version/i);
  });
});
