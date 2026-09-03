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
  await page.getByRole("link", { name: "About page", exact: true }).click();
  // The shared editor toolbar carries no role of its own, so it is scoped by
  // class; "Undo" and "Add component" also exist inside the canvas iframe.
  const toolbar = page.locator(".cms-editor__toolbar");
  const structure = page.locator(".cms-editor__region--nav");
  await expect(toolbar).toBeVisible();

  const canvas = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(canvas.getByText("Static about heading", { exact: true })).toBeVisible();
  await expect(canvas.getByText("Static about body", { exact: true })).toBeVisible();

  await structure.getByRole("button", { name: "Add component to the document" }).click();
  const chooser = page.getByRole("dialog", { name: /Add to Document root/i });
  await expect(chooser).toBeVisible();
  for (const title of COMPONENTS) {
    await expect(chooser.getByRole("button", { name: new RegExp(`^${title}\\b`, "i") })).toHaveCount(1);
  }
  await expect(chooser.getByRole("button", { name: /^(Callout|Card|ProseMd|ProseP|PlaceholderBox|AutoGrid|Container|CtaButton|Hero|SectionHeading|SplitLayout|Stack)\b/i })).toHaveCount(12);
  await chooser.getByRole("button", { name: "Cancel" }).click();

  await structure.getByRole("treeitem", { name: /^ProseMd/ }).click();
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

  await toolbar.getByRole("button", { name: "Export JSX" }).click();
  const exportDialog = page.getByRole("dialog", { name: /Export — About page/i });
  await expect(exportDialog).toContainText('from "@zudo-sg/ui"');
  await exportDialog.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await structure.getByRole("treeitem", { name: /^ProseMd/ }).click();
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
  await structure.getByRole("button", { name: "Add component to the document" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(toolbar).toBeVisible();
  const narrowChooser = page.getByRole("dialog", { name: /Add to Document root/i });
  await expect(narrowChooser.getByText("12 of 12 components", { exact: true })).toBeVisible();
  await narrowChooser.getByRole("button", { name: "Cancel" }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("menuitemradio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(canvas.locator("html")).toHaveAttribute("data-theme", "light");
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await expect(canvas.locator("html")).toHaveAttribute("data-theme", theme);
  }
  expect(failures).toEqual([]);
});

test("clean Sitemapper assigns and resolves the seeded About page catalog entry", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New sitemap" }).click();
  const createSitemapDialog = page.getByRole("dialog", { name: "Create sitemap" });
  await createSitemapDialog.getByRole("textbox", { name: "Sitemap name" }).fill("Provider proof");
  await createSitemapDialog.getByRole("button", { name: "Create sitemap" }).click();

  // Creating navigates to the record's own URL: `/sitemapper` is the library
  // and `/sitemapper?sitemap=` is one Sitemap, so the editor is a real route.
  await expect(page).toHaveURL(/\/sitemapper\?sitemap=/);
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue("Provider proof");
  await expect(page.getByRole("tree", { name: "Pages" }).getByRole("treeitem", { name: /Home/ })).toBeVisible();

  await page.getByRole("tab", { name: "Source" }).click();
  await page.getByRole("radio", { name: "Composition", exact: true }).click();
  await page.getByRole("button", { name: "Choose composition" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a composition" });
  await expect(picker.getByText("About page", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: /Assign About page from Browser storage/i }).click();
  // Scoped to the Composition group: the shell rail also shows the active
  // provider ("Browser storage") in its foot, so a page-wide text match is
  // ambiguous and would pass on the rail rather than on the assignment.
  const compositionField = page.getByRole("group", { name: "Composition" });
  await expect(compositionField.getByText("About page", { exact: true })).toBeVisible();
  await expect(compositionField.getByText("Browser storage", { exact: true })).toBeVisible();

  for (const theme of ["light", "dark"] as const) await useTheme(page, theme);
  await page.setViewportSize({ width: 375, height: 812 });
  // Below 64rem the toolbar's centre controls are withdrawn, so the only
  // "Canvas" control left is the pane switch this asserts on.
  const canvasPane = page.getByRole("radio", { name: "Canvas" });
  await canvasPane.click();
  await expect(canvasPane).toHaveAttribute("aria-checked", "true");
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
