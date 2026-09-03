/**
 * Shared probes for the two foundations specs (epic #156, issue #166).
 *
 * Not a spec: the dev Playwright config collects only `.pw.ts` files and the
 * root vitest run collects only `.test.*` files, so this one is never itself a
 * suite — it is only ever imported.
 *
 * `foundations.pw.ts` and `foundations.coarse.pw.ts` are one deliverable split
 * across two lanes by filename suffix, so the route table and the two probes
 * they both need live here rather than being copied into each.
 */

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const ROUTES = ["/", "/sitemapper", "/composer"] as const;

export type FoundationRoute = (typeof ROUTES)[number];

/** The heading each route has finished rendering by, so nothing is measured early. */
export const ROUTE_HEADINGS: Record<FoundationRoute, string> = {
  "/": "Build structures, not documents.",
  "/sitemapper": "Sitemaps",
  "/composer": "Composition library",
};

export const SAMPLE_SITEMAP = "Sample Studio sitemap";

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

/** Wait for the route to be on screen before anything is measured on it. */
export async function gotoRoute(page: Page, route: FoundationRoute): Promise<void> {
  await page.goto(route);
  await expect(page.getByRole("heading", { name: ROUTE_HEADINGS[route], exact: true })).toBeVisible({ timeout: 30_000 });
}
