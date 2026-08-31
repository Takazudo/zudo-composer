import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const PRODUCT_LINKS = ["Composer", "Content", "Mapping", "Sitemapper"] as const;

function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText;
    if (errorText === "net::ERR_ABORTED") return;
    failures.push(`request: ${request.url()} (${errorText})`);
  });
  return failures;
}

async function selectOptionMatching(select: Locator, label: RegExp) {
  const value = await select.locator("option").filter({ hasText: label }).first().getAttribute("value");
  expect(value).not.toBeNull();
  await select.selectOption(value!);
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

async function expectArrowTabs(page: Page, label: string, names: readonly string[]) {
  const tabs = page.getByRole("tablist", { name: label });
  const first = tabs.getByRole("tab", { name: names[0]!, exact: true });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: names[1]!, exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
}

async function expectFlatPanels(locator: Locator) {
  const styles = await locator.evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return { radius: Number.parseFloat(style.borderRadius), shadow: style.boxShadow };
  }));
  expect(styles.length).toBeGreaterThan(0);
  for (const style of styles) {
    expect(style.shadow).toBe("none");
    expect(style.radius).toBeGreaterThanOrEqual(4);
    expect(style.radius).toBeLessThanOrEqual(8);
  }
}

test("same-context Content to Mapping to Composer preview to Sitemapper journey", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/content");
  await expect(page.getByRole("heading", { name: "Content authoring" })).toBeVisible();
  const aboutCard = page.locator(".sg-content-library > li").filter({ hasText: "About content" });
  await aboutCard.getByRole("button", { name: /^About content\s+Single$/ }).click();
  await aboutCard.getByRole("button", { name: /^Entries/ }).click();
  await aboutCard.getByRole("button", { name: /A studio built around useful clarity.*Complete/ }).click();
  await page.getByRole("textbox", { name: "Heading (required)" }).fill("Browser journey studio");
  await page.getByRole("textbox", { name: "Heading (required)" }).blur();
  await expect(page.locator(".sg-content-save")).toContainText("All changes saved.");

  await page.goto("/mapping");
  await expect(page.getByRole("heading", { name: "Mapping library" })).toBeVisible();
  await page.getByRole("button", { name: /^About page mapping.*3 bindings.*Ready/ }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await selectOptionMatching(page.getByRole("combobox", { name: "Sample Entry" }), /Browser journey studio.*about-entry/);
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(mappingFrame.getByRole("heading", { name: "Browser journey studio", exact: true })).toBeVisible();

  await page.goto("/composer");
  await page.getByRole("button", { name: "Open About page", exact: true }).click();
  const composerFrame = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(composerFrame.getByRole("heading", { name: "Static about heading", exact: true })).toBeVisible();

  await page.goto("/sitemapper");
  await page.getByRole("button", { name: /Sample Studio sitemap/ }).click();
  await expect(page.getByRole("toolbar", { name: "Sitemapper toolbar" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sitemap outline" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("provider-qualified Journal Mapping evaluates each seeded Entry", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/mapping");
  await page.getByRole("button", { name: /^Journal entry mapping.*4 bindings.*Ready/ }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const entry = page.getByRole("combobox", { name: "Sample Entry" });
  await selectOptionMatching(entry, /Start with the question.*article-first-question/);
  const frame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(frame.getByRole("heading", { name: "Start with the question", exact: true })).toBeVisible();
  await expect(frame.getByText("Begin with purpose", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Bindings", exact: true }).click();
  await page.getByRole("button", { name: "Test Mapping", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mapping test" });
  await expect(dialog).toContainText("Ready");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(failures).toEqual([]);
});

test("authoring workspaces retain responsive, theme, focus, and navigation seams", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/content");
  await expectFlatPanels(page.locator(".sg-content-pane"));
  await expect(page.locator(".app-header")).toHaveCSS("min-height", "56px");
  for (const theme of ["light", "dark"] as const) await useTheme(page, theme);

  await page.setViewportSize({ width: 375, height: 812 });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const product of PRODUCT_LINKS) await expect(navigation.getByRole("link", { name: product, exact: true })).toBeVisible();
  await expectArrowTabs(page, "Content workspace", ["Library", "Author"]);
  await expectNoHorizontalOverflow(page);
  const focusedTab = page.getByRole("tab", { name: "Library", exact: true });
  await expect(focusedTab).toHaveCSS("outline-width", "2px");

  await page.goto("/mapping");
  await page.getByRole("button", { name: /^About page mapping.*Ready/ }).click();
  await expectArrowTabs(page, "Mapping workspace", ["Source", "Bindings"]);
  await expectNoHorizontalOverflow(page);
  await expectFlatPanels(page.locator(".sg-mapping-pane"));

  await page.goto("/sitemapper");
  await page.getByRole("button", { name: /Sample Studio sitemap/ }).click();
  await expectArrowTabs(page, "Sitemapper panels", ["Outline", "Canvas"]);
  await expectNoHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test("direct preview is refreshable and isolated from every host product", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  const responses: Response[] = [];
  page.on("response", (response) => responses.push(response));
  await page.goto("/composer/preview");
  await expect(page.locator("#app")).toBeAttached();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.locator(".app-header, .sg-content-app, .sg-mapping-app, .sg-sitemapper-root")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#app")).toBeAttached();
  await expect(page.getByText(/Content authoring|Mapping library|Sitemaps/)).toHaveCount(0);
  const previewDocuments = responses.filter((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/composer/preview");
  expect(previewDocuments).toHaveLength(2);
  expect(previewDocuments.every((response) => response.ok())).toBe(true);
  expect(failures).toEqual([]);
});
