import { describe, expect, it } from "vitest";
import { findLocation, indexDocument, orderedSlotIds, traversalOrder } from "../index-model";
import { VIRTUAL_ROOT_SLOT_ID } from "../types";
import { COMPONENT_IDS as C, SLOT_IDS as S } from "../../__tests__/fixtures";
import {
  FIXTURE_COMPONENT_IDS as X,
  doc,
  fixtureManifest as M,
  makeAbcDocument,
  node,
} from "../../__tests__/fixtures";

describe("indexDocument", () => {
  it("records parent, slot, index, and depth for every node", () => {
    const index = indexDocument(makeAbcDocument(), M);
    expect(index.byId.get("split")).toMatchObject({
      parentId: null,
      slotId: VIRTUAL_ROOT_SLOT_ID,
      index: 0,
      depth: 0,
    });
    expect(index.byId.get("A")).toMatchObject({ parentId: "split", slotId: S.splitLeft, index: 0, depth: 1 });
    expect(index.byId.get("C")).toMatchObject({ parentId: "split", slotId: S.splitRight, index: 1, depth: 1 });
  });

  it("throws on duplicate node ids", () => {
    const dup = doc([node(X.box, {}, {}, "same"), node(X.box, {}, {}, "same")]);
    expect(() => indexDocument(dup, M)).toThrow(/duplicate/i);
  });
});

describe("traversalOrder", () => {
  it("is canonical pre-order: split, A (left), then B, C (right)", () => {
    expect(traversalOrder(makeAbcDocument(), M)).toEqual(["split", "A", "B", "C"]);
  });
});

describe("orderedSlotIds", () => {
  it("returns declared slots in manifest order regardless of object key order", () => {
    // Build the slots object with `right` inserted BEFORE `left`.
    const split = node(C.splitLayout, {}, {}, "split");
    split.slots = { [S.splitRight]: [], [S.splitLeft]: [] };
    expect(orderedSlotIds(split, M.get(C.splitLayout))).toEqual([S.splitLeft, S.splitRight]);
  });

  it("appends undeclared slot ids after declared ones, sorted", () => {
    const n = node(C.stack, {}, {}, "n");
    n.slots = { zeta: [], [S.stackChildren]: [], alpha: [] };
    expect(orderedSlotIds(n, M.get(C.stack))).toEqual([S.stackChildren, "alpha", "zeta"]);
  });
});

describe("findLocation", () => {
  it("resolves a node by id", () => {
    expect(findLocation(makeAbcDocument(), M, "B")?.node.props.label).toBe("B");
  });
  it("returns undefined for a missing id", () => {
    expect(findLocation(makeAbcDocument(), M, "zzz")).toBeUndefined();
  });
});
