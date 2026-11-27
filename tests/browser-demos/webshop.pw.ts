import { expect, test } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { requireDemosLaneContext } from "./isolated-context";
import { crawlDemoRoutes, expectNoMobileOverflow, expectPrimaryNavTappable } from "./route-crawl";
import { measureProviderRequests } from "./mapping-load-budget";

const { routes } = requireDemosLaneContext(process.env);

test("crawls every Nightjar Supply route and keeps the mobile chrome usable", async ({ page }) => {
  test.setTimeout(180_000);
  await crawlDemoRoutes(page, routes);
  await expectNoMobileOverflow(page, "/");
  // The header hides its inline nav behind a "Menu" toggle below `shop-md`;
  // the delivery chrome's own footer nav duplicates the same links without one.
  await expectPrimaryNavTappable(page, { opensViaToggle: /^menu$/i });
});

test("adding a product to the cart updates the header count", async ({ page }) => {
  // ledger-notebook is authored `availability: "in-stock"` (site-project.ts);
  // several other products are deliberately low-stock or sold out.
  await page.goto(toSiteHref("/products/ledger-notebook"), { waitUntil: "domcontentloaded" });
  // The header's cart link is the only "Cart" link with this exact aria-label
  // (site footer nav and the tool's own delivery footer nav both repeat a
  // plain-text "Cart" link to the same route).
  const cartLink = page.getByLabel("Cart", { exact: true });
  await expect(cartLink).toBeVisible();
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByLabel("Cart, 1 item", { exact: true })).toBeVisible();
});

// #994/#995: a cold /mapping load makes one attachment capture pass, and asset
// verification is a constant number of bulk RPCs rather than one per asset.
test("loads /mapping and a deep-linked Mapping with bounded provider requests", async ({ page }) => {
  test.setTimeout(120_000);
  const library = await measureProviderRequests(page, "/mapping", async (current) => {
    await expect(current.getByRole("heading", { name: "Mappings" })).toBeVisible({ timeout: 30_000 });
  });
  console.info(`[mapping-load-budget] webshop library ${JSON.stringify(library)}`);
  const deepLink = await measureProviderRequests(page, "/mapping?provider=mapping-filesystem&mapping=product-card", async (current) => {
    await expect(current.getByText("Source fields").first()).toBeVisible({ timeout: 30_000 });
  });
  console.info(`[mapping-load-budget] webshop deep-link ${JSON.stringify(deepLink)}`);
  for (const counts of [library, deepLink]) {
    expect(counts["asset_file_provider:resolve-version"] ?? 0, "per-asset verification RPCs").toBe(0);
    expect(counts["sitemapper_provider:snapshot"] ?? 0, "one workspace capture pass").toBeLessThanOrEqual(3);
  }
});
