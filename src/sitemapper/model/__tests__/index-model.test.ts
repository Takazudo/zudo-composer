import { describe, expect, it } from "vitest";
import { document, node } from "./fixtures";
import { findLocation, indexDocument, traversalOrder, traverse } from "../index-model";

describe("Sitemap index model", () => {
  const fixture = () => document([
    node("home", [node("products", [node("alpha"), node("beta")]), node("about")]),
  ]);

  it("traverses in canonical pre-order", () => {
    expect(traversalOrder(fixture())).toEqual(["home", "products", "alpha", "beta", "about"]);
    const visited: string[] = [];
    traverse(fixture(), (page) => visited.push(page.id));
    expect(visited).toEqual(["home", "products", "alpha", "beta", "about"]);
  });

  it("indexes parent, sibling index, and depth", () => {
    const index = indexDocument(fixture());
    expect(index.byId.get("home")).toMatchObject({ parentId: null, index: 0, depth: 0 });
    expect(index.byId.get("beta")).toMatchObject({ parentId: "products", index: 1, depth: 2 });
    expect(index.order).toEqual(["home", "products", "alpha", "beta", "about"]);
  });

  it("finds locations and returns undefined for absent ids", () => {
    expect(findLocation(fixture(), "about")?.node.title).toBe("about");
    expect(findLocation(fixture(), "missing")).toBeUndefined();
  });

  it("throws on duplicate ids", () => {
    expect(() => indexDocument(document([node("home", [node("same"), node("same")])]))).toThrow(/duplicate/i);
  });
});
