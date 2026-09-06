import { describe, expect, it } from "vitest";
import { readSitemapperIntent, sitemapperHref } from "../sitemapper-intent";
describe("Sitemap intent", () => {
  it("round-trips provider-qualified Sitemap and page", () => {
    expect(sitemapperHref("sitemap-indexeddb", "site", "home")).toBe("/sitemapper?provider=sitemap-indexeddb&sitemap=site&page=home");
    expect(readSitemapperIntent(sitemapperHref("sitemap-indexeddb", "site", "home"))).toEqual({ status: "sitemap", intent: { providerId: "sitemap-indexeddb", sitemapId: "site", pageId: "home" } });
  });
  it("rejects invalid targets instead of formatting a library or parent fallback", () => {
    expect(() => sitemapperHref("sitemap-indexeddb", "../site")).toThrow();
    expect(() => sitemapperHref("sitemap-indexeddb", "site", "../home")).toThrow();
    expect(readSitemapperIntent("/sitemapper?sitemap=site").status).toBe("invalid");
  });
  it("opens the bare library", () => { expect(readSitemapperIntent("/sitemapper")).toEqual({ status: "library" }); });
});
