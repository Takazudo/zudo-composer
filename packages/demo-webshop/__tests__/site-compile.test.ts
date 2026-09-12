// The committed site-project.json compiled through src/site-project/compiler
// the way the static build does it: validation, an exact Assets lock from
// cms/assets and `policy: "release"`.
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { CompositionNode } from "../../../src/composer/model/types";
import { matchDeliveryRoute } from "../../../src/features/delivery/routing";
import type { SiteCompiledRoute } from "../../../src/site-project/compiler";
import { compileStaticSite, type StaticSiteCompilation } from "../../../scripts/site-static/compile";
import { componentPack } from "../components/pack";

const packageRoot = resolve(import.meta.dirname, "..");

const PRODUCT_SLUGS = [
  "brass-rule",
  "candle-set",
  "card-wallet",
  "clip-light",
  "field-pen",
  "key-loop",
  "ledger-notebook",
  "pocket-torch",
  "rain-cape",
  "slate-tray",
  "sling-pouch",
  "wick-lamp",
];

const EXPECTED_H1: Record<string, string> = {
  "/": "Objects for *quiet* work",
  "/products": "All products",
  "/desk": "Desk",
  "/carry": "Carry",
  "/light": "Light",
  "/cart": "Your cart",
  "/checkout": "Checkout",
  "/about": "About Nightjar Supply",
  "/faq": "Questions",
  "/products/ledger-notebook": "Ledger Notebook A5",
  "/products/brass-rule": "Brass Rule 30 cm",
  "/products/field-pen": "Field Pen",
  "/products/slate-tray": "Slate Desk Tray",
  "/products/sling-pouch": "Sling Pouch",
  "/products/card-wallet": "Card Wallet",
  "/products/key-loop": "Key Loop",
  "/products/rain-cape": "Packable Rain Cape",
  "/products/wick-lamp": "Wick Lamp",
  "/products/pocket-torch": "Pocket Torch",
  "/products/candle-set": "Candle Set",
  "/products/clip-light": "Clip Reading Light",
};

let compiled: StaticSiteCompilation;

function nodes(route: SiteCompiledRoute): CompositionNode[] {
  const all: CompositionNode[] = [];
  const walk = (list: readonly CompositionNode[]) => { for (const item of list) { all.push(item); Object.values(item.slots).forEach(walk); } };
  walk(route.composition.document.root);
  return all;
}

/** The components that render an `<h1>`: a hero, or a section heading set to h1. */
function headings(route: SiteCompiledRoute): string[] {
  return nodes(route)
    .filter((item) => item.componentId === "shop.hero" || (item.componentId === "shop.section-heading" && item.props.as === "h1"))
    .map((item) => String(item.props.heading));
}

const route = (pathname: string) => {
  const found = compiled.build.routes.find((candidate) => candidate.pathname === pathname);
  if (!found) throw new Error(`No compiled route ${pathname}`);
  return found;
};

beforeAll(async () => {
  compiled = await compileStaticSite({ projectPath: resolve(packageRoot, "site-project.json"), pack: componentPack, assetsStoreRoot: resolve(packageRoot, "cms/assets") });
});

describe("demo-webshop compiled site", () => {
  it("compiles every expected route, each with exactly one h1", () => {
    expect(compiled.build.routes.map(({ pathname }) => pathname).sort()).toEqual(Object.keys(EXPECTED_H1).sort());
    for (const [pathname, h1] of Object.entries(EXPECTED_H1)) expect(headings(route(pathname)), pathname).toEqual([h1]);
  });

  it("titles each product route by its product name", () => {
    expect(route("/products/wick-lamp").displayTitle).toBe("Wick Lamp");
  });

  it("materialises all 12 product cards on the catalog", () => {
    const cards = nodes(route("/products")).filter((item) => item.componentId === "shop.product-card");
    expect(cards.map((card) => card.props.slug).sort()).toEqual(PRODUCT_SLUGS);
    expect(new Set(cards.map((card) => card.props.category))).toEqual(new Set(["desk", "carry", "light"]));
  });

  it("narrows each shelf to its own four products and the home grid to the four featured", () => {
    for (const shelf of ["desk", "carry", "light"]) {
      const cards = nodes(route(`/${shelf}`)).filter((item) => item.componentId === "shop.product-card");
      expect(cards, shelf).toHaveLength(4);
      expect(cards.every((card) => card.props.category === shelf), shelf).toBe(true);
    }
    const featured = nodes(route("/")).filter((item) => item.componentId === "shop.product-card");
    expect(featured.map((card) => card.props.slug)).toEqual(["field-pen", "ledger-notebook", "sling-pouch", "wick-lamp"]);
    expect(nodes(route("/")).filter((item) => item.componentId === "shop.category-tile").map((tile) => tile.props.href)).toEqual(["/desk", "/carry", "/light"]);
    expect(nodes(route("/faq")).filter((item) => item.componentId === "shop.faq-item")).toHaveLength(8);
  });

  it("resolves every product route's images to pinned uploaded-assets URLs", () => {
    for (const slug of PRODUCT_SLUGS) {
      const all = nodes(route(`/products/${slug}`));
      const gallery = all.filter((item) => item.componentId === "shop.gallery-image" && item.props.src !== "");
      expect(gallery.length, slug).toBeGreaterThanOrEqual(1);
      const sources = all.flatMap((item) => (typeof item.props.src === "string" && item.props.src !== "" ? [item.props.src] : []));
      for (const src of sources) expect(src, slug).toMatch(/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.webp$/);
    }
    const withSecondImage = PRODUCT_SLUGS.filter((slug) => nodes(route(`/products/${slug}`)).filter((item) => item.componentId === "shop.gallery-image" && item.props.src !== "").length === 2);
    expect(withSecondImage).toEqual(["field-pen", "ledger-notebook", "wick-lamp"]);
    expect(compiled.assetFiles).toHaveLength(16);
  });

  it("puts the cart and checkout mocks in the sitemap and its navigation", () => {
    expect(nodes(route("/cart")).map((item) => item.componentId)).toEqual(expect.arrayContaining(["shop.cart-page", "shop.cart-summary", "shop.demo-note"]));
    expect(nodes(route("/checkout")).map((item) => item.componentId)).toEqual(expect.arrayContaining(["shop.checkout-form", "shop.cart-summary", "shop.demo-note"]));
    const footer = compiled.build.navigation.footer.map((item) => item.label);
    expect(footer).toEqual(["About", "FAQ", "Cart", "Checkout"]);
    expect(compiled.build.navigation.primary.map((item) => item.label)).toEqual(["Desk", "Carry", "Light", "All products", "About"]);
  });

  it("leaves unknown routes to the tool's not-found state", () => {
    for (const pathname of ["/products/nope", "/sale", "/404"]) expect(matchDeliveryRoute(compiled.build.routes, pathname, "/"), pathname).toBeUndefined();
    expect(matchDeliveryRoute(compiled.build.routes, "/products/field-pen", "/")?.pathname).toBe("/products/field-pen");
    const compositionIds = compiled.project.providers.compositions.flatMap((provider) => provider.records.map((record) => record.id));
    expect(compositionIds.filter((id) => /404|not-found/.test(id))).toEqual([]);
  });
});
