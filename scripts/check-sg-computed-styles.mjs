// @ts-check
/// <reference lib="dom" />
// The triple-slash directive above is only for the `page.locator(...).evaluate`
// callback below, which runs inside the browser (not this Node process) and
// touches `getComputedStyle`.

// Two computed styles fixed under epic #771 are proven by no automated gate
// (#786): the built page's `body` background computing from the live
// `--color-bg` token instead of the UA canvas (#734), and `.zd-content > * +
// *` computing a non-zero `margin-top` (#768 — an unlayered preflight beat
// `@layer zd-flow`). "The rule is in the file" is not "the rule wins the
// cascade". This proves both against the already-built sample styleguide
// catalog (`styleguide/sample/dist`). It never builds the catalog itself —
// run `pnpm sg:build-site` first.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";
import { readBodyBackgroundProbe } from "./computed-body-background.mjs";

/**
 * The catalog pins its own theme: its inline bootstrap runs `applyTheme`,
 * which sets `data-theme` AND an inline `style.colorScheme` on `<html>` from
 * the stored choice (falling back to `prefers-color-scheme` read once, at
 * load). An inline `color-scheme` beats the media query, so `emulateMedia`
 * alone cannot switch this document — it reported identical light and dark
 * backgrounds. Drive the host's own pin instead, exactly as #786 anticipated
 * for a theme-pinning host.
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} colorScheme
 */
async function pinCatalogTheme(page, colorScheme) {
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  await page.evaluate((mode) => {
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.style.colorScheme = mode;
  }, colorScheme);
  /* eslint-enable no-undef */
}
import { routesForFiles } from "./hosted-demo/doc-site-artifact.mjs";
import { startHostedDemoStaticServer } from "./hosted-demo/static-server.mjs";

const root = resolve(import.meta.dirname, "..");
const distDirectory = join(root, "styleguide/sample/dist");

if (!existsSync(distDirectory)) {
  throw new Error(`Missing styleguide/sample/dist — run "pnpm sg:build-site" before "pnpm sg:computed-styles" (this script never builds the catalog itself).`);
}

const htmlPaths = (await readdir(distDirectory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name) === ".html")
  .map((entry) => relative(distDirectory, join(entry.parentPath, entry.name)).split(sep).join("/"));
const routes = routesForFiles(htmlPaths);
if (routes.length === 0) {
  throw new Error(`styleguide/sample/dist has no HTML pages — rebuild it with "pnpm sg:build-site".`);
}

// Nested try/finally so a `chromium.launch()` failure after the server is
// already listening still closes the server instead of leaking it.
const server = await startHostedDemoStaticServer({ directory: distDirectory, port: 0 });
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const flowSelector = ".zd-content > * + *";
    /** @type {string | undefined} */
    let flowRoute;
    for (const route of routes) {
      await page.goto(new URL(route, server.url).toString(), { waitUntil: "load" });
      if (await page.locator(flowSelector).count() > 0) {
        flowRoute = route;
        break;
      }
    }
    assert.ok(
      flowRoute,
      `No page under styleguide/sample/dist renders ".zd-content" with at least two flow children — add (or fix) a catalog story with a multi-block ProseMd/prose body so the flow-margin rule (#768) has something to prove itself against. Checked routes: ${routes.join(", ") || "(none)"}`,
    );

    // eslint-disable-next-line no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process
    const marginTop = await page.locator(flowSelector).first().evaluate((element) => getComputedStyle(element).marginTop);
    assert.notEqual(marginTop, "0px", `${flowRoute}: "${flowSelector}" computed margin-top to 0px — the flow-space rule is losing the cascade again (#768).`);

    const TRANSPARENT = "rgba(0, 0, 0, 0)";
    /** @type {Record<"light" | "dark", string>} */
    const bodyColors = { light: "", dark: "" };
    for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
      await pinCatalogTheme(page, colorScheme);
      const { body, probe } = await readBodyBackgroundProbe(page, colorScheme);
      assert.equal(body, probe, `${flowRoute}: body background does not equal the --color-bg token in ${colorScheme} (#734).`);
      assert.notEqual(body, TRANSPARENT, `${flowRoute}: body background is transparent in ${colorScheme} (#734).`);
      bodyColors[colorScheme] = body;
    }
    assert.notEqual(bodyColors.light, bodyColors.dark, `${flowRoute}: light and dark body backgrounds are identical — the dark color scheme never engaged despite pinning data-theme.`);

    console.log(`Styleguide computed styles verified on ${flowRoute}: "${flowSelector}" margin-top ${marginTop}; body background ${bodyColors.light} light / ${bodyColors.dark} dark.`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
