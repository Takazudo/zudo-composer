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
 * SiteProject, so no library on it can list. They live on the host lane, in
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
} from "./foundations-probe";
import { watchRuntimeFailures } from "../runtime-failures";
import { ensureDevWorkspace } from "./workspace-bootstrap";

/**
 * Mirrors `PREVIEW_PENDING_COPY` in `src/features/delivery/preview-strip.tsx`
 * as a literal rather than an import: that module pulls in
 * `preview-strip.css?inline`, which only Vite (not the Playwright test
 * runner) knows how to resolve.
 */
const PREVIEW_STRIP_PENDING_COPY = "The editor has unsaved changes — this preview updates when they are saved.";

/**
 * Generous enough for a working-preview capture plus the trailing-edge
 * re-capture debounce (`RECAPTURE_DEBOUNCE_MS`, `site-delivery.tsx`) to
 * settle. The design (#797) is deliberately eventually consistent, so this
 * spec polls rather than asserting synchronously.
 */
const RECAPTURE_READY_TIMEOUT_MS = 60_000;

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

/**
 * The editor chrome's own height token. A document that never loaded the
 * editor's sheet resolves it to the empty string, which is how a preview
 * proves it is not inheriting the chrome's cascade.
 */
function editorTopbarToken(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--zc-topbar-h").trim());
}

/** Every stylesheet the document actually has, named by source path in the dev lane. */
function readStyleSheets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.styleSheets].map((sheet) => {
      const owner = sheet.ownerNode as Element | null;
      return sheet.href ?? owner?.getAttribute("data-vite-dev-id") ?? owner?.getAttribute("href") ?? "";
    }),
  );
}

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
      if (size.width <= 760) {
        await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Navigation", exact: true }).getByRole("navigation", { name: "Main navigation" })).toBeVisible();
        await page.keyboard.press("Escape");
      } else await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
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
  // `base.css` is gone from this graph (#717), so the editor's own chrome
  // tokens must not resolve here either.
  expect(await editorTopbarToken(page)).toBe("");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  // A direct refresh takes the same branch, so the graph is proven twice.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-composer-preview-doc", "");

  const sheets = await readStyleSheets(page);

  // The preview styles itself, so "no shell stylesheet" cannot pass by the
  // document having no stylesheets at all.
  expect(sheets.some((href) => href.includes("/preview.css"))).toBe(true);
  for (const shellModule of SHELL_MODULES) {
    expect(sheets.filter((href) => href.includes(shellModule)), `${shellModule} stylesheet`).toEqual([]);
    expect(requested.filter((url) => url.includes(shellModule)), `${shellModule} module`).toEqual([]);
  }

  expect(failures).toEqual([]);
});

test("every delivery path is its own visitor document, on a direct load and on a reload", async ({ page }) => {
  test.setTimeout(120_000);
  // Bootstrapped here rather than inherited from an earlier test in this file:
  // `/website-preview` is now asserted to build the site's own page, so this
  // spec needs a workspace even when Playwright is given a `-g` filter (which
  // `run-dev-browser.mjs` passes straight through to a fresh disposable root).
  // It runs before the listeners below so the shell modules the dashboard loads
  // are not recorded as this document's own requests.
  await ensureDevWorkspace(page);
  const failures = watchRuntimeFailures(page);
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  // `/site` has no activated release on this lane, so it can only prove the
  // document; `/website-preview` also proves the page whenever the lane's
  // workspace compiles a route.
  for (const path of ["/website-preview", "/website-preview/about", "/site"]) {
    for (const load of ["direct", "reload"] as const) {
      if (load === "direct") await page.goto(path); else await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-site-preview-doc", "");
      await expect(page.locator(".zc-preview-strip")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
      expect(await editorTopbarToken(page), `${path} (${load})`).toBe("");
      await expect(page.locator("main#main-content, main[data-site-delivery-state]").first()).toBeVisible();
      // With the Assets store seeded (#824), `/website-preview` always builds
      // the site's own page. `/site` has no activated release on this lane and
      // renders the `Site unavailable` state by design, so it stays on the
      // alternative locator above instead of this stricter assertion.
      if (path !== "/site") await expect(page.locator("main#main-content")).toBeVisible();
    }
  }

  const sheets = await readStyleSheets(page);
  // The visitor sheet is loaded, so "no shell stylesheet" cannot pass by the
  // document having no stylesheets at all.
  expect(sheets.some((href) => href.includes("/visitor.css"))).toBe(true);
  for (const shellModule of SHELL_MODULES) {
    expect(sheets.filter((href) => href.includes(shellModule)), `${shellModule} stylesheet`).toEqual([]);
    expect(requested.filter((url) => url.includes(shellModule)), `${shellModule} module`).toEqual([]);
  }

  expect(failures).toEqual([]);
});

test("the sitemap canvas geometry stays fixed after opening", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sitemapper?provider=sitemap-filesystem&sitemap=sample-studio-sitemap&page=home-node");
  await page.getByRole("radio", { name: "Canvas", exact: true }).click();
  const scroller = page.locator(".sg-sitemapper-canvas__scroll");
  await expect(scroller.locator(".sg-sitemapper-node-wrap").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const sample = () => scroller.evaluate((element) => {
    const stage = element.querySelector<HTMLElement>(".sg-sitemapper-canvas__stage")!;
    return {
      scrollHeight: element.scrollHeight,
      stageTop: getComputedStyle(stage).top,
      documentHeight: document.scrollingElement!.scrollHeight,
    };
  });
  // Let initial node measurements settle, then compare independent samples.
  await page.waitForTimeout(1000);
  const first = await sample();
  await page.waitForTimeout(1200);
  expect(await sample()).toEqual(first);
  expect(failures).toEqual([]);
});

/**
 * Confirm sub-issue (epic #794, issue #798): a fresh edit reaches a newly
 * opened working preview. `/website-preview` has no activated release on this
 * lane, so it always resolves to the `working-preview` source (#797) this
 * epic instruments.
 *
 * The rail's "Website preview" item is a plain `target="_blank"` anchor
 * (#795) — nothing here calls `window.open` itself, so a real pop-up-blocked
 * click would leave this spec with no `page` event at all rather than a
 * failing assertion. Taking the new tab from the browser context's `page`
 * event, instead of `window.open`ing it directly, is what proves that.
 */
test("a fresh edit in the editor reaches a newly opened working preview", async ({ page, context }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  // `run-dev-browser.mjs` now seeds this lane's workspace with the sample's
  // committed Assets bytes (#824), so every asset reference the bootstrapped
  // content makes should resolve. Recording every 404 keeps the guard tight:
  // the assertion below requires the list to be empty.
  const notFound: string[] = [];
  page.on("response", (response) => { if (response.status() === 404) notFound.push(new URL(response.url()).pathname); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ensureDevWorkspace(page);
  await page.goto("/composer?provider=files&composition=home-page");
  await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue("Home page");
  const structure = page.locator(".cms-editor__region--nav");
  await structure.getByRole("treeitem", { name: /^Hero(?:\s|$)/ }).click();
  const heading = page.getByRole("textbox", { name: "Heading" });
  await expect(heading).toHaveValue("Clear ideas, carefully shaped");
  const edited = `Preview flush check ${Date.now()}`;
  await heading.fill(edited);
  await expect(heading).toHaveValue(edited);

  // No wait between the edit and the click: this is the race the epic
  // closes. A click on the anchor blurs the field (landing its debounced
  // commit) and fires the anchor's own pointerdown flush before the browser
  // opens the tab — but the design does not depend on either winning that
  // race, since the working preview re-captures on the committed write
  // whenever it lands.
  const previewLink = page.getByRole("link", { name: "Website preview — choose preview source", exact: true });
  const newPagePromise = context.waitForEvent("page");
  await previewLink.click();
  const preview = await newPagePromise;
  const previewFailures = watchRuntimeFailures(preview);
  await preview.waitForLoadState("domcontentloaded");

  await expect(preview.locator("main#main-content, main[data-site-delivery-state]").first()).toBeVisible({ timeout: RECAPTURE_READY_TIMEOUT_MS });

  // Leaving the pending state is one side of the proof, and it exercises the
  // whole chain: the anchor's head-start flush commits the in-field edit, the
  // editor broadcasts the transition (#796), and this document's reader
  // clears the indicator (#797). Eventually consistent by design, hence the
  // poll rather than a synchronous read.
  const status = preview.locator(".zc-preview-strip").getByRole("status");
  await expect(status).not.toHaveText(PREVIEW_STRIP_PENDING_COPY, { timeout: RECAPTURE_READY_TIMEOUT_MS });

  // The other side: the newly opened preview actually rendered the edit.
  // `run-dev-browser.mjs` now seeds this lane's `ZUDO_ASSETS_STORE_ROOT` from
  // the sample's committed Assets bytes (#824), so the bootstrapped content's
  // asset references resolve and the working preview can build the
  // composition instead of reporting "Site build blocked: Required Assets
  // asset is missing."
  await expect(preview.locator("main#main-content")).toContainText(edited, { timeout: RECAPTURE_READY_TIMEOUT_MS });

  await preview.close();

  // The seeded store means every asset reference should resolve, so any 404
  // at all is a real failure now.
  expect(notFound).toEqual([]);
  expect(failures).toEqual([]);
  expect(previewFailures).toEqual([]);
});
