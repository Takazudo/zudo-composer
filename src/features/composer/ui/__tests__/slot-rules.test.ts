import { describe, expect, it } from "vitest";
import type { ComponentManifest } from "@zudo-composer/component-contract";
import type { CompositionDocument, RootPolicy } from "../../../../composer/browser";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import { describeSlotRule } from "../slot-rules";
import { buildManifestIndex } from "../tree/tree-helpers";
import {
  FIXTURE_IDS,
  fixtureCatalog,
  fixtureDocument,
  fixtureNode,
  fixturePackManifest,
  makeAbcDocument,
  resetFixtureIds,
} from "../tree/__tests__/fixtures";

const LIST_ID = "test.list";
const listDefinition: ComponentManifest = {
  id: LIST_ID,
  schemaVersion: 1,
  title: "List",
  category: "Layout",
  description: "A bounded list of text or boxes.",
  source: { module: "@fixtures/list", exportKind: "named", exportName: "List" },
  defaults: {},
  fields: [],
  slots: [
    { id: "items", prop: "children", label: "Items", cardinality: "many", accepts: [FIXTURE_IDS.text, FIXTURE_IDS.box], min: 1, max: 2 },
  ],
};
const catalog = [...fixtureCatalog, listDefinition];
const manifest = buildManifestIndex({ ...fixturePackManifest, components: [...fixturePackManifest.components, listDefinition] });

const ROOT = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 } as const;

function bound(document: CompositionDocument): CompositionDocument {
  return { ...document, binding: { sourceRecordId: "source-template", outletId: "main" } };
}

const resolvedPolicy: RootPolicy = {
  kind: "resolved",
  accepts: [FIXTURE_IDS.gallery, FIXTURE_IDS.box],
  cardinality: "many",
  min: 1,
  max: 3,
  origin: {
    componentId: FIXTURE_IDS.stack,
    componentTitle: "Stack",
    slotId: "content",
    slotLabel: "Content",
    viaTemplate: { sourceName: "Site shell", outletLabel: "Main content" },
  },
};

describe("describeSlotRule", () => {
  it("describes an unbound document root as open with the whole catalog", () => {
    resetFixtureIds();
    const rule = describeSlotRule({ catalog, manifest, document: makeAbcDocument(), target: ROOT, rootPolicy: resolvedPolicy });
    expect(rule).toMatchObject({ kind: "open", hiddenByRule: [], cardinality: "many", count: 1, full: false, origin: null, blockedReason: null });
    expect(rule.accepts.map((c) => c.id)).toEqual(catalog.map((c) => c.id));
    expect(rule.min).toBeUndefined();
    expect(rule.max).toBeUndefined();
  });

  it("uses a resolved root policy's accepts, bounds and origin", () => {
    resetFixtureIds();
    const document = bound(fixtureDocument([fixtureNode(FIXTURE_IDS.box)]));
    const rule = describeSlotRule({ catalog, manifest, document, target: ROOT, rootPolicy: resolvedPolicy });
    expect(rule).toMatchObject({ kind: "restricted", cardinality: "many", min: 1, max: 3, count: 1, full: false, blockedReason: null });
    expect(rule.accepts).toEqual([
      { id: FIXTURE_IDS.gallery, title: "Gallery", category: "Layout", hasOwnRule: true },
      { id: FIXTURE_IDS.box, title: "Box", category: "Content", hasOwnRule: false },
    ]);
    expect(rule.hiddenByRule.map((c) => c.id)).toEqual([
      FIXTURE_IDS.split, FIXTURE_IDS.stack, FIXTURE_IDS.text, FIXTURE_IDS.button, LIST_ID,
    ]);
    expect(rule.origin).toEqual(resolvedPolicy.origin);
  });

  it("marks a bound root without a resolved policy unavailable", () => {
    resetFixtureIds();
    const rule = describeSlotRule({ catalog, manifest, document: bound(fixtureDocument([])), target: ROOT });
    expect(rule).toMatchObject({ kind: "unavailable", accepts: [], hiddenByRule: [], origin: null, full: false });
    expect(rule.blockedReason).toMatch(/until its Global template outlet is resolved/);
  });

  it("reports a full resolved root at max with the model's guard text", () => {
    resetFixtureIds();
    const document = bound(fixtureDocument([fixtureNode(FIXTURE_IDS.box), fixtureNode(FIXTURE_IDS.box), fixtureNode(FIXTURE_IDS.box)]));
    const rule = describeSlotRule({ catalog, manifest, document, target: ROOT, rootPolicy: resolvedPolicy });
    expect(rule).toMatchObject({ kind: "restricted", count: 3, full: true });
    expect(rule.blockedReason).toBe("The bound Global template outlet holds at most 3 root components");
  });

  it("describes a nested restricted slot with its parent as origin", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(LIST_ID, {}, { items: [fixtureNode(FIXTURE_IDS.text)] }, "list")]);
    const rule = describeSlotRule({ catalog, manifest, document, target: { parentId: "list", slotId: "items", index: 1 } });
    expect(rule).toMatchObject({ kind: "restricted", cardinality: "many", min: 1, max: 2, count: 1, full: false, blockedReason: null });
    // Declared rule order, not catalog order.
    expect(rule.accepts.map((c) => c.id)).toEqual([FIXTURE_IDS.text, FIXTURE_IDS.box]);
    expect(rule.hiddenByRule.map((c) => c.id)).toEqual([
      FIXTURE_IDS.split, FIXTURE_IDS.stack, FIXTURE_IDS.gallery, FIXTURE_IDS.button, LIST_ID,
    ]);
    expect(rule.origin).toEqual({ componentId: LIST_ID, componentTitle: "List", slotId: "items", slotLabel: "Items" });
  });

  it("describes a nested open slot", () => {
    resetFixtureIds();
    const rule = describeSlotRule({ catalog, manifest, document: makeAbcDocument(), target: { parentId: "split", slotId: "right", index: 2 } });
    expect(rule).toMatchObject({ kind: "open", cardinality: "many", count: 2, full: false, hiddenByRule: [], blockedReason: null });
    expect(rule.accepts).toHaveLength(catalog.length);
    expect(rule.origin?.slotLabel).toBe("Right");
  });

  it("marks an occupied single slot full", () => {
    resetFixtureIds();
    const rule = describeSlotRule({ catalog, manifest, document: makeAbcDocument(), target: { parentId: "split", slotId: "left", index: 1 } });
    expect(rule).toMatchObject({ kind: "open", cardinality: "single", count: 1, full: true });
    expect(rule.blockedReason).toMatch(/already has a component/);
  });

  it("marks a slot at max full", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(LIST_ID, {}, { items: [fixtureNode(FIXTURE_IDS.text), fixtureNode(FIXTURE_IDS.box)] }, "list"),
    ]);
    const rule = describeSlotRule({ catalog, manifest, document, target: { parentId: "list", slotId: "items", index: 2 } });
    expect(rule).toMatchObject({ kind: "restricted", count: 2, max: 2, full: true });
    expect(rule.blockedReason).toBe("This slot is full: it holds at most 2 components.");
  });

  it("marks an opaque parent unavailable", () => {
    const document = fixtureDocument([
      { id: "split", componentId: FIXTURE_IDS.split, componentVersion: 99, props: {}, slots: { left: [], right: [] } },
    ]);
    const rule = describeSlotRule({ catalog, manifest, document, target: { parentId: "split", slotId: "right", index: 0 } });
    expect(rule).toMatchObject({ kind: "unavailable", accepts: [], hiddenByRule: [], cardinality: "many", full: false });
    expect(rule.origin?.componentId).toBe(FIXTURE_IDS.split);
    expect(rule.blockedReason).toMatch(/unavailable/);
  });

  it("marks a missing parent unavailable", () => {
    const rule = describeSlotRule({ catalog, manifest, document: fixtureDocument([]), target: { parentId: "gone", slotId: "x", index: 0 } });
    expect(rule).toMatchObject({ kind: "unavailable", origin: null });
    expect(rule.blockedReason).toMatch(/no longer exists/);
  });

  it("flags accepted components that declare their own slot rules", () => {
    resetFixtureIds();
    const rule = describeSlotRule({ catalog, manifest, document: makeAbcDocument(), target: ROOT });
    const ownRules = rule.accepts.filter((c) => c.hasOwnRule).map((c) => c.id);
    expect(ownRules).toEqual([FIXTURE_IDS.gallery, LIST_ID]);
  });
});
