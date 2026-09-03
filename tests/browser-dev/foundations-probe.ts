/**
 * Shared probes and fixtures for the two foundations specs (epic #156, issue
 * #166).
 *
 * Not a spec: the dev Playwright config collects only `.pw.ts` files and the
 * root vitest run collects only `.test.*` files, so this one is never itself a
 * suite — it is only ever imported.
 *
 * `foundations.pw.ts` and `foundations.coarse.pw.ts` are one deliverable split
 * across two lanes by filename suffix, so what they both need lives here.
 *
 * **The dev lane starts with no records.** "Sample Studio sitemap" and the rest
 * come from the bundled SiteProject sample, which the dist lane serves and
 * `pnpm dev` does not activate. Every fixture below is therefore built through
 * the UI, the way `outline-tree.responsive.pw.ts` does it — which also keeps
 * these specs independent of whatever that sample later contains.
 */

import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export const ROUTES = ["/", "/sitemapper", "/composer"] as const;

export type FoundationRoute = (typeof ROUTES)[number];

/**
 * `/composer` pulls the whole component pack, and `optimizeDeps.exclude` keeps
 * the provider out of Vite's prebundle, so its first dev-lane load is hundreds
 * of unbundled module requests. That is a dev-server cost, not a defect, and it
 * only ever delays a pass.
 */
const READY_TIMEOUT_MS = 60_000;

/**
 * How each route says it has finished rendering, so nothing is measured early.
 *
 * `/` and `/sitemapper` name their own heading. `/composer` deliberately does
 * not: it still runs its pre-epic chrome, #167 replaces that wholesale, and a
 * spec an unrelated sub-issue has to edit is a spec that gets edited wrongly.
 * It gates on the shell instead — the route painted into the content area — and
 * `gotoRoute` then waits out any busy state, which is all this spec needs before
 * reading console errors and overflow.
 */
const ROUTE_READY: Record<FoundationRoute, (page: Page) => Locator> = {
  "/": (page) => page.getByRole("heading", { name: "Build structures, not documents.", exact: true }),
  "/sitemapper": (page) => page.getByRole("heading", { name: "Sitemaps", exact: true }),
  "/composer": (page) => page.locator(".cms-shell-main > *").first(),
};

/** Console errors, page errors and failed requests, collected as they happen. */
export function watchRuntimeFailures(page: Page) {
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

/**
 * A horizontal-overflow failure that names the elements sticking out, rather
 * than a bare `false`: the culprit is what the next person needs.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return null;
    const limit = root.clientWidth;
    const culprits = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => Math.round(element.getBoundingClientRect().right) > limit + 1)
      .slice(0, 6)
      .map((element) => `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join("")}`);
    return { scrollWidth: root.scrollWidth, clientWidth: limit, culprits };
  });
  expect(overflow, `${label} scrolls horizontally`).toBeNull();
}

/** Open a route and wait until it has painted and stopped working. */
export async function gotoRoute(page: Page, route: FoundationRoute): Promise<void> {
  await page.goto(route);
  await expect(ROUTE_READY[route](page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
  // Nothing is measured on a route that still says it is busy — a route stuck
  // there fails here, naming the state it is stuck in.
  await expect(page.locator('.cms-shell-main [aria-busy="true"]'), `${route} is still busy`).toHaveCount(0, {
    timeout: READY_TIMEOUT_MS,
  });
}

/** The chrome's own promise that nothing is still queued for storage. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.locator(".cms-topbar__status")).toHaveAttribute("data-state", "saved");
}

/**
 * Build one Sitemap through the library's own dialog, and stay in the record
 * editor it navigates to. Creating is a real navigation to the record's URL,
 * so this is also how a deep link reaches the editor.
 */
export async function createSitemap(page: Page, name: string): Promise<void> {
  await gotoRoute(page, "/sitemapper");
  await page.getByRole("button", { name: "New sitemap" }).click();
  const dialog = page.getByRole("dialog", { name: "Create sitemap" });
  await dialog.getByRole("textbox", { name: "Sitemap name" }).fill(name);
  await dialog.getByRole("button", { name: "Create sitemap" }).click();
  await expect(page).toHaveURL(/\/sitemapper\?sitemap=/);
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue(name);
}

/** Create a Sitemap, then come back to the library that now lists it. */
export async function createSitemapAndReturn(page: Page, name: string): Promise<void> {
  await createSitemap(page, name);
  // The record is left through a real navigation, so it has to be on disk
  // first rather than sitting in the debounced save queue.
  await expectSaved(page);
  await gotoRoute(page, "/sitemapper");
}

/** One row of the Sitemap library table, found by the link that opens it. */
export function sitemapRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}
