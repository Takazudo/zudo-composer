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
  // This ignored directory is entirely owned by this generator. Remove old
  // formats and deleted-story captures before writing the current inventory.
  await rm("public/sample-thumbnails", { recursive: true, force: true });
  await mkdir("public/sample-thumbnails", { recursive: true });
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
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  for (const entry of storyDescriptors) {
    const query = new URLSearchParams({
      slug: entry.slug,
      variant: entry.variants[0].exportName,
    });
    await page.goto(`${server.origin}${externalPreview.url}?${query}`);
    await page.waitForFunction(
      () => document.querySelector("[data-sg-variant-root]")?.childElementCount,
    );
    await page.waitForFunction(
      () => !document.querySelector(".zc-prose-md--pending"),
    );
    assert.equal(
      await page.locator(".zc-prose-md--error").count(),
      0,
      `${entry.slug}: markdown failed`,
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({
      path: `public/sample-thumbnails/${entry.slug}.png`,
      animations: "disabled",
    });
  }
  assert.deepEqual(
    errors,
    [],
    "Thumbnails must be actual successful browser renders",
  );
  console.log(
    `Captured ${storyDescriptors.length} actual settled Preact thumbnails.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
