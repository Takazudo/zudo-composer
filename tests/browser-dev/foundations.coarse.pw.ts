/**
 * Foundations, coarse lane — touch targets and the narrow layout (epic #156,
 * issue #166).
 *
 * The `.coarse.pw.ts` suffix is load-bearing: `playwright.dev.config.ts` routes
 * this file to the coarse project only, a 390x844 touch viewport where
 * `@media (pointer: coarse)` actually applies. Renaming it would run these
 * assertions on a fine pointer, where every rule they check is switched off and
 * every one of them would pass while proving nothing — so the lane proves
 * itself before anything else is measured.
 *
 * The desktop half of #166 lives in `foundations.pw.ts`.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  gotoRoute,
  ROUTES,
  SAMPLE_SITEMAP,
  watchRuntimeFailures,
} from "./foundations-probe";

/**
 * Every control the coarse stylesheet blocks promise 44px to — the rail and
 * topbar in `shell.css`, the controls in `ui.css`, the overlays in
 * `overlay.css`, and the outline rows in `outline-tree.css`. The list is the
 * promise; this spec only checks it is kept.
 */
const TOUCH_TARGETS = [
  ".cms-rail__item",
  ".cms-topbar a",
  ".cms-topbar button",
  ".cms-btn",
  ".cms-seg__option",
  ".cms-pane__tab",
  ".cms-input",
  ".cms-select",
  ".cms-switch",
  ".cms-check",
  ".cms-menu__item",
  ".cms-dialog__action",
  ".cms-dialog__close",
  ".cms-tree-toggle",
  '[role="treeitem"]',
];

/** Controls with no label to widen them: they owe 44px in both axes. */
const SQUARE_TARGETS = [".cms-btn--icon", ".cms-dialog__close", ".cms-tree-toggle"];

const MIN_TARGET = 44;

interface TargetAudit {
  counted: number;
  undersized: { selector: string; name: string; width: number; height: number }[];
}

async function auditTouchTargets(page: Page): Promise<TargetAudit> {
  return page.evaluate(
    ({ selectors, square, minimum }) => {
      const seen = new Set<Element>();
      const undersized: TargetAudit["undersized"] = [];
      let counted = 0;
      for (const selector of selectors) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (seen.has(element)) continue;
          seen.add(element);
          const rect = element.getBoundingClientRect();
          // A control in a pane the narrow layout has hidden has no box at
          // all; it is not a touch target on this screen.
          if (rect.width === 0 && rect.height === 0) continue;
          counted += 1;
          const owesWidth = square.some((candidate) => element.matches(candidate));
          if (rect.height >= minimum && (!owesWidth || rect.width >= minimum)) continue;
          undersized.push({
            selector,
            name: element.getAttribute("aria-label") ?? (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 40),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
      return { counted, undersized };
    },
    { selectors: TOUCH_TARGETS, square: SQUARE_TARGETS, minimum: MIN_TARGET },
  );
}

test("the coarse lane is genuinely coarse, or nothing below proves anything", async ({ page }) => {
  await gotoRoute(page, "/");
  expect(
    await page.evaluate(() => ({
      coarse: window.matchMedia("(pointer: coarse)").matches,
      fine: window.matchMedia("(pointer: fine)").matches,
      hover: window.matchMedia("(hover: hover)").matches,
      width: window.innerWidth,
    })),
  ).toEqual({ coarse: true, fine: false, hover: false, width: 390 });
});

test("no CMS route scrolls sideways on a 390px touch screen", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  for (const route of ROUTES) {
    failures.length = 0;
    await gotoRoute(page, route);
    await expectNoHorizontalOverflow(page, route);
    expect(failures, route).toEqual([]);
  }
});

test("every control the coarse stylesheet promises 44px to gets it", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);

  await gotoRoute(page, "/");
  const dashboard = await auditTouchTargets(page);
  expect(dashboard.undersized, "dashboard touch targets").toEqual([]);
  // The rail alone contributes seven links, so a probe that found almost
  // nothing means the selectors have drifted, not that the screen is clean.
  expect(dashboard.counted).toBeGreaterThan(7);

  await gotoRoute(page, "/sitemapper");
  expect((await auditTouchTargets(page)).undersized, "sitemap library touch targets").toEqual([]);

  // The library's row menu and the create dialog are only in the DOM while
  // they are open, so both are opened rather than assumed.
  await page.getByRole("button", { name: `More actions for ${SAMPLE_SITEMAP}` }).click();
  await expect(page.getByRole("menu", { name: `${SAMPLE_SITEMAP} actions` })).toBeVisible();
  expect((await auditTouchTargets(page)).undersized, "row menu touch targets").toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New sitemap" }).click();
  await expect(page.getByRole("dialog", { name: "Create sitemap" })).toBeVisible();
  expect((await auditTouchTargets(page)).undersized, "create dialog touch targets").toEqual([]);
  await page.keyboard.press("Escape");

  // The record editor: the pane switch, the toolbar and the outline rows.
  await page.getByRole("link", { name: SAMPLE_SITEMAP, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue(SAMPLE_SITEMAP);
  const paneSwitch = page.getByRole("radiogroup", { name: "Pane" });
  await expect(paneSwitch).toBeVisible();
  for (const index of [0, 1, 2]) {
    await paneSwitch.getByRole("radio").nth(index).click();
    expect((await auditTouchTargets(page)).undersized, `editor pane ${index} touch targets`).toEqual([]);
  }
  await expectNoHorizontalOverflow(page, "/sitemapper record editor");

  expect(failures).toEqual([]);
});
