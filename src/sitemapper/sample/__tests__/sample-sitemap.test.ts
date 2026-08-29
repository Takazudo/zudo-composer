import { describe, expect, it } from "vitest";
import { isStructurallyValidDocument, traversalOrder } from "../../model";
import { createSampleSitemap, SAMPLE_SITEMAP } from "../sample-sitemap";

describe("sample sitemap", () => {
  it("is deterministic, structurally valid, and has the reference branch shape", () => {
    const first = createSampleSitemap();
    const second = createSampleSitemap();
    expect(first).toEqual(second);
    expect(first).toEqual(SAMPLE_SITEMAP);
    expect(isStructurallyValidDocument(first)).toMatchObject({ ok: true });
    expect(first.root[0]!.title).toBe("Home");
    expect(first.root[0]!.id).toBe("home-1");
    expect(first.root[0]!.children.map((page) => page.title)).toEqual([
      "Products", "Cart", "Account", "Other Pages",
    ]);
    expect(Math.max(...traversalOrder(first).map((id) => id.match(/-(\d+)$/)?.[1]).map(Number))).toBe(18);
  });

  it("returns a fresh tree on every build", () => {
    expect(createSampleSitemap()).not.toBe(createSampleSitemap());
    expect(createSampleSitemap().root[0]).not.toBe(createSampleSitemap().root[0]);
  });
});
