/**
 * The library table on a touch screen (epic #156, issue #174).
 *
 * `ui.css`'s coarse block makes two promises about a table that nothing could
 * check until now, because checking them needs a coarse pointer AND a populated
 * library at the same time:
 *
 *   .cms-table th, .cms-table td { height: 44px }   (40px / 34px on a fine pointer)
 *   .cms-table__actions > * { opacity: 1 }          (0 until hover, and there is no hover here)
 *
 * The dev lane owns the only coarse project but activates no SiteProject, so no
 * library there ever renders a table; the dist lane serves the bundled sample
 * but had only a desktop project. `playwright.config.ts` now routes this file
 * to a coarse project of its own — the `.coarse.pw.ts` suffix is load-bearing,
 * and renaming it would run these assertions on a fine pointer where every rule
 * they check is switched off and all of them would pass while proving nothing.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const SAMPLE_SITEMAP = "Sample Studio sitemap";

/** What the coarse block raises `th`'s 34px and `td`'s 40px to. */
const COARSE_HEIGHT = 44;

async function openSitemapLibrary(page: Page): Promise<void> {
  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: SAMPLE_SITEMAP, exact: true })).toHaveCount(1);
}

test("the coarse lane is genuinely coarse, or nothing below proves anything", async ({ page }) => {
  await page.goto("/");
  expect(
    await page.evaluate(() => ({
      coarse: window.matchMedia("(pointer: coarse)").matches,
      fine: window.matchMedia("(pointer: fine)").matches,
      hover: window.matchMedia("(hover: hover)").matches,
      width: window.innerWidth,
    })),
  ).toEqual({ coarse: true, fine: false, hover: false, width: 390 });
});

test("every library table cell is a 44px touch target", async ({ page }) => {
  await openSitemapLibrary(page);

  const cells = await page.evaluate(() => {
    const table = document.querySelector(".cms-table");
    if (!table) return null;
    // The `height` the rule sets, read back off the box: a row's hairline rule
    // adds a pixel to every cell except the last row's, which drops it, so the
    // raw rect alternates between 44 and 45 and says nothing on its own.
    const measure = (selector: string) =>
      [...table.querySelectorAll<HTMLElement>(selector)]
        .filter((cell) => cell.getBoundingClientRect().height > 0)
        .map((cell) => Math.round(cell.getBoundingClientRect().height - parseFloat(getComputedStyle(cell).borderBottomWidth)));
    return { th: measure("th"), td: measure("tbody tr:not(.cms-table__empty-row) td") };
  });

  expect(cells, "the sitemap library rendered no table").not.toBeNull();
  expect(cells!.th.length, "header cells").toBeGreaterThan(0);
  expect(cells!.td.length, "body cells").toBeGreaterThan(0);
  // Exact, not a floor. A floor would be met by the fine-pointer 34 and 40 the
  // moment some tall control grew a cell, and would then pass on a lane where
  // the coarse block never applied at all.
  expect([...new Set(cells!.th)], "header cell heights").toEqual([COARSE_HEIGHT]);
  expect([...new Set(cells!.td)], "body cell heights").toEqual([COARSE_HEIGHT]);
});

test("row actions are visible without a hover that this screen cannot produce", async ({ page }) => {
  await openSitemapLibrary(page);

  const trigger = page.getByRole("button", { name: `More actions for ${SAMPLE_SITEMAP}` });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveCSS("opacity", "1");

  // And it is operable by touch, not merely painted: the menu it owns opens.
  await trigger.tap();
  await expect(page.getByRole("menu", { name: `${SAMPLE_SITEMAP} actions` })).toBeVisible();
});

test("the library does not scroll sideways at 390px — the table scrolls inside its wrapper", async ({ page }) => {
  await openSitemapLibrary(page);

  await expect(page.locator(".cms-table-wrap")).toHaveCSS("overflow-x", "auto");
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return null;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      culprits: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => Math.round(element.getBoundingClientRect().right) > root.clientWidth + 1)
        .slice(0, 6)
        .map((element) => `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join("")}`),
    };
  });
  expect(overflow, "the sitemap library scrolls horizontally").toBeNull();
});
