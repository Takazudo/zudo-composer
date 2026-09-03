// Content-authoring browser coverage: the journeys that start by authoring
// Content, and the shared responsive/theme/focus seams the Content panes own.
// Mapping-owned coverage lives in `mapping.pw.ts`.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const PRODUCT_LINKS = ["Compositions", "Content", "Mappings", "Sitemaps", "Media"] as const;
const COLLECTION_MAPPING = "Journal entry mapping";
const SINGLE_MAPPING = "Browser Site settings mapping";

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

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

async function expectArrowTabs(page: Page, label: string, names: readonly string[]) {
  const tabs = page.getByRole("tablist", { name: label });
  for (const name of names) await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
  const first = tabs.getByRole("tab", { name: names[0]!, exact: true });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: names[1]!, exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
}

/**
 * The narrow-screen pane switch `EditorChrome` gave every record editor is a
 * `radiogroup`, not a tablist: selection follows focus, so one arrow moves the
 * choice as well as the focus ring.
 */
async function expectArrowRadios(page: Page, group: Locator, names: readonly string[]) {
  for (const name of names) await expect(group.getByRole("radio", { name, exact: true })).toBeVisible();
  const first = group.getByRole("radio", { name: names[0]!, exact: true });
  const second = group.getByRole("radio", { name: names[1]!, exact: true });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-checked", "true");
}

/**
 * One row of the Sitemap library table, found by the link that opens it. The
 * page count is a column of its own since issue #165, so a row is identified by
 * its name and then read for the rest.
 */
function sitemapRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
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

async function selectEntry(page: Page, label: RegExp) {
  await selectOptionMatching(page.getByRole("combobox", { name: "Sample Entry" }), label);
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
  await selectOptionMatching(page.getByRole("combobox", { name: "Sample Entry" }), /Browser journey studio.*about-entry/);
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(mappingFrame.getByRole("heading", { name: "Browser journey studio", exact: true })).toBeVisible();

  await page.goto("/composer");
  await page.getByRole("button", { name: "Open About page", exact: true }).click();
  const composerFrame = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(composerFrame.getByRole("heading", { name: "Static about heading", exact: true })).toBeVisible();

  await page.goto("/sitemapper");
  const sampleRow = sitemapRow(page, "Sample Studio sitemap");
  await expect(sampleRow).toHaveCount(1);
  await expect(sampleRow.getByRole("cell").filter({ hasText: /^5$/ })).toHaveCount(1);
  await sampleRow.getByRole("link", { name: "Sample Studio sitemap", exact: true }).click();
  // Opening a Sitemap is a real navigation to the record's own URL, and the
  // editor chrome names the record it loaded.
  await expect(page).toHaveURL(/\/sitemapper\?sitemap=/);
  await expect(page.getByRole("textbox", { name: "Sitemap name" })).toHaveValue("Sample Studio sitemap");
  // Scoped to the toolbar: the outline's terminal add rows are called "Add page"
  // too, and it is the toolbar action this line means to find. `EditorChrome`
  // gives its toolbar no role, so the class it renders is the handle.
  await expect(page.locator(".cms-editor__toolbar").getByRole("button", { name: "Add page" })).toBeVisible();
  await expect(page.getByRole("tree", { name: "Pages" }).getByRole("treeitem", { name: /^Home\b/ })).toBeVisible();
  expect(failures).toEqual([]);
});

test("Content models, Mapping editing, and Sitemapper routes survive one browser journey", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/content");
  await expect(page.getByRole("heading", { name: "Content authoring" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Content authoring" })).toBeVisible();
  const journalCard = page.locator(".sg-content-library > li").filter({ hasText: "Journal articles" });
  await journalCard.getByRole("button", { name: /^Journal articles\s+Collection$/ }).click();
  await journalCard.getByRole("button", { name: /^Model fields/ }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("Browser Journal articles");
  await page.getByRole("button", { name: "Add field" }).click();
  const alternateSlugField = page.locator(".sg-content-field").last();
  await alternateSlugField.getByRole("textbox", { name: "Label" }).fill("Alternate route slug");
  await alternateSlugField.getByRole("textbox", { name: "Key" }).fill("alternateRouteSlug");
  await alternateSlugField.getByRole("radiogroup", { name: "Type for Alternate route slug" }).getByRole("radio", { name: /^Slug\b/ }).click();
  await alternateSlugField.getByRole("button", { name: "Move up" }).click();
  await page.getByRole("button", { name: "Add field" }).click();
  const reviewDateField = page.locator(".sg-content-field").last();
  await reviewDateField.getByRole("textbox", { name: "Label" }).fill("Review date");
  await reviewDateField.getByRole("textbox", { name: "Key" }).fill("reviewDate");
  await reviewDateField.getByRole("radiogroup", { name: "Type for Review date" }).getByRole("radio", { name: /^Date\b/ }).click();
  await expect(page.locator(".sg-content-save")).toContainText("All changes saved.");

  await journalCard.getByRole("button", { name: /^Entries/ }).click();
  await journalCard.getByRole("button", { name: "New Entry" }).click();
  await expect(page.locator(".sg-content-completeness")).toContainText("Incomplete draft");
  await page.getByRole("textbox", { name: "Heading (required)" }).fill("Browser journey article");
  await page.getByRole("textbox", { name: "Introduction (required)" }).fill("Saved Content drives the Mapping preview.");
  await page.getByLabel("Published on (required)").fill("2026-08-29");
  await page.getByRole("textbox", { name: "Body (required)" }).fill("## Browser journey\n\nSaved Content drives the Mapping preview.");
  await page.getByRole("textbox", { name: "Slug (required)" }).fill("東京");
  await page.getByLabel("Review date").fill("2026-08-30");
  await expect(page.locator(".sg-content-completeness")).toContainText("Complete");

  const additionalSlugs = ["東京", ".", "", ...Array.from({ length: 19 }, (_, index) => `browser-${index + 5}`)];
  for (const [index, routeSlug] of additionalSlugs.entries()) {
    await journalCard.getByRole("button", { name: "New Entry" }).click();
    await expect(page.getByRole("textbox", { name: "Heading (required)" })).toHaveValue("");
    await page.getByRole("textbox", { name: "Heading (required)" }).fill(`Browser article ${index + 2}`);
    await page.getByRole("textbox", { name: "Introduction (required)" }).fill(`Introduction ${index + 2}`);
    await page.getByLabel("Published on (required)").fill("2026-08-29");
    await page.getByRole("textbox", { name: "Body (required)" }).fill(`Body ${index + 2}`);
    if (routeSlug) await page.getByRole("textbox", { name: "Slug (required)" }).fill(routeSlug);
    await expect(page.locator(".sg-content-save")).toContainText("All changes saved.");
  }
  await expect(journalCard.getByRole("button", { name: /^Entries.*26/ })).toBeVisible();
  await page.reload();
  const browserJournalCard = page.locator(".sg-content-library > li").filter({ hasText: "Browser Journal articles" });
  await browserJournalCard.getByRole("button", { name: /^Entries/ }).click();
  await expect(page.getByRole("button", { name: "Load more Entries" })).toBeVisible();
  await page.getByRole("button", { name: "Load more Entries" }).click();
  await expect(page.getByRole("list", { name: "Entries" }).getByRole("button", { name: /Browser journey article.*Complete/ })).toBeVisible();

  await page.getByRole("button", { name: "New Single" }).click();
  const singleCard = page.locator(".sg-content-library > li").filter({ hasText: "Untitled single" });
  await singleCard.getByRole("button", { name: /^Model fields/ }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("Browser Site settings");
  const selectedSingleCard = page.locator(".sg-content-library > li[data-selected=true]");
  await selectedSingleCard.getByRole("button", { name: /^Entries/ }).click();
  await selectedSingleCard.getByRole("button", { name: "New Entry" }).click();
  await expect(selectedSingleCard.getByRole("button", { name: "New Entry" })).toHaveCount(0);
  await expect(selectedSingleCard.getByRole("button", { name: /^Entries.*1/ })).toBeVisible();

  // Native date inputs cannot author malformed dates. Keep one stale provider
  // value to prove Mapping diagnoses it without rewriting the source Entry.
  await page.evaluate(async () => {
    const databaseName = (await indexedDB.databases()).find(({ name }) => name?.startsWith("zudo-composer-content--site-project--"))?.name;
    if (!databaseName) throw new Error("Revision-scoped Content storage was not found.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(["models", "entries"], "readwrite");
    const model = await new Promise<{ document: { fields: Array<{ id: string; key: string }> } }>((resolve, reject) => {
      const request = transaction.objectStore("models").get("journal-articles");
      request.onsuccess = () => resolve(request.result as { document: { fields: Array<{ id: string; key: string }> } });
      request.onerror = () => reject(request.error);
    });
    const dateFieldId = model.document.fields.find((field) => field.key === "reviewDate")!.id;
    const entries = transaction.objectStore("entries");
    const entry = await new Promise<{ values: Record<string, unknown> } & Record<string, unknown>>((resolve, reject) => {
      const request = entries.get("article-first-question");
      request.onsuccess = () => resolve(request.result as { values: Record<string, unknown> } & Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    entries.put({ ...entry, values: { ...entry.values, [dateFieldId]: "2026-02-30" } });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    db.close();
  });

  await page.goto("/mapping");
  await expect(page.getByRole("heading", { name: "Mapping library" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Journal entry mapping.*4 bindings.*Ready/ }).click();
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await selectEntry(page, /Start with the question.*article-first-question/);
  await expect(mappingFrame.getByRole("heading", { name: "Start with the question" })).toBeVisible();
  await selectEntry(page, /Map the moving parts.*article-moving-parts/);
  await expect(mappingFrame.getByRole("heading", { name: "Map the moving parts" })).toBeVisible();

  const firstBinding = page.locator(".sg-mapping-binding").first();
  expect(await firstBinding.locator(".sg-mapping-binding__region-heading").evaluateAll((nodes) =>
    nodes.map((node) => node.scrollWidth <= node.clientWidth),
  )).toEqual([true, true, true]);
  const transform = firstBinding.getByRole("combobox", { name: "Transform" });
  await expect(transform.locator("option")).toHaveText(["Use value", "Truncate to 160", "Add prefix"]);
  await expect(transform.locator("option", { hasText: "Format date" })).toHaveCount(0);
  await firstBinding.getByRole("button", { name: "Move binding 1 down" }).click();
  await page.locator(".sg-mapping-binding").nth(1).getByRole("button", { name: "Move binding 2 up" }).click();
  await page.getByRole("button", { name: "Test Mapping" }).click();
  const testDialog = page.getByRole("dialog", { name: "Mapping test" });
  await expect(testDialog).toContainText("Ready");
  await expect(testDialog.getByText("No diagnostics.")).toBeVisible();
  await expect(testDialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Test Mapping" })).toBeFocused();

  const selectedSources = await page.locator(".sg-mapping-binding").evaluateAll((nodes) => nodes.map((node) =>
    (node.querySelector(".sg-mapping-binding__region--source select") as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim(),
  ));
  const seededDateIndex = selectedSources.indexOf("Published on · date");
  expect(seededDateIndex).toBeGreaterThanOrEqual(0);
  const seededDateBinding = page.locator(".sg-mapping-binding").nth(seededDateIndex);
  await seededDateBinding.getByRole("button", { name: "Remove" }).click();
  const addBinding = page.locator(".sg-mapping-add-binding");
  await addBinding.getByRole("combobox", { name: "Source field" }).selectOption({ label: "Review date · date" });
  await selectOptionMatching(addBinding.getByRole("combobox", { name: "Target field" }), /ProseP.*journal-entry-date.*\/ Text · text/);
  await addBinding.getByRole("button", { name: "Add binding" }).click();
  const reviewDateBinding = page.locator(".sg-mapping-binding").last();
  await expect(reviewDateBinding.getByRole("combobox", { name: "Transform" }).locator("option")).toHaveText(["Use value", "Format date (medium)", "Truncate to 160", "Add prefix"]);
  await reviewDateBinding.getByRole("combobox", { name: "Transform" }).selectOption({ label: "Format date (medium)" });
  await selectEntry(page, /Start with the question.*article-first-question/);
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Blocked");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("not canonical YYYY-MM-DD");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await selectEntry(page, /Map the moving parts.*article-moving-parts/);
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Optional source field \"Review date\" has no value");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Ready");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await reviewDateBinding.getByRole("button", { name: "Remove" }).click();

  await addBinding.getByRole("combobox", { name: "Source field" }).selectOption({ label: "Heading · text" });
  await selectOptionMatching(addBinding.getByRole("combobox", { name: "Target field" }), /SectionHeading.*journal-entry-heading.*\/ Heading level · select/);
  await addBinding.getByRole("button", { name: "Add binding" }).click();
  const selectBinding = page.locator(".sg-mapping-binding").last();
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Blocked");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("is not a current option");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await selectBinding.getByRole("button", { name: "Remove" }).click();

  await addBinding.getByRole("combobox", { name: "Source field" }).selectOption({ label: "Published on · date" });
  await selectOptionMatching(addBinding.getByRole("combobox", { name: "Target field" }), /ProseP.*journal-entry-date.*\/ Text · text/);
  await addBinding.getByRole("button", { name: "Add binding" }).click();
  await page.locator(".sg-mapping-binding").last().getByRole("combobox", { name: "Transform" }).selectOption({ label: "Format date (medium)" });
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Ready");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".sg-mapping-save")).toContainText("saved", { ignoreCase: true });
  await page.reload();
  await page.getByRole("button", { name: /^Journal entry mapping/ }).click();
  await expect(page.getByRole("heading", { name: COLLECTION_MAPPING })).toBeVisible();

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "New Mapping" }).click();
  const createMappingDialog = page.getByRole("dialog", { name: "Create Mapping" });
  await createMappingDialog.getByRole("textbox", { name: "Name" }).fill(SINGLE_MAPPING);
  await selectOptionMatching(createMappingDialog.getByRole("combobox", { name: "Content model" }), /Browser Site settings · single/);
  await createMappingDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: SINGLE_MAPPING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.goto("/composer");
  await page.getByRole("button", { name: "Open Journal entry page", exact: true }).click();
  const composerFrame = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(composerFrame.getByRole("heading", { name: "Static journal heading", exact: true })).toBeVisible();
  await expect(composerFrame.getByRole("heading", { name: "Map the moving parts", exact: true })).toHaveCount(0);

  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New sitemap" }).click();
  const createSitemapDialog = page.getByRole("dialog", { name: "Create sitemap" });
  await createSitemapDialog.getByRole("textbox", { name: "Sitemap name" }).fill("Content Mapping journey");
  await createSitemapDialog.getByRole("button", { name: "Create sitemap" }).click();
  await expect(page).toHaveURL(/\/sitemapper\?sitemap=/);

  // Issue #165 moved the Sitemapper onto `OutlineTree` and `EditorChrome`: the
  // outline is a real `tree` of `treeitem` rows, and the inspector is a pane
  // with a Page / Source tab pair instead of one flat panel.
  const pages = page.getByRole("tree", { name: "Pages" });
  await pages.getByRole("treeitem", { name: /^Home\b/ }).click();
  const inspector = page.getByRole("region", { name: "Inspector" });
  // The chip beside the page name is what "Current: …" used to say.
  const assignment = inspector.locator(".cms-pane__header .cms-chip");
  await expect(inspector.locator(".sg-sitemapper-inspector__name")).toHaveText("Home");
  await expect(assignment).toHaveText("Unassigned");

  const pageTab = inspector.getByRole("tab", { name: "Page", exact: true });
  const sourceTab = inspector.getByRole("tab", { name: "Source", exact: true });
  const slug = inspector.getByRole("textbox", { name: "Slug", exact: true });
  await slug.fill("news/latest");
  await slug.blur();
  await expect(inspector.getByText("/news/latest", { exact: true })).toBeVisible();

  await sourceTab.click();
  const sourceKind = inspector.getByRole("radiogroup", { name: "Page source type" });
  await sourceKind.getByRole("radio", { name: "Mapping", exact: true }).click();
  await inspector.getByRole("button", { name: "Choose mapping" }).click();
  await page.getByRole("dialog", { name: "Choose a Content Mapping" }).getByRole("button", { name: `Assign ${COLLECTION_MAPPING}` }).click();
  // Scoped to the Mapping group: the shell rail names the active provider in
  // its foot, so a page-wide text match can pass on chrome rather than on the
  // assignment under test.
  const mappingField = inspector.getByRole("group", { name: "Mapping" });
  const mappingCard = mappingField.locator(".sg-sitemapper-source__card");
  await expect(mappingCard.getByText(COLLECTION_MAPPING, { exact: true })).toBeVisible();
  // The two field pickers are built from the resolved Content model, so the
  // field this journey added to it proves which model answered.
  const slugField = mappingField.getByRole("combobox", { name: "Slug field" });
  await expect(slugField.locator("option", { hasText: "Alternate route slug" })).toHaveCount(1);
  await slugField.selectOption({ label: "Slug" });
  await mappingField.getByRole("combobox", { name: "Entry title field" }).selectOption({ label: "Heading" });
  await expect(assignment).toHaveText("Mapping");

  // 26 Entries, two of which derive no route: one with an empty slug and one
  // whose slug is a bare dot. The two that share 東京 collide but both resolve.
  await expect(mappingCard).toContainText(/·\s*24 routes/);
  await expect(mappingCard.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(mappingField.getByText("Entry slug is missing or empty.", { exact: true }).first()).toBeVisible();
  await expect(mappingField.getByText("Entry slug contains a forbidden route delimiter.", { exact: true })).toBeVisible();
  await expect(mappingField.getByText(/Route \/news\/latest\/%E6%9D%B1%E4%BA%AC collides/).first()).toBeVisible();
  // A Mapping route family owns its own routes and takes no authored children.
  await expect(pages.getByRole("treeitem")).toHaveCount(1);

  // An absolute base derives nothing at all, and the expansion says why rather
  // than resolving the Mapping against it.
  await pageTab.click();
  await slug.fill("https://example.test/news");
  await slug.blur();
  await sourceTab.click();
  await expect(mappingField.getByText("HTTP(S) Mapping route bases are unsupported.", { exact: true })).toBeVisible();
  await expect(mappingCard).toHaveCount(0);
  await pageTab.click();
  await slug.fill("news/latest");
  await slug.blur();
  await sourceTab.click();
  await expect(mappingCard).toContainText(/·\s*24 routes/);

  await mappingField.getByRole("button", { name: "Change mapping" }).click();
  await page.getByRole("dialog", { name: "Choose a Content Mapping" }).getByRole("button", { name: `Assign ${SINGLE_MAPPING}` }).click();
  await expect(mappingCard.getByText(SINGLE_MAPPING, { exact: true })).toBeVisible();
  // A single Content model derives one route from the page's own slug, so it
  // offers no per-Entry slug field at all.
  await expect(mappingField.getByRole("combobox", { name: "Slug field" })).toHaveCount(0);
  await pageTab.click();
  await expect(inspector.getByText("/news/latest", { exact: true })).toBeVisible();

  // Switching away from an assigned source clears it, behind one confirmation.
  await sourceTab.click();
  await sourceKind.getByRole("radio", { name: "None", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Clear the assigned mapping?" }).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(assignment).toHaveText("Unassigned");
  await expect(inspector.getByText("This page renders nothing until a source is assigned.", { exact: true })).toBeVisible();

  await sourceKind.getByRole("radio", { name: "Composition", exact: true }).click();
  await inspector.getByRole("button", { name: "Choose composition" }).click();
  await page.getByRole("dialog", { name: "Choose a composition" }).getByRole("button", { name: /Assign Journal entry page from Browser storage/ }).click();
  const compositionField = inspector.getByRole("group", { name: "Composition" });
  await expect(compositionField.getByText("Journal entry page", { exact: true })).toBeVisible();
  await expect(assignment).toHaveText("Composition");

  // Leaving the record is a real navigation now, so the assignment has to be
  // on disk before it happens rather than sitting in the debounced queue.
  await expect(page.locator(".cms-topbar__status")).toHaveAttribute("data-state", "saved");
  await page.getByRole("link", { name: "Back to Sitemaps" }).click();
  const journeyRow = sitemapRow(page, "Content Mapping journey");
  await expect(journeyRow.getByRole("cell").filter({ hasText: /^1$/ })).toHaveCount(1);
  await journeyRow.getByRole("link", { name: "Content Mapping journey", exact: true }).click();
  const reopened = page.getByRole("region", { name: "Inspector" });
  await page.getByRole("tree", { name: "Pages" }).getByRole("treeitem", { name: /^Home\b/ }).click();
  await expect(reopened.locator(".cms-pane__header .cms-chip")).toHaveText("Composition");
  await reopened.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(reopened.getByRole("group", { name: "Composition" }).getByText("Journal entry page", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "journey-sitemapper-static-persisted");

  expect(failures).toEqual([]);
});

test("authoring workspaces retain responsive, theme, focus, and navigation seams", async ({ page }, testInfo) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/content");
  await page.getByRole("button", { name: /^Journal articles\b/ }).click();
  const panes = page.locator(".sg-content-pane");
  await expectFlatPanels(panes);
  const paneGeometry = await panes.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflowY: style.overflowY };
  }));
  expect(new Set(paneGeometry.map(({ top }) => Math.round(top))).size).toBe(1);
  expect(paneGeometry.every(({ bottom, overflowY }) => bottom <= 900 && overflowY === "auto")).toBe(true);
  expect(paneGeometry[0]!.right).toBeLessThanOrEqual(paneGeometry[1]!.left);
  expect(paneGeometry[1]!.right).toBeLessThanOrEqual(paneGeometry[2]!.left);
  await expect(page.locator(".cms-topbar")).toHaveCSS("height", "48px");

  const themeColors: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    themeColors.push(await panes.first().evaluate((node) => getComputedStyle(node).backgroundColor));
    await screenshot(page, testInfo, `content-desktop-${theme}`);
  }
  expect(themeColors[0]).not.toBe(themeColors[1]);

  await page.setViewportSize({ width: 375, height: 812 });
  // Below 64rem the rail leaves the side and becomes the bottom tab strip.
  await expect(page.locator(".cms-topbar")).toHaveCSS("height", "48px");
  await expect(page.locator(".cms-rail")).toHaveCSS("height", "56px");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const product of PRODUCT_LINKS) await expect(navigation.getByRole("link", { name: product, exact: true })).toBeVisible();
  await expectArrowTabs(page, "Content workspace", ["Library", "Author", "Preview"]);
  const focusedTab = page.getByRole("tab", { name: "Library", exact: true });
  await expect(focusedTab).toHaveCSS("outline-width", "2px");
  await expectNoHorizontalOverflow(page);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  for (const product of PRODUCT_LINKS) {
    const box = await navigation.getByRole("link", { name: product, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const targets = await page.locator(".sg-content-app button:visible").evaluateAll((nodes) => nodes.map((node) => {
    const { width, height } = node.getBoundingClientRect();
    return { name: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "button", width, height };
  }));
  expect(targets.filter(({ width, height }) => width < 44 || height < 44)).toEqual([]);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });

  await page.getByRole("tab", { name: "Library", exact: true }).click();
  const deleteTrigger = page.getByRole("button", { name: "Delete Journal articles" });
  await deleteTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Delete model?" });
  const dialogStyle = await dialog.evaluate((node) => {
    const style = getComputedStyle(node);
    return { radius: style.borderRadius, shadow: style.boxShadow };
  });
  expect(dialogStyle.radius).toBe("8px");
  expect(dialogStyle.shadow).not.toBe("none");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteTrigger).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".sg-content-app button").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  const milliseconds = (value: string) => value.split(",").map((part) => part.trim()).reduce((max, part) => Math.max(max, part.endsWith("ms") ? Number.parseFloat(part) : Number.parseFloat(part) * 1000), 0);
  expect(milliseconds(motion.animation)).toBeLessThanOrEqual(0.01);
  expect(milliseconds(motion.transition)).toBeLessThanOrEqual(0.01);

  await page.goto("/mapping");
  await page.getByRole("button", { name: /^Journal entry mapping.*Ready/ }).click();
  await expectArrowTabs(page, "Mapping workspace", ["Source", "Bindings", "Preview"]);
  await expectNoHorizontalOverflow(page);
  await expectFlatPanels(page.locator(".sg-mapping-pane"));
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await expect(mappingFrame.locator("html")).toHaveAttribute("data-theme", theme);
    await screenshot(page, testInfo, `mapping-narrow-${theme}`);
  }

  await page.goto("/sitemapper");
  await page.getByRole("button", { name: "New sitemap" }).click();
  const responsiveDialog = page.getByRole("dialog", { name: "Create sitemap" });
  await responsiveDialog.getByRole("textbox", { name: "Sitemap name" }).fill("Responsive panels");
  await responsiveDialog.getByRole("button", { name: "Create sitemap" }).click();
  await expect(page).toHaveURL(/\/sitemapper\?sitemap=/);
  // `EditorChrome` replaced the Sitemapper's own tablist with the shared pane
  // switch, and the editor renames the three panes. Scoped to the group rather
  // than matched page-wide: the toolbar's View control also offers a "Canvas",
  // and it is only withdrawn here by a stylesheet rule below 64rem — a rule
  // this spec must not silently depend on for its selectors to stay unique.
  const paneSwitch = page.getByRole("radiogroup", { name: "Pane" });
  await expectArrowRadios(page, paneSwitch, ["Pages", "Canvas", "Inspect"]);
  await expect(page.getByRole("region", { name: "Pages" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await screenshot(page, testInfo, `sitemapper-narrow-${theme}`);
  }
  expect(failures).toEqual([]);
});
