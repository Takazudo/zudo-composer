import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  externalPreview,
  previewFrameSelector,
} from "../src/config/preview.mjs";
import { servePreview } from "../scripts/preview-static-server.mjs";
const hostRoot = fileURLToPath(new URL("../", import.meta.url));
const evidence =
  process.env.SAMPLE_EVIDENCE_DIR ?? join(hostRoot, ".sample-build/evidence");
await mkdir(evidence, { recursive: true });
const server = await servePreview(join(hostRoot, "dist"));
const browser = await chromium
  .launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    headless: true,
  })
  .catch(async (error) => {
    await server.close();
    throw error;
  });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1100 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
const url = server.origin;
const interactiveFrameSelector = `${previewFrameSelector}[src*="variant=Interactive"]`;
try {
  await page.goto(url + "/");
  await page.getByRole("link", { name: "Components", exact: true }).click();
  await page.getByRole("link", { name: "Card", exact: true }).first().click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Preview protocol proof");
  const frame = page.frameLocator(interactiveFrameSelector);
  await expect(
    frame.getByRole("heading", { name: "Preview protocol proof" }),
  ).toBeVisible();
  const initialHeight = await page
    .locator(interactiveFrameSelector)
    .evaluate((e) => e.getBoundingClientRect().height);
  await title.fill("Height proof ".repeat(90));
  await expect
    .poll(() =>
      page
        .locator(interactiveFrameSelector)
        .evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBeGreaterThan(initialHeight);
  await title.fill("Preview protocol proof");
  console.log("height synchronization passed");
  const paddingBefore = await frame
    .locator("[data-sg-variant-root] > div")
    .evaluate((e) => getComputedStyle(e).paddingTop);
  await page.getByRole("combobox", { name: /^Padding/ }).selectOption("lg");
  await expect
    .poll(() =>
      frame
        .locator("[data-sg-variant-root] > div")
        .evaluate((e) => getComputedStyle(e).paddingTop),
    )
    .not.toBe(paddingBefore);
  console.log("controls passed");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .poll(() => frame.locator("html").getAttribute("data-theme"))
    .toBe("dark");
  await page.getByRole("button", { name: "Copy source", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("import { Card, ProseP }");
  await page
    .getByRole("button", { name: "Follow catalog", exact: true })
    .click();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect
    .poll(() => frame.locator("html").getAttribute("data-theme"))
    .toBe("light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .poll(() => frame.locator("html").getAttribute("data-theme"))
    .toBe("dark");
  console.log("theme, catalog follow and copy passed");
  const css = page.locator('.cm-content[contenteditable="true"]').last();
  await css.fill("h3 { color: rgb(255, 0, 0) !important; }");
  await expect
    .poll(() => frame.locator("h3").evaluate((e) => getComputedStyle(e).color))
    .toBe("rgb(255, 0, 0)");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "Card heading", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => frame.locator("h3").evaluate((e) => getComputedStyle(e).color))
    .toBe("rgb(255, 0, 0)");
  await expect
    .poll(() => frame.locator("html").getAttribute("data-theme"))
    .toBe("dark");
  const beforeBodyPadding = await page
    .locator(interactiveFrameSelector)
    .evaluate((e) => e.getBoundingClientRect().height);
  await css.fill(
    "h3 { color: rgb(255, 0, 0) !important; } body { padding-top: 120px; padding-bottom: 120px; }",
  );
  await expect
    .poll(() =>
      page
        .locator(interactiveFrameSelector)
        .evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBeGreaterThan(beforeBodyPadding + 230);
  await css.fill("h3 { color: rgb(255, 0, 0) !important; }");
  console.log("liveCSS, body height and reset passed");
  const before = await page
    .locator("#sg-code-panel")
    .evaluate((e) => e.getBoundingClientRect().width);
  const separator = page.getByRole("separator", { name: "Resize code panel" });
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 65, box.y + box.height / 2);
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .locator("#sg-code-panel")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .not.toBe(before);
  console.log("resizer passed");
  await page
    .getByRole("button", { name: "Preview tokens", exact: true })
    .click();
  await writeFile(
    join(evidence, "sample-spike-panel.txt"),
    await page.locator("body").innerText(),
  );
  await expect(
    page.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "--color-bg value", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "--color-bg value", exact: true })
    .fill("rgb(12, 34, 56)");
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      frame
        .locator("body")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    )
    .toBe("rgb(12, 34, 56)");
  console.log(
    "populated token panel edits reached Preact iframe; Apply disabled",
  );
  await page.screenshot({ path: join(evidence, "sample-spike-panel.png") });
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator("#sg-preview-tokens-trigger").click();
  await expect(
    page.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("link", { name: "Design Tokens", exact: true }).click();
  await expect(page).toHaveURL(/\/tokens\/?$/);
  await page.locator("#sg-preview-tokens-trigger").click();
  await expect(
    page.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("link", { name: "Components", exact: true }).click();
  await expect(page).toHaveURL(/\/components\/?$/);
  await page.getByRole("link", { name: "Card", exact: true }).first().click();
  await page
    .getByRole("button", { name: "Preview tokens", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
  await expect(
    frame.getByRole("heading", { name: "Card heading", exact: true }),
  ).toBeVisible();
  for (const bad of [
    { v: 2 },
    { v: undefined },
    { slug: "wrong" },
    { variant: "wrong" },
  ]) {
    await page.locator(interactiveFrameSelector).evaluate((iframe, bad) => {
      iframe.contentWindow.postMessage(
        {
          type: "sg:updateProps",
          v: 1,
          props: { title: "REJECT ME" },
          ...bad,
        },
        location.origin,
      );
    }, bad);
    await page.waitForTimeout(80);
    await expect(
      frame.getByRole("heading", { name: "Card heading", exact: true }),
    ).toBeVisible();
  }
  for (const invalid of [
    { origin: "https://wrong.example" },
    { badSource: true },
  ]) {
    await frame.locator("html").evaluate(
      (_, invalid) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: invalid.origin ?? location.origin,
            source: invalid.badSource ? window : parent,
            data: {
              type: "sg:updateProps",
              v: 1,
              props: { title: "REJECT ME" },
            },
          }),
        ),
      invalid,
    );
    await expect(
      frame.getByRole("heading", { name: "Card heading", exact: true }),
    ).toBeVisible();
  }
  await page.locator(interactiveFrameSelector).evaluate((iframe) => {
    window.__proofMessages = [];
    window.addEventListener("message", (e) => {
      if (e.origin === location.origin && e.data?.type === "sg:ready")
        window.__proofMessages.push(e.data);
    });
    iframe.contentWindow.postMessage(
      { type: "sg:requestReady", v: 1 },
      location.origin,
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__proofMessages.some(
          (m) => m.slug === "card" && m.variant === "Interactive" && m.v === 1,
        ),
      ),
    )
    .toBe(true);
  await page.locator(interactiveFrameSelector).evaluate((iframe) =>
    iframe.contentWindow.postMessage(
      {
        source: "zudo-sg-token-tweak-bridge",
        type: "apply-css-vars",
        vars: [["--sample-token-proof", "42px"]],
      },
      location.origin,
    ),
  );
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate((e) => e.style.getPropertyValue("--sample-token-proof")),
    )
    .toBe("42px");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect
    .poll(() =>
      frame
        .locator("html")
        .evaluate((e) => e.style.getPropertyValue("--sample-token-proof")),
    )
    .toBe("42px");
  for (const invalid of [
    { origin: "https://wrong.example" },
    { badSource: true },
  ]) {
    await frame.locator("html").evaluate(
      (_, invalid) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: invalid.origin ?? location.origin,
            source: invalid.badSource ? window : parent,
            data: {
              source: "zudo-sg-token-tweak-bridge",
              type: "apply-css-vars",
              vars: [["--sample-token-proof", "999px"]],
            },
          }),
        ),
      invalid,
    );
    await expect
      .poll(() =>
        frame
          .locator("html")
          .evaluate((e) => e.style.getPropertyValue("--sample-token-proof")),
      )
      .toBe("42px");
  }
  await frame
    .locator("html")
    .evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
  await page.getByLabel("Title", { exact: true }).fill("Restored scope");
  await expect(
    frame.getByRole("heading", { name: "Restored scope", exact: true }),
  ).toBeVisible();
  console.log(
    "protocol readiness, identity rejection, token receiver and props-only reset passed",
  );
  await page.goto(url + "/components/prose-md");
  await page.locator("iframe").first().scrollIntoViewIfNeeded();
  await expect(
    page.frameLocator("iframe").first().locator(".zc-prose-md h2"),
  ).toHaveText("Getting started");
  await page.goto(url + "/components");
  await expect(page.locator('img[src^="/sample-thumbnails/"]')).toHaveCount(12);
  expect(
    await page
      .locator('img[src^="/sample-thumbnails/"]')
      .evaluateAll((xs) => xs.every((x) => x.complete && x.naturalWidth > 0)),
  ).toBe(true);
  await page.screenshot({
    path: join(evidence, "sample-spike-catalog-final.png"),
    fullPage: true,
  });
  const descriptorSource = await readFile(
    join(hostRoot, "src/styleguide/descriptors.ts"),
    "utf8",
  );
  const corpus = JSON.parse(
    descriptorSource.slice(
      descriptorSource.indexOf("export const storyDescriptors = ") + 32,
      descriptorSource.lastIndexOf(" satisfies StoryDescriptor[];"),
    ),
  );
  let rendered = 0;
  for (const story of corpus) {
    for (const variant of story.variants) {
      await page.goto(
        url +
          `${externalPreview.url}?slug=${encodeURIComponent(story.slug)}&variant=${encodeURIComponent(variant.exportName)}`,
      );
      await expect(page.locator("#sample-preview")).not.toBeEmpty();
      await expect(page.locator(".zc-prose-md--pending")).toHaveCount(0);
      await expect(page.locator(".zc-prose-md--error")).toHaveCount(0);
      expect(
        await page
          .locator('link[rel="stylesheet"]')
          .evaluateAll((xs) => xs.map((x) => new URL(x.href).pathname)),
      ).toEqual(["/_sample-preview/main.css"]);
      rendered++;
    }
  }
  expect(rendered).toBe(71);
  console.log(
    "All 71 actual browser variants rendered with isolated stylesheet",
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );
  await expect(page.locator("#sample-preview")).toBeEmpty();
  await page.evaluate(() =>
    window.postMessage(
      { type: "sg:updateProps", v: 1, props: {} },
      location.origin,
    ),
  );
  await expect(page.locator("#sample-preview")).toBeEmpty();
  console.log("Nonpersisted teardown removed the preview renderer/listeners");

  for (const delayed of ["shell", "preview"]) {
    const slow = await context.newPage();
    slow.on("pageerror", (error) => errors.push(String(error)));
    slow.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    slow.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await slow.route(
      delayed === "shell"
        ? "**/assets/islands*.js"
        : "**/_sample-preview/preview.js",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      },
    );
    await slow.goto(url + "/components/card", { waitUntil: "commit" });
    const input = slow.getByLabel("Title", { exact: true });
    await expect(input).toBeDisabled();
    // fill waits on the real enabled state: no test delay before the first edit.
    await input.fill(`First edit after ${delayed}`);
    await expect(
      slow
        .frameLocator(interactiveFrameSelector)
        .getByRole("heading", {
          name: `First edit after ${delayed}`,
          exact: true,
        }),
    ).toBeVisible();
    await slow.close();
  }
  console.log(
    "Delayed hydration and iframe loading preserve the first available edit",
  );
  const early = await context.newPage();
  early.on("pageerror", (e) => errors.push(String(e)));
  early.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  early.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await early.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const button = document.getElementById("sg-preview-tokens-trigger");
      if (
        button &&
        document.querySelector("[data-sg-engine-route]") &&
        window.__sgPreviewTokenPanelCapture &&
        !window.__sgPreviewTokenPanelCapture.ready
      ) {
        window.__proofEarlyClick = true;
        button.click();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await early.goto(url + "/components/card");
  expect(await early.evaluate(() => window.__proofEarlyClick)).toBe(true);
  await expect(
    early.getByRole("button", { name: "Close panel", exact: true }),
  ).toBeVisible();
  await expect(
    early.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await early.close();
  console.log("pre-hydration click replay passed");
  console.log("errors", errors);
  expect(errors).toEqual([]);
  console.log("interaction assertions passed");
} catch (e) {
  console.error(e);
  await page.screenshot({
    path: join(evidence, "sample-spike-interaction-failure.png"),
    fullPage: true,
  });
  console.log("errors", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
