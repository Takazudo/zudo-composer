import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { computeGridView, type GridItemData } from "../components/grid-view";
import { Markdown, parseBlocks } from "../components/markdown";
import { isActivePath } from "../components/nav-link";
import { formatPrice } from "../components/price-tag";

const item = (name: string, price: number, category = "desk", featured = false, tags: string[] = []): GridItemData => ({ slug: name.toLowerCase(), name, price, category, featured, tags });

describe("computeGridView", () => {
  const items = [["a", item("Beta", 30, "desk", false, ["brass"])], ["b", item("Alpha", 10, "light", true)], ["c", item("Gamma", 20, "carry", true)]] as const;
  const query = { categories: [], sort: "featured" as const, search: "", page: 1, pageSize: 0 };

  it("puts featured first and keeps query order as the tie-break", () => {
    const view = computeGridView(items, query);
    expect(["a", "b", "c"].map((id) => view.items.get(id)?.order)).toEqual([2, 0, 1]);
    expect(view.categories).toEqual(["desk", "light", "carry"]);
  });

  it("clamps the page into range", () => {
    const view = computeGridView(items, { ...query, sort: "name", pageSize: 2, page: 9 });
    expect(view).toMatchObject({ page: 2, pageCount: 2, matchCount: 3 });
    expect(view.items.get("c")).toEqual({ hidden: false, order: 2 });
    expect(view.items.get("b")?.hidden).toBe(true);
  });

  it("matches search on tags case-insensitively", () => {
    const view = computeGridView(items, { ...query, search: " BRASS " });
    expect(view.matchCount).toBe(1);
    expect(view.items.get("a")?.hidden).toBe(false);
  });
});

describe("markdown", () => {
  it("parses headings, lists, rules and paragraphs", () => {
    expect(parseBlocks("## A\ntext\nmore\n\n1. x\n2. y\n---\n### B").map((block) => block.kind)).toEqual(["h2", "p", "ol", "hr", "h3"]);
  });

  it("renders links, emphasis and drops unsafe hrefs", () => {
    const html = render(<Markdown source="See [care](/faq), *soft* and **firm**, not [x](javascript:alert(1))." />);
    expect(html).toContain('href="/faq"');
    expect(html).toContain("<em>soft</em>");
    expect(html).not.toContain("javascript:");
  });

  it("escapes raw HTML as text", () => {
    expect(render(<Markdown source="<script>bad()</script>" />)).toContain("&lt;script>");
  });
});

describe("helpers", () => {
  it("matches nav paths by prefix unless exact", () => {
    expect(isActivePath("/products/field-pen", "/products", false)).toBe(true);
    expect(isActivePath("/productsx", "/products", false)).toBe(false);
    expect(isActivePath("/products/field-pen", "/products", true)).toBe(false);
    expect(isActivePath("/about", "/", false)).toBe(false);
  });

  it("falls back when the currency code is invalid", () => {
    expect(formatPrice(24, "USD")).toBe("$24.00");
    expect(formatPrice(24, "??")).toBe("24.00 ??");
  });
});
