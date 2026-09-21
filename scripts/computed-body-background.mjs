// @ts-check
/// <reference lib="dom" />
// The triple-slash directive above is only for the `page.evaluate` callback
// below, which runs inside the browser (not this Node process) and touches
// `document`/`getComputedStyle`.

// Shared by the demos lane (tests/browser-demos/computed-styles.ts) and the
// styleguide computed-style gate (check-sg-computed-styles.mjs): the same
// probe proves `body`'s background against the live `--color-bg` token
// instead of a hardcoded color serialisation (#734, packages/ui/styles/colors.css).

/** @typedef {import("@playwright/test").Page} Page */

/**
 * Emulate `colorScheme`, then read `document.body`'s computed background
 * alongside a probe element styled `background-color: var(--color-bg)` in the
 * same document. Comparing against the probe (rather than a hardcoded
 * `oklch(...)` serialisation) survives the token's own value changing.
 * @param {Page} page
 * @param {"light" | "dark"} colorScheme
 * @returns {Promise<{ body: string, probe: string }>}
 */
export async function readBodyBackgroundProbe(page, colorScheme) {
  await page.emulateMedia({ colorScheme });
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;background-color:var(--color-bg);";
    document.body.appendChild(probe);
    const body = getComputedStyle(document.body).backgroundColor;
    const probeColor = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { body, probe: probeColor };
  });
  /* eslint-enable no-undef */
}
