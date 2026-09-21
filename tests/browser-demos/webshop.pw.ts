import { expect, test } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { requireDemosLaneContext } from "./isolated-context";
import { crawlDemoRoutes, expectNoMobileOverflow, expectPrimaryNavTappable } from "./route-crawl";

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
