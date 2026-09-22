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
// Neither the button nor the backdrop may be matched on the attribute values
// that the drawer's own state flips: the button's `aria-label` swaps
// "Open sidebar" -> "Close sidebar" and the backdrop's `aria-hidden` swaps
// "true" -> "false" the moment the drawer opens. Pinning either value makes
// every post-open query silently match nothing.
const toggleButtonSelector = `${islandSelector} > button[aria-expanded]`;
const backdropSelector = `${islandSelector} > div[aria-hidden]`;
// Focus has to be moved off the toggle before Escape, or the #769 focus-return
// assertion cannot fail: clicking the toggle open already leaves focus on it.
const drawerFocusTargetSelector = `${islandSelector} aside[data-zd-mobile-sidebar] input`;
const ATTRIBUTE_TIMEOUT_MS = 5_000;
const CLICK_TIMEOUT_MS = 5_000;

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
  const read = () => page.locator(toggleButtonSelector).getAttribute("aria-expanded", { timeout: ATTRIBUTE_TIMEOUT_MS });
  let actual = await read();
  while (actual !== expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => { setTimeout(resolveDelay, 50); });
    actual = await read();
  }
  return actual;
}

/**
 * Hit-test the centre of the toggle button and report who owns that point,
 * with the z-indexes that decide it. This is the #785 measurement, and also
 * the diagnostic for a click Playwright refused to deliver.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{
 *   point: { x: number, y: number },
 *   target: string,
 *   targetAncestors: string,
 *   targetZIndex: string | null,
 *   isToggleOrDescendant: boolean,
 *   isBackdrop: boolean,
 *   toggleZIndex: string | null,
 *   backdropZIndex: string | null,
 * } | null>}
 */
async function describeToggleHitTest(page) {
  const box = await page.locator(toggleButtonSelector).boundingBox().catch(() => null);
  if (!box) return null;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  const hit = await page.evaluate(
    ({ x, y, toggleSelector, backdropSelector: backdropQuery }) => {
      // `getAttribute("class")`, never `.className`: on an SVG element
      // `className` is an SVGAnimatedString and stringifies to the useless
      // "[object SVGAnimatedString]" — and elementFromPoint at the toggle's
      // centre lands on the icon's <path>, so that is the common case.
      /** @param {Element | null} element */
      const describe = (element) => {
        if (!(element instanceof Element)) return "nothing";
        const className = element.getAttribute("class");
        return `<${element.tagName.toLowerCase()}${className ? ` class="${className}"` : ""}>`;
      };
      /** @param {Element | null} element */
      const ancestorsOf = (element) => {
        const tags = [];
        for (let node = element?.parentElement; node && tags.length < 4; node = node.parentElement) {
          tags.push(node.tagName.toLowerCase());
        }
        return tags.join(" < ") || "(none)";
      };
      const target = document.elementFromPoint(x, y);
      const toggle = document.querySelector(toggleSelector);
      const backdrop = document.querySelector(backdropQuery);
      return {
        target: describe(target),
        targetAncestors: ancestorsOf(target),
        targetZIndex: target ? getComputedStyle(target).zIndex : null,
        isToggleOrDescendant: !!(target && toggle && (target === toggle || toggle.contains(target))),
        isBackdrop: !!(target && backdrop && (target === backdrop || backdrop.contains(target))),
        toggleZIndex: toggle ? getComputedStyle(toggle).zIndex : null,
        backdropZIndex: backdrop ? getComputedStyle(backdrop).zIndex : null,
      };
    },
    { x: point.x, y: point.y, toggleSelector: toggleButtonSelector, backdropSelector },
  );
  /* eslint-enable no-undef */
  return { point, ...hit };
}

/**
 * Render a hit test as the one sentence a CI reader needs.
 * @param {Awaited<ReturnType<typeof describeToggleHitTest>>} hit
 */
function formatHitTest(hit) {
  if (!hit) return "the toggle's centre point could not be hit-tested (no bounding box, or the page was no longer evaluable)";
  return `document.elementFromPoint(${hit.point.x}, ${hit.point.y}) at the toggle's centre hit ${hit.target} (ancestors ${hit.targetAncestors}, z-index ${hit.targetZIndex}${hit.isBackdrop ? " — the backdrop" : ""}); toggle z-index ${hit.toggleZIndex}, backdrop z-index ${hit.backdropZIndex}`;
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
  let lastObserved = await button.getAttribute("aria-expanded", { timeout: ATTRIBUTE_TIMEOUT_MS });
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts && lastObserved !== expected; attempt += 1) {
    try {
      await button.click({ timeout: CLICK_TIMEOUT_MS });
    } catch (error) {
      // Playwright's own actionability check fails with an opaque timeout when
      // something covers the button — which is exactly the #785 regression this
      // proves absent. Re-raise with the hit test that explains it. The hit
      // test is itself guarded: a page that is closed or unevaluable would
      // otherwise reject here and replace the click failure it exists to
      // explain, dropping `cause` with it.
      const hit = await describeToggleHitTest(page).catch(() => null);
      throw new Error(
        `${context}: Playwright refused to deliver the click to the toggle button (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — ${formatHitTest(hit)}. A layer covering the toggle is the #785 regression.`,
        { cause: error },
      );
    }
    lastObserved = await pollAriaExpanded(page, expected, 500);
  }
  assert.equal(
    lastObserved,
    expected,
    `${context}: toggle button aria-expanded never reached "${expected}" after ${maxAttempts} click attempts (last observed "${lastObserved}") — either the drawer fix regressed or the island (data-when="visible") never hydrated.`,
  );
}

/**
 * Move keyboard focus onto a control inside the open drawer, returning a short
 * description of it (or `null` if it could not be focused).
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string | null>}
 */
async function focusInsideDrawer(page) {
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  return await page.evaluate((selector) => {
    const target = document.querySelector(selector);
    if (!(target instanceof HTMLElement)) return null;
    target.focus();
    return document.activeElement === target ? `<${target.tagName.toLowerCase()} ${target.getAttribute("aria-label") ?? ""}>` : null;
  }, drawerFocusTargetSelector);
  /* eslint-enable no-undef */
}

/**
 * Close the open drawer with Escape and report the resulting `aria-expanded`.
 *
 * Focus is moved into the drawer before every press: clicking the toggle open
 * already leaves focus on the toggle, so pressing Escape from there would make
 * the focus-return half of #769 unfalsifiable.
 *
 * The press is retried for the same reason the click is. The island's
 * document-level keydown listener is attached by an effect that runs after the
 * commit which flips `aria-expanded`, so an Escape sent the instant the
 * attribute reads "true" is reliably swallowed — measured here: the first press
 * is lost every time, the second always closes the drawer. Retrying is bounded,
 * so an Escape handler that never lands still fails the gate.
 * @param {import("@playwright/test").Page} page
 * @param {string} context
 * @returns {Promise<string>} a description of the control focus was moved to before the closing press
 */
async function pressEscapeAndWaitForClose(page, context) {
  const maxAttempts = 10;
  let lastObserved = await page.locator(toggleButtonSelector).getAttribute("aria-expanded", { timeout: ATTRIBUTE_TIMEOUT_MS });
  let focusMovedInto = null;
  for (let attempt = 0; attempt < maxAttempts && lastObserved !== "false"; attempt += 1) {
    focusMovedInto = await focusInsideDrawer(page);
    assert.ok(
      focusMovedInto,
      `${context}: could not move focus onto "${drawerFocusTargetSelector}" inside the open drawer — without that the focus-return assertion proves nothing, because clicking the toggle open already leaves focus on the toggle (#769).`,
    );
    await page.keyboard.press("Escape");
    lastObserved = await pollAriaExpanded(page, "false", 500);
  }
  assert.equal(
    lastObserved,
    "false",
    `${context}: Escape did not close the drawer after ${maxAttempts} presses with focus moved into the drawer (${focusMovedInto}) — aria-expanded last observed "${lastObserved}" (#769).`,
  );
  assert.ok(focusMovedInto, `${context}: the drawer was already closed before Escape was pressed, so #769 was never exercised.`);
  return focusMovedInto;
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

  const hit = await describeToggleHitTest(page);
  assert.ok(
    hit,
    `${context}: toggle button has no bounding box while open — is it hidden by an "lg:hidden" breakpoint mismatch at this viewport?`,
  );
  assert.ok(
    hit.isToggleOrDescendant,
    `${context}: ${formatHitTest(hit)} — that point belongs to neither the toggle button nor its icon, so the backdrop or another layer is stealing the click again (#785).`,
  );

  // Without a rendered backdrop the hit test above cannot fail, so the #785
  // proof would pass vacuously on a build whose backdrop stopped rendering.
  const backdropDisplayWhileOpen = await page.locator(backdropSelector).evaluate(
    // eslint-disable-next-line no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process
    (element) => getComputedStyle(element).display,
  );
  assert.notEqual(
    backdropDisplayWhileOpen,
    "none",
    `${context}: backdrop computes display:none while the drawer is open, so nothing was competing for the toggle's point and the hit test above proves nothing (#785).`,
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
  // #780's restore condition for the retired host override is literally "two
  // icons appear", and the assertion above cannot see it: `notEqual` passes
  // for a second visible <svg> and passes on `undefined` when the button
  // renders no <svg> at all. Count instead. Measured on the built catalog the
  // open state is ["block", "none"] — the X shown, the hamburger hidden.
  const renderedIcons = iconDisplays.filter((display) => display !== "none");
  assert.equal(
    renderedIcons.length,
    1,
    `${context}: expected exactly one visible <svg> in the toggle button while the drawer is open, observed ${renderedIcons.length} (icons observed: [${iconDisplays.join(", ")}]) — restore the host's unlayered SidebarToggle override (UPSTREAM-NOTES item 11, #780).`,
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
  const focusMovedInto = await pressEscapeAndWaitForClose(page, context);
  /* eslint-disable no-undef -- this callback runs inside the browser via page.evaluate, not in this Node process */
  const focus = await page.evaluate(
    (toggleSelector) => {
      const toggle = document.querySelector(toggleSelector);
      const active = document.activeElement;
      return {
        returnedToToggle: active === toggle,
        activeTag: active?.tagName.toLowerCase() ?? null,
        activeLabel: active instanceof Element ? (active.getAttribute("aria-label") ?? active.getAttribute("class") ?? "") : "",
      };
    },
    toggleButtonSelector,
  );
  /* eslint-enable no-undef */
  assert.ok(
    focus.returnedToToggle,
    `${context}: after Escape closed the drawer, focus stayed on <${focus.activeTag ?? "nothing"} ${focus.activeLabel}> instead of returning from ${focusMovedInto} to the toggle button (#769).`,
  );

  return {
    route,
    colorScheme,
    elementFromPoint: hit.target,
    point: hit.point,
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
      console.log(`Mobile drawer verified on ${measurement.route} (${measurement.colorScheme}, ${measurement.viewport}): open elementFromPoint(${measurement.point.x}, ${measurement.point.y}) hit ${measurement.elementFromPoint} inside the toggle (toggle z-index ${measurement.toggleZIndex}, backdrop z-index ${measurement.backdropZIndex}); X icon visible, click-close, reopen, and Escape-close with focus return all verified (#785, #769).`);
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
