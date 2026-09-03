import { describe, expect, it } from "vitest";
import { countDescendants } from "../tree-helpers";
import { fixtureDocument } from "./fixtures";

describe("Sitemapper tree helpers", () => {
  it("counts every descendant, not only direct children", () => {
    const document = fixtureDocument();
    expect(countDescendants(document.root[0]!)).toBe(3);
    expect(countDescendants(document.root[0]!.children[0]!)).toBe(1);
    expect(countDescendants(document.root[0]!.children[1]!)).toBe(0);
  });
});
