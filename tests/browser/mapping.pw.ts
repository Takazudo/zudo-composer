// Mapping browser coverage: focused Mapping evaluation and drift repair, plus
// the direct-preview isolation that the Mapping preview iframe depends on.
// Content-owned coverage lives in `content.pw.ts`.
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const JOURNAL_MAPPING = "/mapping?provider=mapping-indexeddb&mapping=journal-entry-mapping";

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

/** Re-pick one side of the Mapping through its toolbar picker dialog. */
async function pick(page: Page, trigger: RegExp, dialogName: string, record: string) {
  await page.getByRole("button", { name: trigger }).click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await dialog.getByRole("button", { name: `Select ${record}`, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Binding rows whose status chip reports a broken definition. */
function blockedRows(page: Page): Locator {
  return page.locator('.cms-mapping-status[data-status="blocked"]');
}

test("provider-qualified Journal Mapping evaluates each seeded Entry", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/mapping");

  // The library row is a real deep link, so opening a Mapping is a navigation.
  const row = page.getByRole("row").filter({ hasText: "Journal entry mapping" });
  await expect(row).toContainText("Journal articles");
  await expect(row).toContainText("Journal entry page");
  await expect(row.getByText("Ready", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "Journal entry mapping" }).click();
  await expect(page).toHaveURL(new RegExp(`${JOURNAL_MAPPING.replace("?", "\\?")}$`));

  // One row per binding, and nothing broken.
  await expect(page.locator(".cms-mapping-status")).toHaveCount(4);
  await expect(page.locator('.cms-mapping-status[data-status="ready"]')).toHaveCount(4);
  await expect(page.locator(".cms-table__detail-row")).toHaveCount(0);

  const entry = page.getByRole("combobox", { name: "Sample Entry" });
  await selectOptionMatching(entry, /Start with the question.*article-first-question/);
  const frame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(frame.getByRole("heading", { name: "Start with the question", exact: true })).toBeVisible();
  await expect(frame.getByText("Begin with purpose", { exact: true })).toBeVisible();

  // Test reports into the Diagnostics tab; there is no Mapping test modal.
  const diagnostics = page.getByRole("tab", { name: /^Diagnostics/ });
  await expect(diagnostics).toHaveAttribute("aria-selected", "false");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(diagnostics).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("No diagnostics");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toHaveCount(0);

  expect(failures).toEqual([]);
});

test("focused Mapping source and target drift remains visible and can be repaired", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto(JOURNAL_MAPPING);
  await expect(page.getByRole("textbox", { name: "Mapping name" })).toHaveValue("Journal entry mapping");

  // A model with none of these fields: every binding breaks, and every binding
  // keeps the source id it was authored with rather than being dropped.
  await pick(page, /^Content model: /, "Choose a Content model", "About content");
  await expect(blockedRows(page)).toHaveCount(4);
  await expect(page.getByRole("table", { name: "Bindings" })).toContainText("article-heading-field");
  await expect(page.locator(".cms-table__detail-row")).toHaveCount(4);

  await pick(page, /^Content model: /, "Choose a Content model", "Journal articles");
  await expect(blockedRows(page)).toHaveCount(0);

  // The same for the target side.
  await pick(page, /^Composition: /, "Choose a Composition", "About page");
  await expect(blockedRows(page)).toHaveCount(4);
  await expect(page.getByRole("table", { name: "Bindings" })).toContainText("journal-entry-heading.heading");

  await pick(page, /^Composition: /, "Choose a Composition", "Journal entry page");
  await expect(blockedRows(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByRole("region", { name: "Inspector" })).toContainText("No diagnostics");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(failures).toEqual([]);
});

test("an unbound target binds from its chip's compatible-source menu", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto(JOURNAL_MAPPING);

  // `SectionHeading.eyebrow` is the one text prop of the heading node that the
  // seeded Mapping leaves alone.
  const chip = page.getByRole("button", { name: /^Bind SectionHeading\.eyebrow/ });
  await expect(chip).toBeVisible();
  await chip.click();

  const menu = page.getByRole("menu", { name: "Bind SectionHeading.eyebrow to…" });
  // A text prop takes every string-producing field of the model — all five
  // here — and would take none of a boolean or number one.
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await menu.getByRole("menuitem").filter({ hasText: "Slug" }).click();

  await expect(page.locator(".cms-mapping-status")).toHaveCount(5);
  await expect(page.locator('.cms-mapping-status[data-status="ready"]')).toHaveCount(5);
  await expect(chip).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("direct preview is refreshable and isolated from every host product", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  const responses: Response[] = [];
  page.on("response", (response) => responses.push(response));
  await page.goto("/composer/preview");
  await expect(page.locator("#app")).toBeAttached();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.locator(".app-shell, .cms-rail, .cms-topbar, .sg-content-app, .cms-mapping-root, .sg-sitemapper-root")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#app")).toBeAttached();
  await expect(page.getByText(/Content authoring|Mapping library|Sitemaps/)).toHaveCount(0);
  const previewDocuments = responses.filter((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/composer/preview");
  expect(previewDocuments).toHaveLength(2);
  expect(previewDocuments.every((response) => response.ok())).toBe(true);
  expect(failures).toEqual([]);
});
