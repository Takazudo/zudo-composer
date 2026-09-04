/**
 * Library chrome in a real browser (epic #156, issue #166).
 *
 * Two proofs about the shared library page that a unit test cannot give: that
 * a row menu really escapes the table's scroll clipping, and that focus really
 * comes back to what opened a menu or a dialog.
 *
 * They live on the **dist** lane rather than beside the rest of #166 in
 * `tests/browser-dev/`, and the reason is worth writing down because it is not
 * obvious and it cost an iteration to find:
 *
 *   `pnpm dev` activates no SiteProject. Without one, `provider-integration`
 *   fails `verifyRegistry()` and every library — compositions, content,
 *   mapping, sitemaps alike — initializes into "No development SiteProject is
 *   activated", so no library on the dev lane ever renders a table. Creating
 *   and editing a record still works there, because those go through
 *   `provider.store` directly rather than through `initialization.initialize()`
 *   — which is why `outline-tree.responsive.pw.ts` passes on that lane and
 *   why the record-editor half of #166 does too. A *listing* is the one thing
 *   the dev lane cannot produce.
 *
 * Neither proof below needs `pnpm dev` for anything else: both want a desktop
 * viewport and a populated library, which is exactly what the dist lane serves
 * from the bundled SiteProject sample. Activating a project for the dev lane is
 * a real option and a better long-term answer — see the note in
 * `tests/browser-dev/foundations-probe.ts` — but it changes what that lane
 * means and is not this sub-issue's call to make.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const SAMPLE_SITEMAP = "Sample Studio sitemap";

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText;
    if (errorText === "net::ERR_ABORTED") return;
    failures.push(`request: ${request.url()} (${errorText})`);
  });
  return failures;
}

function sitemapRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function openSitemapLibrary(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  await expect(sitemapRow(page, SAMPLE_SITEMAP)).toHaveCount(1);
}

test("a row menu opens outside the library table's scrollport, unclipped", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await openSitemapLibrary(page);

  // The wrapper is the sticky header's scrollport, so it clips its content
  // whether or not the table currently overflows. If that ever stops being
  // true this whole proof is vacuous, which is why it is asserted first.
  const wrap = page.locator(".cms-table-wrap");
  await expect(wrap).toHaveCSS("overflow-x", "auto");
  await expect(wrap).toHaveCSS("overflow-y", "auto");

  const row = sitemapRow(page, SAMPLE_SITEMAP);
  await row.hover();
  const trigger = row.getByRole("button", { name: `More actions for ${SAMPLE_SITEMAP}` });
  await trigger.click();
  const menu = page.getByRole("menu", { name: `${SAMPLE_SITEMAP} actions` });
  await expect(menu).toBeVisible();

  // The control that opened the menu really is inside the clip; only the panel
  // escaped it.
  expect(
    await trigger.evaluate((element) => document.querySelector(".cms-table-wrap")?.contains(element) ?? false),
  ).toBe(true);

  const geometry = await menu.evaluate((panel) => {
    const scrollport = document.querySelector(".cms-table-wrap");
    if (scrollport === null) throw new Error("The table scrollport left the page mid-measurement.");
    const panelRect = panel.getBoundingClientRect();
    const wrapRect = scrollport.getBoundingClientRect();
    // Edge midpoints rather than corners: the panel has a border radius, and a
    // point just inside a rounded corner is outside the painted shape.
    const probes: readonly (readonly [number, number])[] = [
      [(panelRect.left + panelRect.right) / 2, panelRect.top + 4],
      [(panelRect.left + panelRect.right) / 2, panelRect.bottom - 4],
      [panelRect.left + 4, (panelRect.top + panelRect.bottom) / 2],
      [panelRect.right - 4, (panelRect.top + panelRect.bottom) / 2],
      [(panelRect.left + panelRect.right) / 2, (panelRect.top + panelRect.bottom) / 2],
    ];
    return {
      panelInsideScrollport: scrollport.contains(panel),
      // Nothing is proven if the panel happens to fit inside the clip anyway.
      panelReachesPastScrollport: panelRect.bottom > wrapRect.bottom || panelRect.top < wrapRect.top,
      insideViewport:
        panelRect.top >= 0 &&
        panelRect.left >= 0 &&
        panelRect.bottom <= window.innerHeight &&
        panelRect.right <= window.innerWidth,
      probes: probes.map(([x, y]) => panel.contains(document.elementFromPoint(x, y))),
    };
  });

  expect(geometry.panelInsideScrollport).toBe(false);
  expect(geometry.panelReachesPastScrollport).toBe(true);
  expect(geometry.insideViewport).toBe(true);
  // Hit-testing, not just geometry: a panel painted under the table's own
  // background would still measure as visible.
  expect(geometry.probes).toEqual([true, true, true, true, true]);

  expect(failures).toEqual([]);
});

test("focus returns to the trigger when a menu or a dialog closes", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await openSitemapLibrary(page);

  const newSitemap = page.getByRole("button", { name: "New sitemap" });
  await newSitemap.click();
  const dialog = page.getByRole("dialog", { name: "Create sitemap" });
  await expect(dialog.getByRole("textbox", { name: "Sitemap name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Create sitemap" })).toHaveCount(0);
  await expect(newSitemap).toBeFocused();

  const row = sitemapRow(page, SAMPLE_SITEMAP);
  await row.hover();
  const trigger = row.getByRole("button", { name: `More actions for ${SAMPLE_SITEMAP}` });
  await trigger.click();
  const menu = page.getByRole("menu", { name: `${SAMPLE_SITEMAP} actions` });
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: `${SAMPLE_SITEMAP} actions` })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  expect(failures).toEqual([]);
});
