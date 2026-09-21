import { expect, test } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { requireDemosLaneContext } from "./isolated-context";
import { crawlDemoRoutes, expectNoMobileOverflow, expectPrimaryNavTappable } from "./route-crawl";

const { routes } = requireDemosLaneContext(process.env);

test("crawls every Margin Notes route and keeps the mobile chrome usable", async ({ page }) => {
  test.setTimeout(180_000);
  await crawlDemoRoutes(page, routes);
  await expectNoMobileOverflow(page, "/");
  await expectPrimaryNavTappable(page);
});

test("submitting a comment adds it to the list", async ({ page }) => {
  await page.goto(toSiteHref("/articles/the-quiet-hour"), { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name", { exact: true }).fill("Casey Demo");
  await page.getByLabel("Email", { exact: true }).fill("casey@example.com");
  // Not `exact: true` alone: the comment list carries `aria-label="Comments"`,
  // a substring match of "Comment" that `getByLabel` would otherwise resolve.
  await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Loved this piece, thanks for writing it up in such detail.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Posted locally/);
  await expect(page.getByRole("list", { name: "Comments" }).getByText("Casey Demo")).toBeVisible();
});
