import { describe, expect, it } from "vitest";
import type { SiteCompiledRoute } from "../../../site-project/compiler";
import type { SitemapDocument } from "../../../sitemapper/model/types";
import { breadcrumbs, footerNavigation, primaryNavigation } from "../chrome";
import { isSitePath, matchSiteRoute, normalizeDeliveryLinks, safeDeliveryHref, siteRoutePathname, toSiteHref } from "../routing";

const sitemap: SitemapDocument = { schemaVersion: 2, id: "map", name: "Map", root: [{ id: "home", title: "Home", source: { kind: "unassigned" }, children: [
  { id: "about", title: "About", slug: "about", source: { kind: "unassigned" }, children: [] },
  { id: "journal", title: "Journal", slug: "journal", source: { kind: "unassigned" }, children: [{ id: "entry", title: "Article", source: { kind: "unassigned" }, children: [] }] },
] }] };
const route = (pathname: string, id: string, displayTitle = id) => ({ pathname, displayTitle, sitemapNode: { id, path: `$${id}` } }) as SiteCompiledRoute;
const routes = [route("/", "home", "Home"), route("/about", "about", "About"), route("/journal", "journal", "Journal"), route("/journal/first", "entry", "First"), route("/journal/second", "entry", "Second")];

describe("delivery routing", () => {
  it("captures only the exact Site boundary and preserves encoded bytes", () => {
    expect(isSitePath("/site")).toBe(true); expect(isSitePath("/site/a")).toBe(true);
    expect(isSitePath("/sitemap")).toBe(false); expect(isSitePath("/sitewide")).toBe(false);
    expect(siteRoutePathname("/site")).toBe("/"); expect(siteRoutePathname("/site/")).toBe("/");
    expect(siteRoutePathname("/site/a%2Fb")).toBe("/a%2Fb");
    expect(matchSiteRoute([route("/a%2Fb", "encoded")], "/site/a%2Fb")?.sitemapNode.id).toBe("encoded");
  });

  it("prefixes compiler paths without confusing a legal site slug and rejects unsafe schemes", () => {
    expect(toSiteHref("/")).toBe("/site"); expect(toSiteHref("/about")).toBe("/site/about"); expect(toSiteHref("/site/about")).toBe("/site/site/about");
    expect(safeDeliveryHref("#part")).toBe("#part"); expect(safeDeliveryHref("https://example.com")).toBe("https://example.com");
    expect(safeDeliveryHref("mailto:a@example.com")).toBe("mailto:a@example.com"); expect(safeDeliveryHref("javascript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("/site/about")).toBe("/site/site/about"); expect(safeDeliveryHref("/about")).toBe("/site/about");
    expect(safeDeliveryHref("//example.com/path")).toBeUndefined(); expect(safeDeliveryHref(" javascript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("java\nscript:alert(1)")).toBeUndefined(); expect(safeDeliveryHref("java\tscript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("\\evil.example")).toBeUndefined();
  });

  it("rewrites rendered Markdown links and removes unsafe destinations", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="zc-prose-md"><a href="/about">About</a><a href="#part">Part</a><a href="https://example.com">External</a><a href="java&#10;script:alert(1)">Unsafe</a></div>';
    normalizeDeliveryLinks(root);
    expect(root.querySelector("a")!.getAttribute("href")).toBe("/site/about");
    expect(root.querySelectorAll("a")[1]!.getAttribute("href")).toBe("#part");
    expect(root.querySelectorAll("a")[2]!.getAttribute("href")).toBe("https://example.com");
    expect(root.querySelectorAll("a")[3]!.hasAttribute("href")).toBe(false);
    normalizeDeliveryLinks(root);
    expect(root.querySelector("a")!.getAttribute("href")).toBe("/site/about");
  });
});

describe("Sitemap-derived chrome", () => {
  it("uses authored order and ready route node identities", () => {
    expect(primaryNavigation(sitemap, routes, "entry", "/journal/second")).toEqual([
      { id: "home", title: "Home", href: "/site", active: true, current: false },
      { id: "about", title: "About", href: "/site/about", active: false, current: false },
      { id: "journal", title: "Journal", href: "/site/journal", active: true, current: false },
    ]);
    expect(breadcrumbs(sitemap, routes, "entry", "/journal/second").map(({ id, title, href }) => [id, title, href])).toEqual([["home", "Home", "/site"], ["journal", "Journal", "/site/journal"], ["entry", "Second", "/site/journal/second"]]);
    expect(footerNavigation(sitemap, routes, "entry", "/journal/second").map(({ href }) => href)).toEqual(["/site", "/site/about", "/site/journal"]);
  });
});

describe("compiled route prefixing", () => {
  it("links a legal /site compiler route below the delivery boundary", () => {
    const nested = { ...sitemap, root: [{ ...sitemap.root[0]!, children: [...sitemap.root[0]!.children, { id: "site", title: "Site", slug: "site", source: { kind: "unassigned" as const }, children: [] }] }] };
    const nestedRoutes = [...routes, route("/site", "site")];
    expect(primaryNavigation(nested, nestedRoutes, "site", "/site").at(-1)?.href).toBe("/site/site");
  });
});
