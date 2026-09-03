import { describe, expect, it } from "vitest";
import {
  childrenOf,
  collectExpandableIds,
  findRowIndex,
  flattenVisibleRows,
  insertTargetAfter,
  isExpandable,
  isLastInList,
  isSameTarget,
} from "../tree-model";
import type { OutlineNode } from "../types";
import { NODES, ROW_ORDER } from "./nodes";

const ALL_OPEN = new Set(["home", "products", "docs"]);

describe("flattenVisibleRows", () => {
  it("walks the tree in DOM order once everything is open", () => {
    expect(flattenVisibleRows(NODES, ALL_OPEN).map((row) => row.node.id)).toEqual(ROW_ORDER);
  });

  it("skips everything under a collapsed node", () => {
    const rows = flattenVisibleRows(NODES, new Set(["home"]));
    expect(rows.map((row) => row.node.id)).toEqual(["home", "products", "about", "docs", "settings"]);
  });

  it("gives each row its depth, parent and position among its siblings", () => {
    const rows = flattenVisibleRows(NODES, ALL_OPEN);
    expect(rows[findRowIndex(rows, "pricing")]).toMatchObject({
      depth: 2,
      parentId: "products",
      index: 1,
      siblingCount: 2,
      expandable: false,
      expanded: false,
    });
    expect(rows[findRowIndex(rows, "docs")]).toMatchObject({
      depth: 1,
      parentId: "home",
      index: 2,
      siblingCount: 3,
      expandable: true,
      expanded: true,
    });
    expect(rows[findRowIndex(rows, "settings")]).toMatchObject({ depth: 0, parentId: null, index: 1, siblingCount: 2 });
  });

  it("reports an unknown id as missing rather than as the first row", () => {
    expect(findRowIndex(flattenVisibleRows(NODES, ALL_OPEN), "nothing")).toBe(-1);
  });
});

describe("isExpandable", () => {
  it("follows the declared kind, so a leaf never expands", () => {
    const leafWithChildren: OutlineNode = {
      id: "x",
      kind: "leaf",
      title: "X",
      children: [{ id: "y", kind: "leaf", title: "Y" }],
    };
    expect(isExpandable(leafWithChildren)).toBe(false);
    expect(childrenOf(leafWithChildren)).toHaveLength(1);
  });

  it("is false for a branch with no children yet", () => {
    expect(isExpandable({ id: "x", kind: "group", title: "X" })).toBe(false);
  });
});

describe("collectExpandableIds", () => {
  it("lists every branch depth-first, which is the order Open all restores", () => {
    expect(collectExpandableIds(NODES)).toEqual(["home", "products", "docs"]);
  });
});

describe("isLastInList", () => {
  it("closes the branch on the final node when no add row follows it", () => {
    expect(isLastInList(0, 2, false)).toBe(false);
    expect(isLastInList(1, 2, false)).toBe(true);
  });

  it("hands the class to the add row instead, so only one element carries it", () => {
    expect(isLastInList(1, 2, true)).toBe(false);
  });
});

describe("insert targets", () => {
  it("puts the a / + shorthand directly below the row it was pressed on", () => {
    const rows = flattenVisibleRows(NODES, ALL_OPEN);
    expect(insertTargetAfter(rows[findRowIndex(rows, "overview")])).toEqual({ parentId: "products", index: 1 });
    expect(insertTargetAfter(rows[findRowIndex(rows, "home")])).toEqual({ parentId: null, index: 1 });
  });

  it("compares by parent and index, and treats null as its own value", () => {
    expect(isSameTarget({ parentId: "a", index: 1 }, { parentId: "a", index: 1 })).toBe(true);
    expect(isSameTarget({ parentId: "a", index: 1 }, { parentId: "a", index: 2 })).toBe(false);
    expect(isSameTarget({ parentId: "a", index: 1 }, { parentId: null, index: 1 })).toBe(false);
    expect(isSameTarget(null, null)).toBe(true);
    expect(isSameTarget(null, { parentId: null, index: 0 })).toBe(false);
  });
});
