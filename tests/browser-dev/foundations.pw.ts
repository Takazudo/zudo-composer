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
 *
 * #166's two library proofs are not here at all: the dev lane activates no
 * SiteProject, so no library on it can list. They live on the dist lane, in
 * `tests/browser/library-chrome.pw.ts`, which explains why.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createSitemap,
  expectNoHorizontalOverflow,
  expectSaved,
  gotoRoute,
  ROUTES,
  watchRuntimeFailures,
} from "./foundations-probe";

const RAIL_FIXTURE = "Foundations rail geometry";

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
