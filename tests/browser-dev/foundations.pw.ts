/**
 * Foundations — the real-browser invariants the rebuilt CMS chrome rests on
 * (epic #156, issue #166).
 *
 * Everything here is something a unit test cannot answer: whether a document
 * actually scrolls sideways, whether a portalled panel really escapes a
 * scrollport's clip, whether persisted geometry survives a reload, and what a
 * document's module graph and stylesheet list actually contain.
 *
 * This file runs on the desktop project only — `playwright.dev.config.ts`
 * routes by filename suffix. The coarse half of #166 (44px targets and the
 * narrow layout under a real coarse pointer) lives in
 * `foundations.coarse.pw.ts`, because `@media (pointer: coarse)` is switched
 * off here and every one of those assertions would pass vacuously.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createSitemap,
  createSitemapAndReturn,
  expectNoHorizontalOverflow,
  expectSaved,
  gotoRoute,
  ROUTES,
  sitemapRow,
  watchRuntimeFailures,
} from "./foundations-probe";

// One fixture name per test: contexts are isolated, and a distinct name makes
// a trace say which test built the record it is looking at.
const RAIL_FIXTURE = "Foundations rail geometry";
const MENU_FIXTURE = "Foundations row menu";
const FOCUS_FIXTURE = "Foundations focus return";

/**
 * Shell-only paths. In the dev lane every module and stylesheet keeps its
 * source path, so a request URL or Vite's `data-vite-dev-id` names it exactly.
 */
const SHELL_MODULES = [
  "/src/style.css",
  "/src/App.tsx",
  "/src/app/shell",
  "/src/app/rail",
  "/src/app/topbar",
  "/src/components/library-page",
  "/src/components/editor-chrome",
  "/src/components/outline-tree",
] as const;

/** The persisted half of the editor's geometry, plus what it actually painted. */
async function readRailGeometry(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".cms-editor__body");
    if (body === null) throw new Error("The editor body left the page mid-measurement.");
    const paneWidth = (pane: string): number | null => {
      const region = body.querySelector<HTMLElement>(`[data-pane="${pane}"]`);
      return region === null ? null : Math.round(region.getBoundingClientRect().width);
    };
    return {
      navVar: body.style.getPropertyValue("--nav-w"),
      inspVar: body.style.getPropertyValue("--insp-w"),
      navWidth: paneWidth("nav"),
      navCollapsed: body.classList.contains("nav-collapsed"),
      inspCollapsed: body.classList.contains("insp-collapsed"),
    };
  });
}

test("every CMS route loads clean and never scrolls sideways", async ({ page }) => {
  test.setTimeout(300_000);
  const failures = watchRuntimeFailures(page);

  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const route of ROUTES) {
      const label = `${route} at ${size.width}x${size.height}`;
      failures.length = 0;
      await gotoRoute(page, route);
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      await expectNoHorizontalOverflow(page, label);
      expect(failures, label).toEqual([]);
    }
  }
});

test("the editor remembers its rail widths and collapse across a reload", async ({ page }) => {
  test.setTimeout(180_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await createSitemap(page, RAIL_FIXTURE);

  const start = await readRailGeometry(page);
  expect(start.navCollapsed).toBe(false);
  expect(start.inspCollapsed).toBe(false);

  // The separator is a real ARIA splitter, so the width is moved the way a
  // keyboard user moves it rather than by writing localStorage from the test.
  const navResizer = page.getByRole("separator", { name: "Resize Pages" });
  await navResizer.focus();
  for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowRight");

  const widened = await readRailGeometry(page);
  expect(widened.navWidth).not.toBeNull();
  const widenedNav = Number.parseFloat(widened.navVar);
  expect(widenedNav).toBeGreaterThan(Number.parseFloat(start.navVar));
  await expect(navResizer).toHaveAttribute("aria-valuenow", String(Math.round(widenedNav)));
  // The custom property is not decoration: it is the grid track.
  expect(Math.abs(widened.navWidth! - widenedNav)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Hide Inspector" }).click();
  await expect(page.getByRole("button", { name: "Show Inspector" })).toBeVisible();
  await expectSaved(page);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue(RAIL_FIXTURE);
  const restored = await readRailGeometry(page);
  expect(restored.navVar).toBe(widened.navVar);
  expect(restored.inspCollapsed).toBe(true);
  expect(restored.navCollapsed).toBe(false);
  await expect(page.getByRole("button", { name: "Show Inspector" })).toBeVisible();

  // Both directions, or "persistence" would only mean "collapse is sticky".
  await page.getByRole("button", { name: "Show Inspector" }).click();
  await expect(page.getByRole("button", { name: "Hide Inspector" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue(RAIL_FIXTURE);
  const reopened = await readRailGeometry(page);
  expect(reopened.inspCollapsed).toBe(false);
  expect(reopened.navVar).toBe(widened.navVar);

  expect(failures).toEqual([]);
});

test("a row menu opens outside the library table's scrollport, unclipped", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // With no records the library renders its empty state and there is no table
  // to be clipped by, so the row this proof needs is created first.
  await createSitemapAndReturn(page, MENU_FIXTURE);

  // The wrapper is the sticky header's scrollport, so it clips its content
  // whether or not the table currently overflows. If that ever stops being
  // true this whole proof is vacuous, which is why it is asserted first.
  const wrap = page.locator(".cms-table-wrap");
  await expect(wrap).toHaveCSS("overflow-x", "auto");
  await expect(wrap).toHaveCSS("overflow-y", "auto");

  const row = sitemapRow(page, MENU_FIXTURE);
  await row.hover();
  const trigger = row.getByRole("button", { name: `More actions for ${MENU_FIXTURE}` });
  await trigger.click();
  const menu = page.getByRole("menu", { name: `${MENU_FIXTURE} actions` });
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
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await createSitemapAndReturn(page, FOCUS_FIXTURE);

  const newSitemap = page.getByRole("button", { name: "New sitemap" });
  await newSitemap.click();
  const dialog = page.getByRole("dialog", { name: "Create sitemap" });
  await expect(dialog.getByRole("textbox", { name: "Sitemap name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Create sitemap" })).toHaveCount(0);
  await expect(newSitemap).toBeFocused();

  const row = sitemapRow(page, FOCUS_FIXTURE);
  await row.hover();
  const trigger = row.getByRole("button", { name: `More actions for ${FOCUS_FIXTURE}` });
  await trigger.click();
  const menu = page.getByRole("menu", { name: `${FOCUS_FIXTURE} actions` });
  await expect(menu.getByRole("menuitem", { name: "Open", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: `${FOCUS_FIXTURE} actions` })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  expect(failures).toEqual([]);
});

test("the isolated preview document loads no shell stylesheet and no shell module", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await page.goto("/composer/preview");
  await expect(page.locator("html")).toHaveAttribute("data-composer-preview-doc", "");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  // A direct refresh takes the same branch, so the graph is proven twice.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-composer-preview-doc", "");

  const sheets = await page.evaluate(() =>
    [...document.styleSheets].map((sheet) => {
      const owner = sheet.ownerNode as Element | null;
      return sheet.href ?? owner?.getAttribute("data-vite-dev-id") ?? owner?.getAttribute("href") ?? "";
    }),
  );

  // The preview styles itself, so "no shell stylesheet" cannot pass by the
  // document having no stylesheets at all.
  expect(sheets.some((href) => href.includes("/preview.css"))).toBe(true);
  for (const shellModule of SHELL_MODULES) {
    expect(sheets.filter((href) => href.includes(shellModule)), `${shellModule} stylesheet`).toEqual([]);
    expect(requested.filter((url) => url.includes(shellModule)), `${shellModule} module`).toEqual([]);
  }

  expect(failures).toEqual([]);
});
