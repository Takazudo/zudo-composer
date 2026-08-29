import { describe, expect, it } from "vitest";
import { createSequentialIdFactory } from "../../../shared";
import type { SitemapCommandResult } from "../commands";
import {
  addChildPage,
  addSiblingPage,
  cloneSubtreeWithNewIds,
  duplicatePage,
  movePage,
  removePage,
  renamePage,
  reorderPage,
  updatePageProps,
} from "../commands";
import type { SitemapDocument, SitemapNode } from "../../model";
import { SITEMAP_SCHEMA_VERSION } from "../../model";

function node(id: string, children: SitemapNode[] = []): SitemapNode {
  return { id, title: id.toUpperCase(), children };
}

function fixture(): SitemapDocument {
  return {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id: "map",
    name: "Map",
    root: [
      node("root", [
        node("a", [node("a1"), node("a2", [node("a21")])]),
        node("b"),
        node("c"),
      ]),
    ],
  };
}

function success(result: SitemapCommandResult) {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
  return result;
}

describe("addChildPage / addSiblingPage", () => {
  it("appends or inserts a fresh selected page without mutating input", () => {
    const before = fixture();
    const appended = success(addChildPage(before, "b", "Child", () => "child"));
    expect(appended).toMatchObject({ changed: true, selectedId: "child", insertedId: "child" });
    expect(appended.document.root[0]!.children[1]!.children.map((page) => page.id)).toEqual(["child"]);
    expect(before.root[0]!.children[1]!.children).toEqual([]);

    const inserted = success(addChildPage(before, "root", "Inserted", () => "inserted", 1));
    expect(inserted.document.root[0]!.children.map((page) => page.id)).toEqual([
      "a", "inserted", "b", "c",
    ]);

    const sibling = success(addSiblingPage(before, "b", "Sibling", () => "sibling"));
    expect(sibling.document.root[0]!.children.map((page) => page.id)).toEqual([
      "a", "b", "sibling", "c",
    ]);
  });

  it("rejects a root sibling, invalid targets/indexes, and id collisions as values", () => {
    expect(addSiblingPage(fixture(), "root", "No", () => "new")).toMatchObject({
      ok: false, code: "root-cardinality",
    });
    expect(addChildPage(fixture(), "missing", "No", () => "new")).toMatchObject({
      ok: false, code: "node-not-found",
    });
    expect(addChildPage(fixture(), "b", "No", () => "new", 1)).toMatchObject({
      ok: false, code: "invalid-index",
    });
    expect(addChildPage(fixture(), "b", "No", () => "a")).toMatchObject({
      ok: false, code: "id-collision",
    });
  });
});

describe("updatePageProps / renamePage", () => {
  it("merges allowed JSON-safe values, copies refs, and removes optional values with null", () => {
    const before = fixture();
    const ref = { providerId: "indexeddb", recordId: "product-page" };
    const updated = success(updatePageProps(before, "b", {
      title: "Basket", slug: "basket", notes: "Shop", composition: ref,
    }));
    expect(updated.document.root[0]!.children[1]).toMatchObject({
      title: "Basket", slug: "basket", notes: "Shop", composition: ref,
    });
    expect(updated.document.root[0]!.children[1]!.composition).not.toBe(ref);

    const cleared = success(updatePageProps(updated.document, "b", {
      slug: null, notes: null, composition: null,
    }));
    expect(cleared.document.root[0]!.children[1]).toEqual({ id: "b", title: "Basket", children: [] });
  });

  it("returns the original document for identical renames and empty/equivalent patches", () => {
    const before = fixture();
    const renamed = renamePage(before, "b", "B");
    expect(renamed).toEqual({ ok: true, document: before, selectedId: "b", changed: false });
    const empty = updatePageProps(before, "b", {});
    expect(empty).toEqual({ ok: true, document: before, selectedId: "b", changed: false });

    const withRef = success(updatePageProps(before, "b", {
      composition: { providerId: "indexeddb", recordId: "same" },
    })).document;
    const equivalentRef = updatePageProps(withRef, "b", {
      composition: { recordId: "same", providerId: "indexeddb" },
    });
    expect(equivalentRef).toEqual({ ok: true, document: withRef, selectedId: "b", changed: false });
  });

  it("rejects unknown keys and malformed or non-JSON values", () => {
    expect(updatePageProps(fixture(), "b", { id: "new" } as never)).toMatchObject({
      ok: false, code: "unknown-property",
    });
    expect(updatePageProps(fixture(), "b", { title: 2 } as never)).toMatchObject({
      ok: false, code: "invalid-patch",
    });
    expect(updatePageProps(fixture(), "b", { notes: undefined } as never)).toMatchObject({
      ok: false, code: "invalid-patch",
    });
  });
});

describe("removePage", () => {
  it("removes a subtree and repairs selection in the documented order", () => {
    const nextSibling = success(removePage(fixture(), "b", "b"));
    expect(nextSibling.selectedId).toBe("c");
    expect(nextSibling.document.root[0]!.children.map((page) => page.id)).toEqual(["a", "c"]);

    expect(success(removePage(fixture(), "c", "c")).selectedId).toBe("b");
    expect(success(removePage(fixture(), "a1", "a1")).selectedId).toBe("a2");
    expect(success(removePage(fixture(), "a21", "a21")).selectedId).toBe("a2");
    expect(success(removePage(fixture(), "a", "b")).selectedId).toBe("b");
  });

  it("rejects removing the root", () => {
    expect(removePage(fixture(), "root", "root")).toMatchObject({ ok: false, code: "root-removal" });
  });
});

describe("duplicatePage / cloneSubtreeWithNewIds", () => {
  it("re-issues every subtree id, returns the map, and copies Composition refs verbatim", () => {
    const source: SitemapNode = {
      id: "product",
      title: "Product",
      composition: { providerId: "indexeddb", recordId: "product-composition" },
      children: [node("details", [node("reviews")])],
    };
    const cloned = cloneSubtreeWithNewIds(source, createSequentialIdFactory("copy"));
    expect([...cloned.idMap.entries()]).toEqual([
      ["product", "product-1"],
      ["details", "details-2"],
      ["reviews", "reviews-3"],
    ]);
    expect(cloned.node.composition).toEqual(source.composition);
    expect(cloned.node.composition).not.toBe(source.composition);
    expect(cloned.node.children[0]!.children[0]!.id).toBe("reviews-3");
    expect(source.children[0]!.id).toBe("details");
  });

  it("duplicates immediately after the source and exposes every remapped id", () => {
    const duplicated = success(duplicatePage(fixture(), "a", createSequentialIdFactory("copy")));
    expect(duplicated.document.root[0]!.children.map((page) => page.id)).toEqual([
      "a", "a-1", "b", "c",
    ]);
    expect([...duplicated.idMap!.keys()]).toEqual(["a", "a1", "a2", "a21"]);
    expect(duplicated.selectedId).toBe("a-1");
  });

  it("rejects duplicating the root and generated collisions", () => {
    expect(duplicatePage(fixture(), "root", createSequentialIdFactory())).toMatchObject({
      ok: false, code: "root-cardinality",
    });
    expect(duplicatePage(fixture(), "a", () => "same")).toMatchObject({
      ok: false, code: "id-collision",
    });
  });
});

describe("movePage / reorderPage", () => {
  it("moves across parents and applies the same-list pre-removal index adjustment", () => {
    const crossParent = success(movePage(fixture(), "b", "a", 1));
    expect(crossParent.document.root[0]!.children.map((page) => page.id)).toEqual(["a", "c"]);
    expect(crossParent.document.root[0]!.children[0]!.children.map((page) => page.id)).toEqual([
      "a1", "b", "a2",
    ]);

    const sameList = success(movePage(fixture(), "a", "root", 3));
    expect(sameList.document.root[0]!.children.map((page) => page.id)).toEqual(["b", "c", "a"]);
  });

  it("makes own-position moves and reorder boundaries explicit no-ops", () => {
    const before = fixture();
    const ownIndex = movePage(before, "b", "root", 1);
    expect(ownIndex).toEqual({ ok: true, document: before, selectedId: "b", changed: false });
    const adjacentGap = movePage(before, "b", "root", 2);
    expect(adjacentGap).toEqual({ ok: true, document: before, selectedId: "b", changed: false });
    const boundary = reorderPage(before, "a", "up");
    expect(boundary).toEqual({ ok: true, document: before, selectedId: "a", changed: false });
  });

  it("swaps siblings and leaves input untouched", () => {
    const before = fixture();
    const result = success(reorderPage(before, "b", "down"));
    expect(result.document.root[0]!.children.map((page) => page.id)).toEqual(["a", "c", "b"]);
    expect(before.root[0]!.children.map((page) => page.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects descendant cycles, a second root, bad indexes, and missing targets", () => {
    expect(movePage(fixture(), "a", "a21", 0)).toMatchObject({
      ok: false, code: "descendant-cycle",
    });
    expect(movePage(fixture(), "b", null, 1)).toMatchObject({
      ok: false, code: "root-cardinality",
    });
    expect(movePage(fixture(), "b", "a", 99)).toMatchObject({
      ok: false, code: "invalid-index",
    });
    expect(movePage(fixture(), "b", "missing", 0)).toMatchObject({
      ok: false, code: "node-not-found",
    });
  });
});

