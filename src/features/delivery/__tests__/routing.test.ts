import { describe, expect, it } from "vitest";
import type { SiteCompiledRoute } from "../../../site-project/compiler";
import { isSitePath, matchSiteRoute, normalizeDeliveryLinks, safeDeliveryHref, siteRoutePathname, toSiteHref } from "../routing";

const route = (pathname: string, id: string, displayTitle = id) => ({ pathname, displayTitle, source: { kind: "composition", ref: { providerId: "test", recordId: id } }, ancestors: id === "home" ? [] : [{ nodeId: "home", pathname: "/", displayTitle: "Home" }, ...(id === "entry" ? [{ nodeId: "journal", pathname: "/journal", displayTitle: "Journal" }] : [])], sitemapNode: { id, path: `$${id}` }, modules: [], composition: { local: { providerId: "test", recordId: id }, routeRecordId: id, document: { schemaVersion: 2, id, name: id, root: [] } } }) as SiteCompiledRoute;

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
    expect(safeDeliveryHref("/uploaded-assets/photo.webp")).toBe("/uploaded-assets/photo.webp");
    expect(safeDeliveryHref("/uploaded-assets/photo.webp?variant=thumb#preview")).toBe("/uploaded-assets/photo.webp?variant=thumb#preview");
    expect(safeDeliveryHref("/uploaded-assets")).toBe("/site/uploaded-assets");
    expect(safeDeliveryHref("/uploaded-assets/../about")).toBe("/site/uploaded-assets/../about");
    expect(safeDeliveryHref("/uploaded-assets/%2e%2e/about")).toBe("/site/uploaded-assets/%2e%2e/about");
    expect(safeDeliveryHref("//example.com/path")).toBeUndefined(); expect(safeDeliveryHref(" javascript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("java\nscript:alert(1)")).toBeUndefined(); expect(safeDeliveryHref("java\tscript:alert(1)")).toBeUndefined();
    expect(safeDeliveryHref("\\evil.example")).toBeUndefined();
  });

  it("rewrites rendered Markdown links and removes unsafe destinations", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="zc-prose-md"><a href="/about">About</a><a href="/uploaded-assets/photo.webp?variant=thumb#preview">Asset</a><a href="#part">Part</a><a href="https://example.com">External</a><a href="java&#10;script:alert(1)">Unsafe</a></div>';
    normalizeDeliveryLinks(root);
    const anchors = root.querySelectorAll("a");
    expect(anchors[0]!.getAttribute("href")).toBe("/site/about");
    expect(anchors[1]!.getAttribute("href")).toBe("/uploaded-assets/photo.webp?variant=thumb#preview");
    expect(anchors[2]!.getAttribute("href")).toBe("#part");
    expect(anchors[3]!.getAttribute("href")).toBe("https://example.com");
    expect(anchors[4]!.hasAttribute("href")).toBe(false);
    normalizeDeliveryLinks(root);
    expect(anchors[0]!.getAttribute("href")).toBe("/site/about");
    expect(anchors[1]!.getAttribute("href")).toBe("/uploaded-assets/photo.webp?variant=thumb#preview");
  });
});
