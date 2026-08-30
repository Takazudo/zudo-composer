import { describe, expect, it } from "vitest";
import type { SiteCompiledRoute } from "../../../site-project/compiler";
import type { SitemapDocument } from "../../../sitemapper/model/types";
import { breadcrumbs, footerNavigation, primaryNavigation } from "../chrome";
import { isSitePath, matchSiteRoute, safeDeliveryHref, siteRoutePathname, toSiteHref } from "../routing";

const sitemap: SitemapDocument = { schemaVersion: 2, id: "map", name: "Map", root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [
  { id: "about", title: "About", slug: "about", source: { kind: "unassigned" }, children: [] },
  { id: "journal", title: "Journal", slug: "journal", source: { kind: "unassigned" }, children: [{ id: "entry", title: "Article", source: { kind: "unassigned" }, children: [] }] },
] }] };
const route = (pathname: string, id: string) => ({ pathname, sitemapNode: { id, path: `$${id}` } }) as SiteCompiledRoute;
const routes = [route("/", "home"), route("/about", "about"), route("/journal", "journal"), route("/journal/first", "entry"), route("/journal/second", "entry")];

describe("delivery routing", () => {
  it("captures only the exact Site boundary and preserves encoded bytes", () => {
    expect(isSitePath("/site")).toBe(true); expect(isSitePath("/site/a")).toBe(true);
    expect(isSitePath("/sitemap")).toBe(false); expect(isSitePath("/sitewide")).toBe(false);
    expect(siteRoutePathname("/site")).toBe("/"); expect(siteRoutePathname("/site/")).toBe("/");
    expect(siteRoutePathname("/site/a%2Fb")).toBe("/a%2Fb");
    expect(matchSiteRoute([route("/a%2Fb", "encoded")], "/site/a%2Fb")?.sitemapNode.id).toBe("encoded");
  });

  it("prefixes internal links once and rejects unsafe schemes", () => {
    expect(toSiteHref("/")).toBe("/site"); expect(toSiteHref("/about")).toBe("/site/about"); expect(toSiteHref("/site/about")).toBe("/site/about");
    expect(safeDeliveryHref("#part")).toBe("#part"); expect(safeDeliveryHref("https://example.com")).toBe("https://example.com");
    expect(safeDeliveryHref("mailto:a@example.com")).toBe("mailto:a@example.com"); expect(safeDeliveryHref("javascript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("//example.com/path")).toBeUndefined(); expect(safeDeliveryHref(" javascript:alert(1)")).toBeUndefined();
  });
});

describe("Sitemap-derived chrome", () => {
  it("uses authored order and ready route node identities", () => {
    expect(primaryNavigation(sitemap, routes, "entry", "/journal/second")).toEqual([
      { id: "home", title: "Home", href: "/site", active: true, current: false },
      { id: "about", title: "About", href: "/site/about", active: false, current: false },
      { id: "journal", title: "Journal", href: "/site/journal", active: true, current: false },
    ]);
    expect(breadcrumbs(sitemap, routes, "entry", "/journal/second").map(({ id, href }) => [id, href])).toEqual([["home", "/site"], ["journal", "/site/journal"], ["entry", "/site/journal/second"]]);
    expect(footerNavigation(sitemap, routes, "entry", "/journal/second").map(({ href }) => href)).toEqual(["/site", "/site/about", "/site/journal"]);
  });
});
