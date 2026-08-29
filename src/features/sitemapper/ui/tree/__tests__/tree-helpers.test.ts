import { describe, expect, it } from "vitest";
import { fixtureDocument } from "./fixtures";
import {
  ancestorChainIds,
  buildDocumentIndex,
  countDescendants,
  siblingBounds,
  visibleNodeIds,
} from "../tree-helpers";

describe("Sitemapper tree helpers", () => {
  it("counts every descendant, not only direct children", () => {
    const document = fixtureDocument();
    expect(countDescendants(document.root[0]!)).toBe(3);
    expect(countDescendants(document.root[0]!.children[0]!)).toBe(1);
  });

  it("reports first/last sibling boundaries and the root boundary", () => {
    const document = fixtureDocument();
    const index = buildDocumentIndex(document);
    expect(siblingBounds(document, index, "home")).toEqual({ canMoveUp: false, canMoveDown: false });
    expect(siblingBounds(document, index, "about")).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(siblingBounds(document, index, "contact")).toEqual({ canMoveUp: true, canMoveDown: false });
    expect(siblingBounds(document, index, "missing")).toEqual({ canMoveUp: false, canMoveDown: false });
  });

  it("returns a nearest-first ancestor chain and visible pre-order ids", () => {
    const document = fixtureDocument();
    expect(ancestorChainIds(document, null)).toEqual([]);
    expect(ancestorChainIds(document, "team")).toEqual(["team", "about", "home"]);
    expect(visibleNodeIds(document, new Set())).toEqual(["home"]);
    expect(visibleNodeIds(document, new Set(["home", "about"]))).toEqual([
      "home", "about", "team", "contact",
    ]);
  });
});
