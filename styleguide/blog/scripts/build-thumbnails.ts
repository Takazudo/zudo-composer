import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { chromium, type Browser } from "@playwright/test";
import { storyDescriptors } from "../src/styleguide/descriptors";
import { externalPreview } from "../src/config/preview.mjs";
import { servePreview } from "./preview-static-server.mjs";

const server = await servePreview("public");
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  await rm("public/blog-thumbnails", { recursive: true, force: true });
  await mkdir("public/blog-thumbnails", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 480 },
    colorScheme: "light",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  // Real route-aware fixtures require an iframe parent. This capture-only
  // document is served through Playwright, never written into public output.
  await page.route(`${server.origin}/__thumbnail-host`, (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>',
  }));
  await page.goto(`${server.origin}/__thumbnail-host`);
  for (const entry of storyDescriptors) {
    assert(entry.variants.some((variant) => variant.exportName === "WithContent"));
    const query = new URLSearchParams({ slug: entry.slug, variant: "WithContent" });
    const url = `${server.origin}${externalPreview.url}?${query}`;
    await page.evaluate((src) => {
      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.title = "Component thumbnail";
      iframe.style.cssText = "display:block;border:0;width:800px;height:480px";
      document.body.replaceChildren(iframe);
    }, url);
    const iframe = page.locator("iframe");
    const handle = await iframe.elementHandle();
    const frame = await handle?.contentFrame();
    assert(frame, `${entry.slug}: actual preview frame missing`);
    await frame.waitForFunction(
      () => document.querySelector("[data-sg-variant-root]")?.childElementCount,
    );
    await frame.evaluate(async () => {
      await document.fonts.ready;
      for (const image of document.images) image.loading = "eager";
      await Promise.all([...document.images].map((image) => image.decode()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await iframe.screenshot({
      path: `public/blog-thumbnails/${entry.slug}.png`,
      animations: "disabled",
    });
  }
  assert.deepEqual(errors, [], "Thumbnails must be actual successful browser renders");
  console.log(`Captured ${storyDescriptors.length} actual settled Preact WithContent iframe thumbnails.`);
} finally {
  await browser?.close();
  await server.close();
}
