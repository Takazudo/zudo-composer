import { describe, expect, it } from "vitest";
import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import {
  buildLogicalTree,
  isExternalSlug,
  layoutSitemap,
  NODE_MIN_HEIGHT,
  type CanvasLayout,
} from "../layout";

function node(id: string, slug?: string, children: SitemapNode[] = []): SitemapNode {
  return { id, title: id, ...(slug === undefined ? {} : { slug }), children };
}

function document(root: SitemapNode): SitemapDocument {
  return { schemaVersion: SITEMAP_SCHEMA_VERSION, id: "test", name: "Test", root: [root] };
}

function connectorCrossings(layout: CanvasLayout): string[] {
  const failures: string[] = [];
  for (const connector of layout.segments) {
    const tokens = connector.path.match(/[MHV]|-?\d+(?:\.\d+)?/g) ?? [];
    let cursor = 0;
    let x = 0;
    let y = 0;
    while (cursor < tokens.length) {
      const command = tokens[cursor++];
      if (command === "M") {
        x = Number(tokens[cursor++]);
        y = Number(tokens[cursor++]);
        continue;
      }
      const next = Number(tokens[cursor++]);
      const x2 = command === "H" ? next : x;
      const y2 = command === "V" ? next : y;
      for (const box of layout.nodes) {
        const crossesVertical = x === x2
          && x > box.left && x < box.left + box.width
          && Math.max(Math.min(y, y2), box.top) < Math.min(Math.max(y, y2), box.top + box.height);
        const crossesHorizontal = y === y2
          && y > box.top && y < box.top + box.height
          && Math.max(Math.min(x, x2), box.left) < Math.min(Math.max(x, x2), box.left + box.width);
        if (crossesVertical || crossesHorizontal) failures.push(`${connector.id}:${box.id}`);
      }
      x = x2;
      y = y2;
    }
  }
  return failures;
}

describe("canvas measured layout", () => {
  it("uses measured heights and emits only crisp orthogonal commands", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [
      node("products", undefined, [node("long-title")]),
      node("about"),
    ])));
    const result = layoutSitemap(tree, new Map([["long-title", 91]]), 1440, "cluster");

    expect(result.mode).toBe("cluster");
    expect(result.nodes.find((item) => item.id === "long-title")?.height).toBe(91);
    expect(result.nodes.find((item) => item.id === "about")?.height).toBe(NODE_MIN_HEIGHT);
    expect(result.segments.length).toBeGreaterThan(0);
    for (const item of result.segments) {
      expect(item.path).toMatch(/^M -?\d+(?:\.5)? -?\d+(?:\.5)?(?: [HV] -?\d+(?:\.5)?)+$/);
      expect(item.path).not.toMatch(/[QLC]/);
    }
  });

  it("uses one uninterrupted vertical connector for a single depth-1 child", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [node("only")])));
    const result = layoutSitemap(tree, new Map(), 1440, "cluster");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.id).toBe("home:only");
    expect(result.segments[0]?.path).toMatch(/^M [\d.]+ [\d.]+ V [\d.]+$/);
  });

  it("centers the desktop root and preserves non-overlapping cluster gutters", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [
      node("one", undefined, [node("nested", undefined, [node("deep")])]),
      node("two"),
    ])));
    const result = layoutSitemap(tree, new Map(), 1440, "cluster");
    const root = result.nodes.find((item) => item.id === "home")!;
    const one = result.nodes.find((item) => item.id === "one")!;
    const two = result.nodes.find((item) => item.id === "two")!;
    const deep = result.nodes.find((item) => item.id === "deep")!;

    expect(root.left + root.width / 2).toBe(result.width / 2);
    expect(two.left - (deep.left + deep.width)).toBeGreaterThanOrEqual(48);
    expect(one.top).toBe(two.top);
  });

  it("renders the narrow pre-order outline with clamped deep offsets and minimum widths", () => {
    const root = node("d0");
    let cursor = root;
    for (let depth = 1; depth <= 6; depth += 1) {
      const child = node(`d${depth}`);
      cursor.children.push(child);
      cursor = child;
    }
    const result = layoutSitemap(buildLogicalTree(document(root)), new Map(), 375, "outline");
    const depth4 = result.nodes.find((item) => item.id === "d4")!;
    const depth6 = result.nodes.find((item) => item.id === "d6")!;

    expect(result.mode).toBe("outline");
    expect(result.nodes.map((item) => item.id)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6"]);
    expect(depth6.left).toBe(depth4.left);
    expect(Math.min(...result.nodes.map((item) => item.width))).toBeGreaterThanOrEqual(240);
    expect(result.width).toBeGreaterThanOrEqual(375);
    expect(result.segments.every((item) => /^M [\d.]+ [\d.]+(?: [HV] [\d.]+)+$/.test(item.path))).toBe(true);
    expect(connectorCrossings(result)).toEqual([]);
    expect(result.segments.find((item) => item.id === "d0:spine")?.path).toMatch(/^M 26 [\d.]+ V/);
    expect(result.segments.find((item) => item.id === "d4:spine")?.path).toMatch(/^M 100 [\d.]+ H 92 V/);
  });

  it("keeps the page-level mode independent from the canvas scrollport width", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [node("child")])));
    const narrowCenterColumn = layoutSitemap(tree, new Map(), 760, "cluster");
    const wideScrollport = layoutSitemap(tree, new Map(), 1440, "outline");

    expect(narrowCenterColumn.mode).toBe("cluster");
    expect(narrowCenterColumn.width).toBeGreaterThanOrEqual(760);
    expect(wideScrollport.mode).toBe("outline");
    expect(wideScrollport.width).toBeGreaterThanOrEqual(1440);
  });
});

describe("external classification", () => {
  it.each([
    ["https://example.com/path", true],
    ["http://example.com", true],
    ["ftp://example.com", false],
    ["/relative", false],
    [undefined, false],
  ])("classifies %s from parsed URL protocol", (slug, expected) => {
    expect(isExternalSlug(slug)).toBe(expected);
  });

  it("keeps mixed clusters internal and dashes only external destinations", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [
      node("mixed", undefined, [
        node("outside", "https://example.com"),
        node("inside", "/inside"),
        node("missing"),
      ]),
    ])));
    const result = layoutSitemap(tree, new Map(), 1440, "cluster");

    expect(tree.byId.get("mixed")?.externalCluster).toBe(false);
    expect(result.segments.find((item) => item.id === "mixed:outside")?.external).toBe(true);
    expect(result.segments.find((item) => item.id === "mixed:inside")?.external).toBe(false);
    expect(result.segments.find((item) => item.id === "mixed:missing")?.external).toBe(false);
  });

  it("marks every member and edge of an all-external descendant cluster", () => {
    const tree = buildLogicalTree(document(node("home", undefined, [
      node("links", undefined, [
        node("one", "https://one.example"),
        node("two", "http://two.example"),
      ]),
    ])));
    const result = layoutSitemap(tree, new Map(), 1440, "cluster");

    expect(tree.byId.get("links")?.externalCluster).toBe(true);
    expect(tree.byId.get("one")?.externalCluster).toBe(true);
    expect(result.segments.find((item) => item.id === "home:links")?.external).toBe(true);
    expect(result.segments.filter((item) => item.id.startsWith("links:"))).toSatisfy(
      (segments: typeof result.segments) => segments.every((item) => item.external),
    );
  });
});
