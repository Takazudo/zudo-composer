import { describe, expect, it } from "vitest";
import type { ComponentManifest } from "@zudo-composer/component-contract";
import type { CompositionDocument, RootPolicy } from "../../../../../composer/browser";
import type { OutlineNode, OutlineStatus } from "../../../../../components/outline-tree";
import { buildComposerOutline } from "../outline-model";
import { buildCatalogById, buildManifestIndex } from "../tree-helpers";
import {
  FIXTURE_IDS,
  fixtureCatalog,
  fixtureDocument,
  fixtureNode,
  fixturePackManifest,
  makeAbcDocument,
  resetFixtureIds,
} from "./fixtures";

// A fourth restricted slot, declared with more than three accepted kinds, so
// the hint's "first three, then an ellipsis" rule has something to truncate.
const GALLERY4_ID = "test.gallery4";
const gallery4Definition: ComponentManifest = {
  id: GALLERY4_ID,
  schemaVersion: 1,
  title: "Gallery4",
  category: "Layout",
  description: "A slot restricted to four kinds, for the hint-truncation case.",
  source: { module: "@fixtures/gallery4", exportKind: "named", exportName: "Gallery4" },
  defaults: {},
  fields: [],
  slots: [
    {
      id: "items",
      prop: "children",
      label: "Items",
      cardinality: "many",
      min: 1,
      accepts: [FIXTURE_IDS.box, FIXTURE_IDS.text, FIXTURE_IDS.button, FIXTURE_IDS.stack],
    },
  ],
};

const catalog = [...fixtureCatalog, gallery4Definition];
const manifest = buildManifestIndex({ ...fixturePackManifest, components: [...fixturePackManifest.components, gallery4Definition] });
const catalogById = buildCatalogById(catalog);

function build(document: CompositionDocument, rootPolicy?: RootPolicy) {
  return buildComposerOutline({ document, manifest, catalogById, catalog, rootPolicy });
}

/** Depth-first lookup by outline id — the document row plus every slot/component row under it. */
function findNode(nodes: readonly OutlineNode[], id: string): OutlineNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function warnStatus(label: string): OutlineStatus {
  return { tone: "warn", label };
}

describe("buildComposerOutline — slot rule display", () => {
  it("tags a restricted slot with its kind count, a truncated hint and the full list + origin as the tooltip", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(GALLERY4_ID, {}, { items: [fixtureNode(FIXTURE_IDS.box)] }, "gallery4")]);
    const outline = build(document);
    const slot = findNode(outline.nodes, "composer:slot:gallery4:items");
    expect(slot?.tag).toBe("4 kinds");
    expect(slot?.tagVariant).toBe("rule");
    expect(slot?.hint).toBe("Box · Text · Button…");
    expect(slot?.tagDetail).toBe("Box, Text, Button, Stack — rule from Gallery4 › Items");
  });

  it("leaves an open slot untagged and without a hint", () => {
    resetFixtureIds();
    const outline = build(makeAbcDocument());
    const slot = findNode(outline.nodes, "composer:slot:split:right");
    expect(slot?.tag).toBeUndefined();
    expect(slot?.tagVariant).toBeUndefined();
    expect(slot?.hint).toBeUndefined();
  });

  it("tags the document row when a resolved root policy restricts it, and leaves an unbound document untagged", () => {
    resetFixtureIds();
    const resolvedPolicy: RootPolicy = {
      kind: "resolved",
      accepts: [FIXTURE_IDS.gallery, FIXTURE_IDS.box],
      cardinality: "many",
      min: 1,
      origin: {
        componentId: FIXTURE_IDS.stack,
        componentTitle: "Stack",
        slotId: "content",
        slotLabel: "Content",
        viaTemplate: { sourceName: "Site shell", outletLabel: "Main content" },
      },
    };
    const bound = { ...fixtureDocument([fixtureNode(FIXTURE_IDS.box)]), binding: { sourceRecordId: "source-template", outletId: "main" } };
    const restricted = build(bound, resolvedPolicy);
    const doc = restricted.nodes[0]!;
    expect(doc.tag).toBe("2 kinds");
    expect(doc.tagVariant).toBe("rule");
    expect(doc.hint).toBe("Gallery · Box");
    expect(doc.tagDetail).toBe('Gallery, Box — rule from Stack › Content via "Site shell"');

    const open = build(makeAbcDocument());
    expect(open.nodes[0]!.tag).toBeUndefined();
  });

  it("flags an under-min slot and the under-min document root with a warn status naming the minimum", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(GALLERY4_ID, {}, { items: [] }, "gallery4")]);
    const outline = build(document);
    const slot = findNode(outline.nodes, "composer:slot:gallery4:items");
    expect(slot?.status).toEqual(warnStatus("needs at least 1"));

    const resolvedPolicy: RootPolicy = { kind: "resolved", cardinality: "many", min: 2 };
    const bound = { ...fixtureDocument([fixtureNode(FIXTURE_IDS.box)]), binding: { sourceRecordId: "source-template", outletId: "main" } };
    const restricted = build(bound, resolvedPolicy);
    expect(restricted.nodes[0]!.status).toEqual(warnStatus("needs at least 2"));
  });
});

describe("buildComposerOutline — violation and unknown-component rows", () => {
  it("tags a component holding a child its own slot rejects as 'Not accepted here' with the violation reason as its status", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(FIXTURE_IDS.gallery, {}, { items: [fixtureNode(FIXTURE_IDS.text, {}, {}, "text-in-gallery")] }, "gallery"),
    ]);
    const outline = build(document);
    const row = findNode(outline.nodes, "gallery");
    expect(row?.tag).toBe("Not accepted here");
    expect(row?.status?.tone).toBe("warn");
    expect(row?.status?.label).toMatch(/does not accept "test\.text"/);
  });

  it("tags a component violating its own slot's cardinality the same way", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(
        FIXTURE_IDS.split,
        {},
        { left: [fixtureNode(FIXTURE_IDS.box, {}, {}, "A"), fixtureNode(FIXTURE_IDS.box, {}, {}, "B")], right: [] },
        "split",
      ),
    ]);
    const outline = build(document);
    const row = findNode(outline.nodes, "split");
    expect(row?.tag).toBe("Not accepted here");
    expect(row?.status?.label).toMatch(/is single but holds 2 children/);
  });

  it("keeps the generic 'Unavailable' tag, with no status, for an unknown component", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode("unknown.widget", {}, {}, "mystery")]);
    const outline = build(document);
    const row = findNode(outline.nodes, "mystery");
    expect(row?.tag).toBe("Unavailable");
    expect(row?.status).toBeUndefined();
  });
});
