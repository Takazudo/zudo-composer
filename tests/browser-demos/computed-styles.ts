import { expect, type Page } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { readBodyBackgroundProbe } from "../../scripts/computed-body-background.mjs";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/**
 * `body`'s background must compute from the live `--color-bg` token instead
 * of the UA canvas (#734), in both color schemes — and the two schemes must
 * actually differ, which is what proves the dark arm is alive rather than
 * reusing the light value. No demo host pins `data-theme` on `:root`
 * (colors.css follows `prefers-color-scheme` by default), so
 * `page.emulateMedia` alone drives the scheme here.
 */
export async function expectBodyBackgroundTracksColorScheme(page: Page, route: string): Promise<void> {
  await page.goto(toSiteHref(route), { waitUntil: "domcontentloaded" });
  const colors: Record<"light" | "dark", string> = { light: "", dark: "" };
  for (const colorScheme of ["light", "dark"] as const) {
    const { body, probe } = await readBodyBackgroundProbe(page, colorScheme);
    expect(body, `${route} body background should equal the --color-bg token in ${colorScheme}`).toBe(probe);
    expect(body, `${route} body background should not be transparent in ${colorScheme}`).not.toBe(TRANSPARENT);
    colors[colorScheme] = body;
  }
  expect(colors.light, `${route} light and dark body backgrounds should differ`).not.toBe(colors.dark);
}
