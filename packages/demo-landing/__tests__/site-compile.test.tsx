import { resolve } from "node:path";
import { render as renderToString } from "preact-render-to-string";
import { beforeAll, describe, expect, it } from "vitest";
import type { CompositionNode } from "../../../src/composer/model/types";
import type { SiteCompiledRoute } from "../../../src/site-project/compiler";
import { compileStaticSite, type StaticSiteCompilation } from "zudo-composer/site-build";
import { componentPack } from "../components/pack";
import { renderNode } from "./render-node";

const packageRoot = resolve(import.meta.dirname, "..");

// Every authored route and the h1 it must render (landing.md § 4).
const ROUTES: Record<string, string> = {
  "/": "Every moving part of your week, in one view",
  "/features": "Features",
  "/pricing": "Pricing",
  "/about": "We make the week legible",
  "/privacy": "Privacy",
  "/terms": "Terms",
};

let compiled: StaticSiteCompilation;
beforeAll(async () => {
  compiled = await compileStaticSite({ projectPath: resolve(packageRoot, "site-project.json"), pack: componentPack, assetsStoreRoot: resolve(packageRoot, "cms/assets") });
});

const route = (pathname: string): SiteCompiledRoute => {
  const found = compiled.build.routes.find((candidate) => candidate.pathname === pathname);
  if (!found) throw new Error(`No compiled route ${pathname}`);
  return found;
};
const html = (pathname: string) => renderToString(<>{route(pathname).composition.document.root.map(renderNode)}</>);
const h1s = (markup: string) => [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(([, inner]) => inner!.replace(/<[^>]+>/g, ""));

function findNodes(nodes: readonly CompositionNode[], componentId: string): CompositionNode[] {
  return nodes.flatMap((item) => [...(item.componentId === componentId ? [item] : []), ...Object.values(item.slots).flatMap((children) => findNodes(children, componentId))]);
}
const tiersOn = (pathname: string) => findNodes(findNodes(route(pathname).composition.document.root, "land.pricing-table"), "land.pricing-tier");

describe("demo-landing compiled for release", () => {
  it("compiles every route with its h1 and page title", () => {
    expect(compiled.build.routes.map(({ pathname }) => pathname).sort()).toEqual(Object.keys(ROUTES).sort());
    for (const [pathname, heading] of Object.entries(ROUTES)) {
      expect(h1s(html(pathname)), pathname).toEqual([heading]);
      expect(route(pathname).composition.linkedSource?.ref.recordId, pathname).toBe("site-frame");
    }
    expect(compiled.project.name).toBe("Orrery");
  });

  it("materialises the three tiers into both pricing tables", () => {
    for (const pathname of ["/", "/pricing"]) {
      const tiers = tiersOn(pathname);
      expect(tiers.map(({ props }) => [props.name, props.priceMonthly, props.priceYearly, props.popular]), pathname).toEqual([
        ["Solo", 0, 0, false],
        ["Studio", 12, 10, true],
        ["Org", 29, 24, false],
      ]);
      expect(tiers.every(({ props }) => props.currency === "USD" && typeof props.feature4 === "string" && props.feature4 !== "")).toBe(true);
    }
    const markup = html("/pricing");
    expect(markup).toContain("Talk to us");
    expect(markup).toContain("Shared team calendar");
  });

  it("fills the testimonials and filters the pricing FAQ to billing", () => {
    const quotes = findNodes(route("/").composition.document.root, "land.testimonial");
    expect(quotes.map(({ props }) => props.name)).toEqual(["Mara Lind", "Jonah Reyes", "Priya Natarajan"]);
    expect(quotes.every(({ props }) => String(props.src).startsWith("/uploaded-assets/sha256-") && String(props.alt).startsWith("Abstract geometric avatar"))).toBe(true);
    expect(findNodes(route("/").composition.document.root, "land.faq-item")).toHaveLength(8);
    const billing = findNodes(route("/pricing").composition.document.root, "land.faq-item");
    expect(billing.length).toBe(4);
    expect(billing.every(({ props }) => props.topic === "billing")).toBe(true);
  });

  it("pins every image to an immutable uploaded asset", () => {
    expect(compiled.assetFiles).toHaveLength(6);
    expect(html("/")).not.toContain("/uploaded-assets/asset-");
    expect(html("/about")).toMatch(/src="\/uploaded-assets\/sha256-[a-f0-9]{64}\.webp"/);
  });

  it("keeps one primary action per viewport: the header button is secondary", () => {
    const frame = route("/").composition.linkedSource!.document.root;
    expect(findNodes(frame, "land.button").map(({ props }) => props.variant)).toEqual(["secondary"]);
    const home = route("/").composition.document.root.map(({ componentId }) => componentId);
    expect(home.indexOf("land.cta-band")).toBeLessThan(home.length - 2);
  });
});
