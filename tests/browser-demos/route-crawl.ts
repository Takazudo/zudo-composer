import { expect, type Page } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { watchRuntimeFailures } from "../runtime-failures";

/**
 * Every compiled route, twice: on direct navigation and after a reload, both
 * 200, with an `h1`, and zero console errors or failed requests across the
 * whole crawl.
 */
export async function crawlDemoRoutes(page: Page, routes: readonly string[]): Promise<void> {
  const failures = watchRuntimeFailures(page);
  for (const route of routes) {
    const path = toSiteHref(route);
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${path} should respond 200`).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    const reloaded = await page.reload({ waitUntil: "domcontentloaded" });
    expect(reloaded?.status(), `${path} should respond 200 after reload`).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  expect(failures, failures.join("\n")).toEqual([]);
}

/** No horizontal scroll at the narrowest phone size the chrome supports. */
export async function expectNoMobileOverflow(page: Page, route: string): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(toSiteHref(route), { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return scrollingElement.scrollWidth <= document.documentElement.clientWidth;
  })).toBe(true);
}

/**
 * Every visible primary nav link is at least 44px tall. Pass `opensViaToggle`
 * for a header that hides its inline nav behind a mobile toggle button — the
 * click auto-waits for that button, avoiding a race against SPA hydration
 * right after the navigation `expectNoMobileOverflow` just did. The page is
 * already at the 375px viewport that navigation set.
 */
export async function expectPrimaryNavTappable(page: Page, options: { opensViaToggle?: RegExp } = {}): Promise<void> {
  if (options.opensViaToggle) await page.getByRole("button", { name: options.opensViaToggle }).click();
  const links = page.locator('nav[aria-label="Primary"] a:visible');
  await expect.poll(() => links.count()).toBeGreaterThan(0);
  const heights = await links.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
}
