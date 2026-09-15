import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activeComponentProvider } from "../../composer/active-pack";
import { loadSampleSiteProject } from "../../../test/site-project-fixture";
import { compileSiteProject, type SiteBuildPlan } from "../../../site-project/compiler";
import type { SiteProject } from "../../../site-project/model";
import { breadcrumbs, footerNavigation, primaryNavigation } from "../chrome";
import { deliveryRoutePathname, matchDeliveryRoute, normalizeDeliveryLinks, safeDeliveryHref, toDeliveryHref } from "../routing";
import { SiteDelivery } from "../site-delivery";
import type { DeliverySourceContract } from "../source";

afterEach(cleanup);
let project: SiteProject;
let build: SiteBuildPlan;
beforeAll(async () => {
  project = loadSampleSiteProject({ componentPack: activeComponentProvider.manifest });
  const compilation = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog });
  if (compilation.status !== "ready") throw new Error(compilation.diagnostics.map(({ message }) => message).join(" "));
  build = compilation.build;
});
const staticSource = (value: SiteProject = project): DeliverySourceContract => ({ kind: "static", componentProvider: activeComponentProvider, project: value, build });
const sitemap = () => project.providers.sitemaps[0]!.records.find(({ id }) => id === project.activeSitemap.recordId)!.document;

describe("delivery routing at basePath /", () => {
  it("leaves compiler paths as final hrefs and keeps uploaded assets canonical", () => {
    expect(toDeliveryHref("/", "/")).toBe("/");
    expect(toDeliveryHref("/journal/a", "/")).toBe("/journal/a");
    expect(toDeliveryHref("relative", "/")).toBe("relative");
    expect(safeDeliveryHref("/about", "/")).toBe("/about");
    expect(safeDeliveryHref("/uploaded-assets/photo.webp", "/")).toBe("/uploaded-assets/photo.webp");
    expect(safeDeliveryHref("//example.com", "/")).toBeUndefined();
    expect(safeDeliveryHref("javascript:alert(1)", "/")).toBeUndefined();
    const root = document.createElement("div");
    root.innerHTML = '<div class="zc-prose-md"><a href="/about">About</a></div>';
    normalizeDeliveryLinks(root, "/");
    expect(root.querySelector("a")!.getAttribute("href")).toBe("/about");
  });

  it("matches the location pathname itself without stripping a boundary", () => {
    expect(deliveryRoutePathname("/", "/")).toBe("/");
    expect(deliveryRoutePathname("/site/about", "/")).toBe("/site/about");
    expect(deliveryRoutePathname("about", "/")).toBeNull();
    expect(matchDeliveryRoute(build.routes, "/journal", "/")?.pathname).toBe("/journal");
    expect(matchDeliveryRoute(build.routes, "/site/journal", "/")).toBeUndefined();
    expect(matchDeliveryRoute(build.routes, "/missing", "/")).toBeUndefined();
  });

  it("resolves navigation and breadcrumbs against / with active state from the pathname", () => {
    const entry = build.routes.find(({ pathname }) => pathname === "/journal/start-with-the-question")!;
    const primary = primaryNavigation(sitemap(), build.routes, entry.sitemapNode.id, entry.pathname, "/");
    expect(primary.map(({ href }) => href)).toEqual(["/", "/about", "/services", "/journal"]);
    expect(primary.filter(({ active }) => active).map(({ href }) => href)).toEqual(["/", "/journal"]);
    expect(primary.some(({ current }) => current)).toBe(false);
    const journal = build.routes.find(({ pathname }) => pathname === "/journal")!;
    expect(primaryNavigation(sitemap(), build.routes, journal.sitemapNode.id, "/journal", "/").find(({ current }) => current)?.href).toBe("/journal");
    expect(footerNavigation(sitemap(), build.routes, entry.sitemapNode.id, entry.pathname, "/").every(({ href, external }) => external || !href.startsWith("/site"))).toBe(true);
    expect(breadcrumbs(sitemap(), build.routes, entry.sitemapNode.id, entry.pathname, "/").map(({ href }) => href)).toEqual(["/", "/journal", "/journal/start-with-the-question"]);
  });
});

describe("SiteDelivery from a static source at /", () => {
  it("renders only the skip link and <main>; the host template owns every other part of the page", async () => {
    const { container } = render(<SiteDelivery source={staticSource()} pathname="/journal/start-with-the-question" />);
    await screen.findByRole("heading", { name: "Start with the question" });
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    expect(container.querySelector("main#main-content")).not.toBeNull();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Footer navigation" })).toBeNull();
    expect(container.querySelector("header.site-delivery__header, footer.site-delivery__footer")).toBeNull();
    expect(screen.queryByText(/not deployed|not activated/)).toBeNull();
    await waitFor(() => expect(document.title).toBe("Start with the question — Sample Studio"));
  });

  it("writes authored route links without a delivery prefix", async () => {
    render(<SiteDelivery source={staticSource()} pathname="/journal" />);
    await screen.findByRole("heading", { name: "Working notes" });
    expect(screen.getByRole("link", { name: "Read Start with the question" })).toHaveAttribute("href", "/journal/start-with-the-question");
  });

  it("renders a plain tool-owned not-found page that links home", async () => {
    render(<SiteDelivery source={staticSource()} pathname="/missing" />);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to site home" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toBe("Page not found — Sample Studio"));
  });

  it("fails closed when the baked project no longer validates against the pack", async () => {
    const broken = structuredClone(project);
    broken.activeSitemap = { ...broken.activeSitemap, recordId: "missing-sitemap" };
    render(<SiteDelivery source={staticSource(broken)} pathname="/" />);
    expect(await screen.findByRole("heading", { name: "Site data blocked" })).toBeInTheDocument();
  });
});
