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
import { routesForFiles } from "./hosted-demo/doc-site-artifact.mjs";
import { startHostedDemoStaticServer } from "./hosted-demo/static-server.mjs";

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

// #785/#769: the mobile sidebar drawer toggle is `lg:hidden`, so it never
// renders (or matters) at the desktop viewport the two checks above use. It
// needs its own narrow context/page rather than the shared `page` below.
const DRAWER_VIEWPORT = { width: 390, height: 844 };
const islandSelector = '[data-zfb-island="SidebarToggle"]';
const toggleButtonSelector = `${islandSelector} > button[aria-label="Open sidebar"]`;
const backdropSelector = `${islandSelector} > div[aria-hidden="true"]`;

/**
 * Poll the toggle button's `aria-expanded` attribute until it reaches
 * `expected`, returning the last observed value (which may still differ from
 * `expected` on timeout — callers assert on the return value so failures
 * carry the actual state). The island hydrates lazily (`data-when="visible"`),
 * so a value read immediately after a click or key press races React's
 * re-render.
 * @param {import("@playwright/test").Page} page
 * @param {"true" | "false"} expected
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
async function pollAriaExpanded(page, expected, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let actual = await page.locator(toggleButtonSelector).getAttribute("aria-expanded");
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => { setTimeout(resolveDelay, 50); });
    actual = await page.locator(toggleButtonSelector).getAttribute("aria-expanded");
  }
  return actual;
}

/**
 * Click the toggle button and wait for `aria-expanded` to reach `expected`,
 * retrying the click itself (not just the poll) a few times: the island's
 * click handler may not be attached yet on the very first click after
 * navigation, since `data-when="visible"` hydrates asynchronously and the
 * server-rendered button exists in the DOM before that happens.
 * @param {import("@playwright/test").Page} page
 * @param {"true" | "false"} expected
 * @param {string} context a short label (route + color scheme) for failure messages
 */
async function clickToggleAndWaitForAriaExpanded(page, expected, context) {
  const button = page.locator(toggleButtonSelector);
  let lastObserved = await button.getAttribute("aria-expanded");
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts && lastObserved !== expected; attempt += 1) {
    await button.click();
    lastObserved = await pollAriaExpanded(page, expected, 500);
  }
  assert.equal(
    lastObserved,
    expected,
    `${context}: toggle button aria-expanded never reached "${expected}" after ${maxAttempts} click attempts (last observed "${lastObserved}") — either the drawer fix regressed or the island (data-when="visible") never hydrated.`,
  );
}

/**
 * Run the full #785/#769 drawer proof against an already-navigated,
 * already-theme-pinned page: open via click, confirm the toggle (not the
 * backdrop) owns its own hit-tested point and its X icon is visible, close
 * via click, reopen, close via Escape, and confirm focus returns to the
 * toggle. Returns a diagnostic summary for the caller to log.
 * @param {import("@playwright/test").Page} page
 * @param {string} route
 * @param {"light" | "dark"} colorScheme
 */
async function verifyDrawerInteractions(page, route, colorScheme) {
  const context = `${route} (${colorScheme}, ${DRAWER_VIEWPORT.width}x${DRAWER_VIEWPORT.height})`;
  const button = page.locator(toggleButtonSelector);

  await clickToggleAndWaitForAriaExpanded(page, "true", context);

  const box = await button.boundingBox();
  assert.ok(box, `${context}: toggle button has no bounding box while open — is it hidden by an "lg:hidden" breakpoint mismatch at this viewport?`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  const hit = await page.evaluate(
    ({ x, y, toggleButtonSelector, backdropSelector }) => {
      const target = document.elementFromPoint(x, y);
      const toggle = document.querySelector(toggleButtonSelector);
      const backdrop = document.querySelector(backdropSelector);
      return {
        tag: target?.tagName ?? null,
        className: target instanceof Element ? target.className.toString() : "",
        zIndex: target ? getComputedStyle(target).zIndex : null,
        isToggleOrDescendant: !!(target && toggle && (target === toggle || toggle.contains(target))),
        isBackdrop: !!(target && backdrop && (target === backdrop || backdrop.contains(target))),
        toggleZIndex: toggle ? getComputedStyle(toggle).zIndex : null,
        backdropZIndex: backdrop ? getComputedStyle(backdrop).zIndex : null,
      };
    },
    { x: point.x, y: point.y, toggleButtonSelector, backdropSelector },
  );
  /* eslint-enable no-undef */
  assert.ok(
    hit.isToggleOrDescendant,
    `${context}: document.elementFromPoint(${point.x}, ${point.y}) at the open toggle's centre hit <${hit.tag ?? "nothing"} class="${hit.className}"> (z-index ${hit.zIndex}${hit.isBackdrop ? ", the backdrop" : ""}) instead of the toggle button (z-index ${hit.toggleZIndex}, backdrop z-index ${hit.backdropZIndex}) — the backdrop or another layer is stealing the click again (#785).`,
  );

  const iconDisplays = await button.evaluate(
    // eslint-disable-next-line no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process
    (element) => Array.from(element.querySelectorAll("svg")).map((svg) => getComputedStyle(svg).display),
  );
  const [xIconDisplay] = iconDisplays;
  assert.notEqual(
    xIconDisplay,
    "none",
    `${context}: toggle button's first <svg> (the X/close icon) computed display:none while the drawer is open (icons observed: [${iconDisplays.join(", ")}]) — the inline HIDDEN_ICON_STYLE swap regressed (zudo-doc#4355).`,
  );

  await clickToggleAndWaitForAriaExpanded(page, "false", context);
  const backdropDisplayAfterClose = await page.locator(backdropSelector).evaluate(
    // eslint-disable-next-line no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process
    (element) => getComputedStyle(element).display,
  );
  assert.equal(
    backdropDisplayAfterClose,
    "none",
    `${context}: backdrop still computes display:"${backdropDisplayAfterClose}" after closing the drawer via click.`,
  );

  await clickToggleAndWaitForAriaExpanded(page, "true", context);
  await page.keyboard.press("Escape");
  const ariaExpandedAfterEscape = await pollAriaExpanded(page, "false");
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  const focus = await page.evaluate(
    (toggleButtonSelector) => {
      const toggle = document.querySelector(toggleButtonSelector);
      const active = document.activeElement;
      return {
        returnedToToggle: active === toggle,
        activeTag: active?.tagName ?? null,
        activeLabel: active instanceof Element ? (active.getAttribute("aria-label") ?? active.className.toString()) : "",
      };
    },
    toggleButtonSelector,
  );
  /* eslint-enable no-undef */
  assert.equal(
    ariaExpandedAfterEscape,
    "false",
    `${context}: Escape did not close the drawer (aria-expanded observed "${ariaExpandedAfterEscape}") (#769).`,
  );
  assert.ok(
    focus.returnedToToggle,
    `${context}: after Escape closed the drawer, focus landed on <${focus.activeTag ?? "nothing"} ${focus.activeLabel}> instead of returning to the toggle button (#769).`,
  );

  return {
    route,
    colorScheme,
    elementFromPointTag: hit.tag,
    toggleZIndex: hit.toggleZIndex,
    backdropZIndex: hit.backdropZIndex,
    viewport: `${DRAWER_VIEWPORT.width}x${DRAWER_VIEWPORT.height}`,
  };
}

/**
 * Find a route rendering the drawer toggle island and run the full open /
 * close-by-click / reopen / close-by-Escape proof against it in both color
 * schemes, in its own 390×844 context (the toggle is `lg:hidden`, so the
 * shared desktop `page` above never renders it).
 * @param {import("@playwright/test").Browser} browser
 * @param {string} baseUrl
 * @param {string[]} routes
 */
async function verifyMobileDrawer(browser, baseUrl, routes) {
  const browserContext = await browser.newContext({ viewport: DRAWER_VIEWPORT });
  try {
    const page = await browserContext.newPage();
    /** @type {string | undefined} */
    let drawerRoute;
    for (const route of routes) {
      await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "load" });
      if (await page.locator(toggleButtonSelector).count() > 0) {
        drawerRoute = route;
        break;
      }
    }
    assert.ok(
      drawerRoute,
      `No page under styleguide/sample/dist renders "${toggleButtonSelector}" — add (or fix) a catalog page with the mobile sidebar toggle island so the drawer proof (#785/#769) has something to prove itself against. Checked routes: ${routes.join(", ") || "(none)"}`,
    );

    const measurements = [];
    for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
      await pinCatalogTheme(page, colorScheme);
      measurements.push(await verifyDrawerInteractions(page, drawerRoute, colorScheme));
    }
    return measurements;
  } finally {
    await browserContext.close();
  }
}

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

    const drawerMeasurements = await verifyMobileDrawer(browser, server.url, routes);

    console.log(`Styleguide computed styles verified on ${flowRoute}: "${flowSelector}" margin-top ${marginTop}; body background ${bodyColors.light} light / ${bodyColors.dark} dark.`);
    for (const measurement of drawerMeasurements) {
      console.log(`Mobile drawer verified on ${measurement.route} (${measurement.colorScheme}, ${measurement.viewport}): open elementFromPoint hit <${measurement.elementFromPointTag}> inside the toggle (toggle z-index ${measurement.toggleZIndex}, backdrop z-index ${measurement.backdropZIndex}); click-close, reopen, and Escape-close with focus return all verified (#785, #769).`);
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
