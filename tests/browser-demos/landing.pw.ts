import { expect, test } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { requireDemosLaneContext } from "./isolated-context";
import { crawlDemoRoutes, expectNoMobileOverflow, expectPrimaryNavTappable } from "./route-crawl";

const { routes } = requireDemosLaneContext(process.env);

test("crawls every Orrery route and keeps the mobile chrome usable", async ({ page }) => {
  test.setTimeout(180_000);
  await crawlDemoRoutes(page, routes);
  await expectNoMobileOverflow(page, "/");
  await expectPrimaryNavTappable(page);
});

test("toggling yearly billing changes a tier price", async ({ page }) => {
  await page.goto(toSiteHref("/pricing"), { waitUntil: "domcontentloaded" });
  // The "Solo" tier is authored free at both cadences (site-project.ts); pick
  // "Studio" (12 monthly / 10 yearly), which actually changes. Match by its
  // own heading, not `hasText`: the "Org" tier's feature list also mentions
  // "Everything in Studio".
  const price = page.locator("article", { has: page.getByRole("heading", { name: "Studio", exact: true }) }).locator("[data-price]");
  const before = await price.textContent();
  await page.getByRole("switch", { name: "Bill yearly", exact: true }).click();
  await expect(price).not.toHaveText(before ?? "");
});
