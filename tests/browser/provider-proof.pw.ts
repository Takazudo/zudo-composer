import { expect, test, type Page, type Response } from "@playwright/test";

const COMPONENTS = [
  "Callout",
  "Card",
  "ProseMd",
  "ProseP",
  "PlaceholderBox",
  "AutoGrid",
  "Container",
  "CtaButton",
  "Hero",
  "SectionHeading",
  "SplitLayout",
  "Stack",
] as const;

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => failures.push(`request: ${request.url()} (${request.failure()?.errorText})`));
  return failures;
}

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("zudo-composer-theme", value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("real provider composes, highlights, persists, exports, and stays responsive", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  const focusedAssets: Response[] = [];
  page.on("response", (response) => {
    if (/zfb_md_wasm_render_(?:bg|glue)/.test(response.url())) focusedAssets.push(response);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/composer");
  await expect(page.getByRole("heading", { name: "Compositions" })).toBeVisible();
  await page.getByRole("button", { name: "Open Product overview" }).click();
  await expect(page.getByRole("toolbar", { name: "Composer toolbar" })).toBeVisible();

  const canvas = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(canvas.getByText("A real provider composition", { exact: true })).toBeVisible();
  await expect(canvas.getByText("const ready = true;", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Add component to document root" }).click();
  const chooser = page.getByRole("dialog", { name: /Add to Document root/i });
  await expect(chooser).toBeVisible();
  for (const title of COMPONENTS) {
    await expect(chooser.getByRole("button", { name: new RegExp(`^${title}\\b`, "i") })).toHaveCount(1);
  }
  await expect(chooser.getByRole("button", { name: /^(Callout|Card|ProseMd|ProseP|PlaceholderBox|AutoGrid|Container|CtaButton|Hero|SectionHeading|SplitLayout|Stack)\b/i })).toHaveCount(12);
  await chooser.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: /Expand Container/i }).click();
  await page.getByRole("button", { name: /^ProseMd/ }).click();
  const markdown = page.getByRole("textbox", { name: "Markdown" });
  const persistedMarkdown = [
    "## Browser proof",
    "",
    "```ts",
    "function greet(name: string): string {",
    "  return `Hello, ${name}!`;",
    "}",
    "greet(\"Composer\");",
    "```",
  ].join("\n");
  await markdown.fill(persistedMarkdown);
  await markdown.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(canvas.getByText("Browser proof", { exact: true })).toBeVisible();

  const keyword = canvas.locator(".hi-kw").first();
  const string = canvas.locator(".hi-str").first();
  const callable = canvas.locator(".hi-fn").first();
  await expect(keyword).toBeVisible();
  await expect(string).toBeVisible();
  await expect(callable).toBeVisible();
  const syntaxColors = await Promise.all([keyword, string, callable].map((locator) => locator.evaluate((node) => getComputedStyle(node).color)));
  expect(new Set(syntaxColors).size).toBe(3);
  const codeSurface = canvas.locator("pre").first();
  const surfaceColors = await codeSurface.evaluate((node) => {
    const style = getComputedStyle(node.closest("pre") ?? node);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(surfaceColors.foreground).not.toBe(surfaceColors.background);

  await page.getByRole("button", { name: "Export JSX" }).click();
  const exportDialog = page.getByRole("dialog", { name: /Export — Product overview/i });
  await expect(exportDialog).toContainText('from "@zudo-sg/ui"');
  await exportDialog.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: /Expand Container/i })).toBeVisible();
  await page.getByRole("button", { name: /Expand Container/i }).click();
  await page.getByRole("button", { name: /^ProseMd/ }).click();
  await expect(page.getByRole("textbox", { name: "Markdown" })).toHaveValue(persistedMarkdown);

  const assetPath = (response: Response) => new URL(response.url()).pathname;
  expect(new Set(focusedAssets.filter((response) => assetPath(response).endsWith(".wasm")).map(assetPath)).size).toBe(1);
  expect(new Set(focusedAssets.filter((response) => assetPath(response).endsWith(".mjs")).map(assetPath)).size).toBe(1);
  for (const response of focusedAssets) {
    expect(response.ok()).toBe(true);
    expect(response.url()).toContain("/assets/");
    expect(response.headers()["content-type"]).toMatch(assetPath(response).endsWith(".wasm") ? /^application\/wasm/ : /javascript/);
  }

  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await expect(canvas.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await page.getByRole("button", { name: "Add component to document root" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("toolbar", { name: "Composer toolbar" })).toBeVisible();
  const narrowChooser = page.getByRole("dialog", { name: /Add to Document root/i });
  await expect(narrowChooser.getByText("12 of 12 components", { exact: true })).toBeVisible();
  await narrowChooser.getByRole("button", { name: "Cancel" }).click();
  await expectNoHorizontalOverflow(page);
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await expect(canvas.locator("html")).toHaveAttribute("data-theme", theme);
  }
  expect(failures).toEqual([]);
});

test("clean Sitemapper assigns and resolves the seeded Product overview catalog entry", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps" })).toBeVisible();
  await expect(page.getByText("No sitemaps yet.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Provider proof"));
  await page.getByRole("button", { name: "New sitemap" }).click();
  await expect(page.getByRole("toolbar", { name: "Sitemapper toolbar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await page.getByRole("button", { name: "Choose composition" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a composition" });
  await expect(picker.getByText("Product overview", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: /Assign Product overview from Browser storage/i }).click();
  await expect(page.getByText("Product overview", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser storage", { exact: true })).toBeVisible();

  for (const theme of ["light", "dark"] as const) await useTheme(page, theme);
  await page.setViewportSize({ width: 375, height: 812 });
  const canvasTab = page.getByRole("tab", { name: "Canvas" });
  await canvasTab.click();
  await expect(canvasTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Canvas" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sitemap canvas" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test("direct preview route is isolated and refreshable", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/composer/preview");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.locator("#app")).toBeAttached();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.locator("#app")).toBeAttached();
  expect(failures).toEqual([]);
});
