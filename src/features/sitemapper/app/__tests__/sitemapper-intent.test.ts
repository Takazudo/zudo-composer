import { describe, expect, it } from "vitest";
import { readSitemapperIntent, sitemapperHref, SITEMAPPER_ROUTE } from "../sitemapper-intent";

describe("Sitemapper route intents", () => {
  it("builds the canonical link for a Sitemap and for one page inside it", () => {
    expect(sitemapperHref("product-map")).toBe("/sitemapper?sitemap=product-map");
    expect(sitemapperHref("product-map", "home")).toBe("/sitemapper?sitemap=product-map&page=home");
  });

  it("refuses to build a link from an unsafe id rather than emitting one", () => {
    expect(sitemapperHref("../etc")).toBe(SITEMAPPER_ROUTE);
    // An unsafe page id drops the page rather than the whole link.
    expect(sitemapperHref("product-map", "../etc")).toBe("/sitemapper?sitemap=product-map");
  });

  it("round-trips every link it builds", () => {
    expect(readSitemapperIntent(sitemapperHref("product-map", "home"))).toEqual({
      status: "sitemap",
      intent: { sitemapId: "product-map", pageId: "home" },
    });
    expect(readSitemapperIntent(sitemapperHref("product-map"))).toEqual({
      status: "sitemap",
      intent: { sitemapId: "product-map" },
    });
  });

  it("reads a bare route as the library and a malformed one as an error", () => {
    expect(readSitemapperIntent({ pathname: "/sitemapper", search: "" })).toEqual({ status: "library" });
    expect(readSitemapperIntent({ pathname: "/sitemapper", search: "?sitemap=..%2Fetc" })).toEqual({
      status: "invalid",
      message: "The Sitemap id is malformed.",
    });
    expect(readSitemapperIntent({ pathname: "/sitemapper", search: "?sitemap=a&sitemap=b" })).toMatchObject({
      status: "invalid",
    });
  });

  it("ignores another route's intent instead of claiming it", () => {
    expect(readSitemapperIntent({ pathname: "/media", search: "?asset=logo" })).toEqual({ status: "library" });
  });
});
