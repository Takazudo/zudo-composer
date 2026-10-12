import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { externalPreview, previewFrameSelector } from "../src/config/preview.mjs";
import { servePreview } from "../scripts/preview-static-server.mjs";
const host = fileURLToPath(new URL("../", import.meta.url));
const evidence = process.env.SG_EVIDENCE_DIR ?? join(host, ".landing-build/evidence");
await mkdir(evidence, { recursive: true });
const descriptorSource = await readFile(join(host, "src/styleguide/descriptors.ts"), "utf8");
const corpus = JSON.parse(descriptorSource.slice(descriptorSource.indexOf("export const storyDescriptors = ") + 32, descriptorSource.lastIndexOf(" satisfies StoryDescriptor[];")));
assert.equal(corpus.length, 30);
assert.equal(corpus.reduce((sum, story) => sum + story.variants.length, 0), 90);
assert(corpus.every((story) => story.variants.every((variant) => !variant.controls)), "Do not invent controls absent from the authored demo corpus");
const server = await servePreview(join(host, "dist"));
let browser;
let context;
let page;
const report = { host: "landing", checks: [], variants: 0 };
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), headless: true });
  context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const selector = `${previewFrameSelector}[src*="variant=WithContent"]`;
  // The mobile drawer (inert, lg:hidden) precedes the desktop sidebar in the DOM, so an unscoped link lookup matches an invisible element first.
  const openContainer = async () => {
    const link = page.getByRole("complementary", { name: "Documentation sidebar" }).getByRole("link", { name: "Container", exact: true });
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/components\/container\/?$/);
    await expect(page.locator(previewFrameSelector).first()).toBeVisible();
  };
  await page.goto(`${server.origin}/`);
  await page.getByRole("link", { name: "Components", exact: true }).click();
  await openContainer();
  await expect(page.locator('fieldset[aria-busy="false"]')).toBeVisible();
  const frame = page.frameLocator(selector);
  await expect(frame.locator("[data-sg-variant-root]")).not.toBeEmpty();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Copy source", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('from "demo-landing/components"');
  await page.getByRole("button", { name: "Follow catalog", exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  report.checks.push("Actual pack source copy, detail workbench readiness and resolved/follow-catalog theme");

  const css = page.locator('.cm-content[contenteditable="true"]').last();
  await css.fill(".sg-preview-root { outline: 7px solid rgb(255, 0, 0); }");
  await expect(frame.locator(".sg-preview-root")).toHaveCSS("outline-width", "7px");
  const height = await page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
  await css.fill(".sg-preview-root { outline: 7px solid rgb(255, 0, 0); } body { padding-top: 120px; padding-bottom: 120px; }");
  await expect(frame.locator("body")).toHaveCSS("padding-top", "120px");
  await expect(frame.locator("body")).toHaveCSS("padding-bottom", "120px");
  report.heightProbe = await frame.locator("body").evaluate((body) => ({
    paddingTop: getComputedStyle(body).paddingTop,
    paddingBottom: getComputedStyle(body).paddingBottom,
    borderHeight: body.getBoundingClientRect().height,
    contentHeight: body.clientHeight - parseFloat(getComputedStyle(body).paddingTop) - parseFloat(getComputedStyle(body).paddingBottom),
    expectedHeight: Math.ceil(body.getBoundingClientRect().bottom + scrollY),
  }));
  await expect.poll(() => page.locator(selector).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(height + 200);
  await expect.poll(async () => {
    const actual = await page.locator(selector).evaluate((element) => element.getBoundingClientRect().height);
    const expected = await frame.locator("body").evaluate((body) => Math.ceil(body.getBoundingClientRect().bottom + scrollY));
    return Math.abs(actual - expected);
  }).toBeLessThanOrEqual(1);
  await css.fill("");
  const before = await page.locator("#sg-code-panel").evaluate((element) => element.getBoundingClientRect().width);
  const separator = page.getByRole("separator", { name: "Resize code panel" });
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  const box = await separator.boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 65, box.y + box.height / 2);
  await page.mouse.up();
  await expect.poll(() => page.locator("#sg-code-panel").evaluate((element) => element.getBoundingClientRect().width)).not.toBe(before);
  report.checks.push("Live CSS alters actual frame computed style and height; code panel keyboard/pointer resize");

  await page.getByRole("button", { name: "Preview tokens", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  const token = page.getByRole("textbox", { name: "--color-land-bg value", exact: true });
  await expect(token).toBeVisible();
  await token.fill("rgb(12, 34, 56)");
  await page.keyboard.press("Tab");
  await expect(frame.locator("body")).toHaveCSS("background-color", "rgb(12, 34, 56)");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  for (let round = 0; round < 2; round++) {
    await page.locator("#sg-preview-tokens-trigger").click();
    await expect(page.getByRole("button", { name: "Close panel", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.getByRole("link", { name: "Design Tokens", exact: true }).click();
    await expect(page).toHaveURL(/\/tokens\/?$/);
    await page.locator("#sg-preview-tokens-trigger").click();
    await expect(page.getByRole("button", { name: "Close panel", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.getByRole("link", { name: "Components", exact: true }).click();
    await openContainer();
    await expect(page.locator('fieldset[aria-busy="false"]')).toBeVisible();
  }
  report.checks.push("Populated detail/header/dashboard token entry points, actual computed token edit, disabled Apply, reopen and repeated SPA navigation");

  await page.locator(selector).evaluate((iframe) => {
    window.__previewProof = [];
    window.addEventListener("message", (event) => {
      if (event.source === iframe.contentWindow && event.origin === location.origin) window.__previewProof.push(event.data);
    });
    iframe.contentWindow.postMessage({ type: "sg:requestReady", v: 1, slug: "container", variant: "WithContent" }, location.origin);
  });
  await expect.poll(() => page.evaluate(() => window.__previewProof.some((message) => message.type === "sg:ready" && message.v === 1 && message.slug === "container" && message.variant === "WithContent"))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__previewProof.some((message) => message.type === "sg:height" && message.v === 1 && message.slug === "container" && message.variant === "WithContent" && Number.isFinite(message.height) && message.height > 0))).toBe(true);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  for (const invalid of [{ v: 2 }, { v: undefined }, { slug: "wrong" }, { variant: "wrong" }]) {
    await page.locator(selector).evaluate((iframe, invalid) => {
      iframe.contentWindow.postMessage({ type: "sg:setTheme", v: 1, slug: "container", variant: "WithContent", theme: "dark", ...invalid }, location.origin);
    }, invalid);
    await page.waitForTimeout(60);
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  }
  for (const invalid of [{ origin: "https://wrong.example" }, { badSource: true }]) {
    await frame.locator("html").evaluate((_, invalid) => {
      window.dispatchEvent(new MessageEvent("message", { origin: invalid.origin ?? location.origin, source: invalid.badSource ? window : parent, data: { type: "sg:setTheme", v: 1, theme: "dark", slug: "container", variant: "WithContent" } }));
    }, invalid);
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "light");
  }
  report.checks.push("Public v1 readiness replay/positive scoped height and synthetic wrong origin/source/version/identity rejection");

  await page.goto(`${server.origin}/components`);
  const thumbnails = page.locator('img[src^="/landing-thumbnails/"]');
  await expect(thumbnails).toHaveCount(30);
  await thumbnails.evaluateAll(async (images) => { for (const image of images) image.loading = "eager"; await Promise.all(images.map((image) => image.decode())); });
  assert(await thumbnails.evaluateAll((images) => images.every((image) => image.naturalWidth === 800 && image.naturalHeight === 480)));
  await page.screenshot({ path: join(evidence, "catalog.png"), fullPage: true });

  // Every actual variant renders in a same-origin iframe; this is necessary
  // for Blog's authored route fixtures and isolates its history from catalog.
  await page.route(`${server.origin}/__variant-proof`, (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(`${server.origin}/__variant-proof`);
  for (const story of corpus) {
    for (const variant of story.variants) {
      const src = `${server.origin}${externalPreview.url}?${new URLSearchParams({ slug: story.slug, variant: variant.exportName })}`;
      await page.evaluate((src) => { const frame = document.createElement("iframe"); frame.src = src; frame.style.cssText = "width:100%;height:900px;border:0"; document.body.replaceChildren(frame); }, src);
      const iframe = await page.locator("iframe").elementHandle();
      const actual = await iframe.contentFrame();
      assert(actual);
      await expect(actual.locator("[data-sg-variant-root]")).toHaveCount(1);
      // Empty layout slots still render elements; text emptiness is not a
      // rendering failure. These exact defaults intentionally return null in
      // the actual pack source (empty image URL/spec rows/tag values).
      const nullDefaults = [];
      if (variant.exportName === "PackDefaults" && nullDefaults.includes(story.slug)) {
        assert.equal(await actual.locator("[data-sg-variant-root]").evaluate((element) => element.childElementCount), 0, `${story.slug}: retain null default rendering`);
      } else {
        await expect.poll(() => actual.locator("[data-sg-variant-root]").evaluate((element) => element.childElementCount)).toBeGreaterThan(0);
      }
      assert.deepEqual(await actual.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => new URL(link.href).pathname)), ["/_landing-preview/main.css"]);
      assert.equal(await page.evaluate(() => location.pathname), "/__variant-proof", "Fixture must never mutate parent history");
      if (variant.exportName === "WithContent" && story.slug === "pricing-table") {
        const toggle = actual.getByRole("switch", { name: "Bill yearly" });
        const before = await actual.locator("[data-price]").allTextContents();
        const checked = await toggle.getAttribute("aria-checked");
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", checked === "true" ? "false" : "true");
        await expect.poll(() => actual.locator("[data-price]").allTextContents()).not.toEqual(before);
        await expect(actual.locator("article[data-billing]").first()).toHaveAttribute("data-billing", checked === "true" ? "monthly" : "yearly");
        report.checks.push("Actual pricing switch changes tier billing and prices");
      }
      if (variant.exportName === "WithContent" && story.slug === "signup-form") {
        await actual.getByRole("button", { name: "Create my calendar" }).click();
        await expect(actual.getByLabel("Work email")).toHaveAttribute("aria-invalid", "true");
        await actual.getByLabel("Work email").fill("catalog@example.com");
        await actual.getByLabel("Team size").selectOption({ index: 1 });
        await actual.getByRole("button", { name: "Create my calendar" }).click();
        await expect(actual.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
        await expect(actual.locator("form")).toHaveCount(0);
        report.checks.push("Actual signup validation and local success panel");
      }
      report.variants++;
    }
  }
  assert.equal(report.variants, 90);
  const last = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert(last);
  await last.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect(last.locator("#landing-preview")).toBeEmpty();
  assert.deepEqual(errors, [], "All variants and shell paths must render without browser errors");
  report.checks.push("All 90 actual variants in isolated Preact frames, actual PNG inventory and pagehide disposal");
  report.result = "PASS";
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = "FAIL";
  report.error = String(error);
  report.url = page?.url();
  await Promise.allSettled([
    page?.content().then((html) => writeFile(join(evidence, "failure-dom.html"), html)),
    page?.screenshot({ path: join(evidence, "failure.png"), fullPage: true }),
  ]);
  await context?.tracing.stop({ path: join(evidence, "failure-trace.zip") }).catch(() => {});
  throw error;
}
finally {
  if (report.result === "PASS") await context?.tracing.stop().catch(() => {});
  await writeFile(join(evidence, "result.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  await server.close();
}
