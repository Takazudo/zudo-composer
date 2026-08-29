import { describe, expect, it } from "vitest";
import {
  ancestorChainIds,
  buildCatalogById,
  buildDocumentIndex,
  buildManifestIndex,
  countDescendants,
  siblingBounds,
  summarizeNode,
} from "../tree-helpers";
import { fixtureCatalog, fixtureNode, fixturePackManifest, makeAbcDocument, resetFixtureIds, FIXTURE_IDS } from "./fixtures";

describe("tree-helpers", () => {
  it("buildCatalogById indexes the richer catalog by componentId", () => {
    const catalogById = buildCatalogById(fixtureCatalog);
    expect(catalogById.get(FIXTURE_IDS.split)?.title).toBe("Split Layout");
    expect(catalogById.get("does-not-exist")).toBeUndefined();
  });

  it("summarizeNode reports the catalog title for a known component", () => {
    resetFixtureIds();
    const manifest = buildManifestIndex(fixturePackManifest);
    const catalogById = buildCatalogById(fixtureCatalog);
    const node = fixtureNode(FIXTURE_IDS.box, { label: "A" });
    const summary = summarizeNode(node, manifest, catalogById);
    expect(summary).toEqual({ title: "Box", subtitle: "A", opaque: false, reasonText: null });
  });

  it("summarizeNode falls back to the raw componentId and reports opaque diagnostics for an unknown component", () => {
    resetFixtureIds();
    const manifest = buildManifestIndex(fixturePackManifest);
    const catalogById = buildCatalogById(fixtureCatalog);
    const node = fixtureNode("unknown.widget");
    const summary = summarizeNode(node, manifest, catalogById);
    expect(summary.title).toBe("unknown.widget");
    expect(summary.opaque).toBe(true);
    expect(summary.reasonText).toMatch(/unknown component/i);
  });

  it("countDescendants counts every nested node, not just direct children", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    expect(countDescendants(document.root[0]!)).toBe(3); // A, B, C
    expect(countDescendants(document.root[0]!.slots.left![0]!)).toBe(0);
  });

  it("siblingBounds reports boundary correctly for first/middle/last siblings", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const index = buildDocumentIndex(document, manifest);

    expect(siblingBounds(document, index, "B")).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(siblingBounds(document, index, "C")).toEqual({ canMoveUp: true, canMoveDown: false });
    expect(siblingBounds(document, index, "split")).toEqual({ canMoveUp: false, canMoveDown: false });
  });

  it("siblingBounds is false/false for an id that does not exist", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    const index = buildDocumentIndex(document, manifest);
    expect(siblingBounds(document, index, "missing")).toEqual({ canMoveUp: false, canMoveDown: false });
  });

  it("ancestorChainIds returns [] for the virtual root and the nearest-first chain for a nested node", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const manifest = buildManifestIndex(fixturePackManifest);
    expect(ancestorChainIds(document, manifest, null)).toEqual([]);
    expect(ancestorChainIds(document, manifest, "B")).toEqual(["B", "split"]);
    expect(ancestorChainIds(document, manifest, "split")).toEqual(["split"]);
  });
});
