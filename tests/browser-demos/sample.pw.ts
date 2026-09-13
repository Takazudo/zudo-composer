import { test } from "@playwright/test";
import { requireDemosLaneContext } from "./isolated-context";
import { crawlDemoRoutes, expectNoMobileOverflow } from "./route-crawl";

const { routes } = requireDemosLaneContext(process.env);

test("crawls every Sample Studio route and keeps the narrow layout usable", async ({ page }) => {
  test.setTimeout(180_000);
  await crawlDemoRoutes(page, routes);
  await expectNoMobileOverflow(page, "/");
});
