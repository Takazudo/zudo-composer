// Mapping browser coverage: focused Mapping evaluation and drift repair, plus
// the direct-preview isolation that the Mapping preview iframe depends on.
// Content-owned coverage lives in `content.pw.ts`.
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

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

test("provider-qualified Journal Mapping evaluates each seeded Entry", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/mapping");
  await page.getByRole("button", { name: /^Journal entry mapping.*4 bindings.*Ready/ }).click();
  const entry = page.getByRole("combobox", { name: "Sample Entry" });
  await selectOptionMatching(entry, /Start with the question.*article-first-question/);
  const frame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(frame.getByRole("heading", { name: "Start with the question", exact: true })).toBeVisible();
  await expect(frame.getByText("Begin with purpose", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Test Mapping", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mapping test" });
  await expect(dialog).toContainText("Ready");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(failures).toEqual([]);
});

test("focused Mapping source and target drift remains visible and can be repaired", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/mapping");
  await page.getByRole("button", { name: /^Journal entry mapping/ }).click();
  const contentModel = page.getByRole("combobox", { name: "Content model" });
  await selectOptionMatching(contentModel, /About content · single · Browser storage/);
  const broken = page.locator(".sg-mapping-binding[data-broken=true]");
  await expect(broken).toHaveCount(4);
  await expect(broken.first().getByRole("combobox", { name: "Source" })).toHaveValue(/article-heading-field/);
  await selectOptionMatching(contentModel, /Journal articles · collection · Browser storage/);
  await expect(page.locator(".sg-mapping-binding[data-broken=true]")).toHaveCount(0);

  const composition = page.getByRole("combobox", { name: "Composition" });
  await selectOptionMatching(composition, /About page · Browser storage/);
  await expect(page.locator(".sg-mapping-binding[data-broken=true]")).toHaveCount(4);
  await expect(page.locator(".sg-mapping-binding[data-broken=true]").first().getByRole("combobox", { name: "Target" })).toHaveValue(/journal-entry-heading/);
  await selectOptionMatching(composition, /Journal entry page · Browser storage/);
  await expect(page.locator(".sg-mapping-binding[data-broken=true]")).toHaveCount(0);
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Ready");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Save" }).click();
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
