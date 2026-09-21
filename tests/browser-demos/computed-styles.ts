import { expect, type Page } from "@playwright/test";
import { toSiteHref } from "../../src/features/delivery/routing";
import { readBodyBackgroundProbe } from "../../scripts/computed-body-background.mjs";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/**
 * Poll rather than sample once. This lane serves each host from its dev
 * server, where the styles entry defining `--color-bg` arrives with the
 * document's entry instead of in the initial HTML, and lands progressively:
 * before it applies, `body` and the probe both read the UA canvas, which
 * satisfies the equality check and only trips the transparency one. Polling
 * absorbs that window without weakening the contract — a host whose `body`
 * genuinely never tracks the token still fails, with the last mismatch as the
 * message.
 */
async function expectBodyTracksToken(page: Page, route: string, colorScheme: "light" | "dark"): Promise<string> {
  await expect
    .poll(
      async () => {
        const { body, probe } = await readBodyBackgroundProbe(page, colorScheme);
        if (body === TRANSPARENT) return `body and the --color-bg probe are both transparent (${body})`;
        if (body !== probe) return `body ${body} does not equal the --color-bg probe ${probe}`;
        return "ok";
      },
      { message: `${route} body background should compute from --color-bg in ${colorScheme} (#734)`, timeout: 15_000 },
    )
    .toBe("ok");
  return (await readBodyBackgroundProbe(page, colorScheme)).body;
}

/**
 * `body`'s background must compute from the live `--color-bg` token instead
 * of the UA canvas (#734), in both color schemes — and the two schemes must
 * actually differ, which is what proves the dark arm is alive rather than
 * reusing the light value. No demo host pins `data-theme` on `:root`
 * (colors.css follows `prefers-color-scheme` by default), so
 * `page.emulateMedia` alone drives the scheme here.
 *
 * Only for hosts whose styles entry imports the pack sheet that declares
 * `--color-bg` (`@zudo-composer/ui/styles/composer.css`) — among the demo
 * hosts, `demo-sample` alone. `demo-webshop`, `demo-landing` and `demo-blog`
 * are Tailwind v4 with no default theme and own private `shop-`/`land-`/
 * `blog-` token namespaces, so `--color-bg` is undefined there and the probe
 * reads transparent against a perfectly correct `body`. Calling this from
 * those specs would assert a token they deliberately do not use.
 */
export async function expectBodyBackgroundTracksColorScheme(page: Page, route: string): Promise<void> {
  await page.goto(toSiteHref(route), { waitUntil: "domcontentloaded" });
  await expect(page.locator("main#main-content"), `${route} should render the site page`).toBeVisible({ timeout: 30_000 });
  const light = await expectBodyTracksToken(page, route, "light");
  const dark = await expectBodyTracksToken(page, route, "dark");
  expect(light, `${route} light and dark body backgrounds should differ`).not.toBe(dark);
}
