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

async function expectArrowTabs(page: Page, label: string, names: readonly (string | RegExp)[]) {
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

/**
 * One row of the Mapping library table, found by the link that opens it. Since
 * issue #171 the library is `LibraryPage`, so the name is a link and the
 * binding count and readiness are columns — there is no single button carrying
 * all three in its accessible name any more.
 */
function mappingRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}

/**
 * One row of the bindings table. Each row names its transform control after the
 * pair it joins — `Transform for Heading → SectionHeading.heading` — which is
 * the only text in the row unique to it. Pass the source alone where that is
 * already unambiguous, or the whole pair where one field drives two props.
 */
function bindingRow(page: Page, pair: string): Locator {
  return page.getByRole("row").filter({
    has: page.getByRole("combobox", { name: new RegExp(`^Transform for ${pair}`) }),
  });
}

/** A binding's own `⋯` menu: Move up, Move down, Remove binding. */
async function bindingAction(page: Page, pair: string, action: string) {
  await bindingRow(page, pair).getByRole("button", { name: /^Binding actions for / }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/**
 * Bind an unbound Composition prop from its `+` chip. The menu offers only
 * sources compatible with that prop, so choosing one is also an assertion that
 * it was on offer at all.
 */
async function bindTarget(page: Page, target: string, nodeId: string, source: RegExp) {
  await page.getByRole("button", { name: `Bind ${target} on ${nodeId}`, exact: true }).click();
  await page.getByRole("menu", { name: `Bind ${target} to…`, exact: true })
    .getByRole("menuitem").filter({ hasText: source }).click();
}

/** The Mapping editor's inspector, which is where diagnostics live since #171. */
function mappingInspector(page: Page): Locator {
  return page.getByRole("region", { name: "Inspector" });
}

/**
 * Run Test and read the Diagnostics tab it brings forward. The Test modal is
 * gone, so this also asserts the tab actually took over — both inspector
 * panels stay mounted with the inactive one hidden, and a presence assertion
 * would pass with the Preview tab still selected.
 */
async function expectTestReports(page: Page, expected: RegExp) {
  await page.getByRole("button", { name: "Test", exact: true }).click();
  const inspector = mappingInspector(page);
  await expect(inspector.getByRole("tab", { name: /^Diagnostics/ })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByText(expected)).toBeVisible();
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

/**
 * The Content navigator. `role="tree"` sits on the rows alone, so the root
 * `Add model` button and the toolbar live in the pane around it — which is why
 * the pane region, not the tree, is the scope every Content lookup starts from.
 */
function contentNav(page: Page): Locator {
  return page.getByRole("region", { name: "Content" });
}

function contentTree(page: Page): Locator {
  return contentNav(page).getByRole("tree", { name: "Content" });
}

/** The save state the route publishes through `useEditorStatus`, as the shell draws it. */
function saveStatus(page: Page): Locator {
  return page.locator(".cms-topbar__status");
}

/** The one row-level overflow menu the navigator gives every model and Entry. */
async function openRowMenu(page: Page, name: string) {
  const row = contentTree(page).getByRole("treeitem", { name: new RegExp(`^${name}`) });
  // Revealing the actions can move them under the cursor, and the row itself is
  // the hit target Playwright then sees; the reveal is `:focus-within` as well
  // as hover, so focusing the row is the stable way in.
  await row.focus();
  await contentNav(page).getByRole("button", { name: `More actions for ${name}` }).click();
}

test("same-context Content to Mapping to Composer preview to Sitemapper journey", async ({ page }) => {
  test.setTimeout(120_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/content");
  // The navigator IS the library: a model is a category and its Entries hang
  // off it, so choosing what to author takes two clicks from the bare route.
  const about = contentTree(page).getByRole("treeitem", { name: /^About content/ });
  await expect(about).toBeVisible();
  await expect(about).toContainText("single");
  await about.click();
  await contentTree(page).getByRole("treeitem", { name: /^A studio built around useful clarity/ }).click();
  await page.getByRole("textbox", { name: "Heading (required)" }).fill("Browser journey studio");
  await page.getByRole("textbox", { name: "Heading (required)" }).blur();
  await expect(saveStatus(page)).toContainText("Saved");
  // Opening a record is a deep link the author can copy.
  await expect(page).toHaveURL(/\/content\?model=about-content&entry=/);

  await page.goto("/mapping");
  await expect(page.getByRole("heading", { name: "Mapping library" })).toBeVisible();
  // The card's composite name became a row: three bindings and Ready are two
  // columns now, and opening the record is a real navigation to its own URL.
  const aboutMapping = mappingRow(page, "About page mapping");
  await expect(aboutMapping.getByRole("cell").filter({ hasText: /^3$/ })).toHaveCount(1);
  await expect(aboutMapping.getByText("Ready", { exact: true })).toBeVisible();
  await aboutMapping.getByRole("link", { name: "About page mapping", exact: true }).click();
  await expect(page).toHaveURL(/\/mapping\?provider=.*&mapping=about-page-mapping/);
  await selectOptionMatching(page.getByRole("combobox", { name: "Sample Entry" }), /Browser journey studio.*about-entry/);
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await expect(mappingFrame.getByRole("heading", { name: "Browser journey studio", exact: true })).toBeVisible();

  await page.goto("/composer");
  await page.getByRole("link", { name: "About page", exact: true }).click();
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
  await expect(contentTree(page)).toBeVisible();
  await page.reload();
  await expect(contentTree(page)).toBeVisible();
  await contentTree(page).getByRole("treeitem", { name: /^Journal articles/ }).click();
  // Entry | Schema replaces the per-model Entries / Model fields buttons.
  const mode = page.getByRole("radiogroup", { name: "Editor mode" });
  await mode.getByRole("radio", { name: "Schema" }).click();
  // Scoped to the form: the toolbar's inline record title is called
  // "Model name" too, and it edits the same name from the other end.
  await page.locator(".sg-content-form").getByRole("textbox", { name: "Model name" }).fill("Browser Journal articles");
  await expect(page.getByRole("textbox", { name: "Model name" }).first()).toHaveValue("Browser Journal articles");
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
  await expect(saveStatus(page)).toContainText("Saved");
  // Autosave stays authoritative, so Save is inert once the queue has drained.
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveAttribute("title", "All changes saved");

  await mode.getByRole("radio", { name: "Entry" }).click();
  await contentNav(page).getByRole("button", { name: "Add entry" }).click();
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
    await contentNav(page).getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByRole("textbox", { name: "Heading (required)" })).toHaveValue("");
    await page.getByRole("textbox", { name: "Heading (required)" }).fill(`Browser article ${index + 2}`);
    await page.getByRole("textbox", { name: "Introduction (required)" }).fill(`Introduction ${index + 2}`);
    await page.getByLabel("Published on (required)").fill("2026-08-29");
    await page.getByRole("textbox", { name: "Body (required)" }).fill(`Body ${index + 2}`);
    if (routeSlug) await page.getByRole("textbox", { name: "Slug (required)" }).fill(routeSlug);
    await expect(saveStatus(page)).toContainText("Saved");
  }
  // Metadata is read off the row rather than matched inside its accessible
  // name: the title, slug, count and status are separate elements, and a name
  // regex spanning them would depend on how they happen to be concatenated.
  const journalRow = contentTree(page).getByRole("treeitem", { name: /^Browser Journal articles/ });
  await expect(journalRow).toContainText("(26)");
  await page.reload();
  // The reload lands on the record's own URL, so the model reopens itself.
  await expect(journalRow).toBeVisible();
  // A further page is one trailing row inside the tree, not a button beside it.
  const moreEntries = contentTree(page).getByRole("treeitem", { name: /\d+ more entr(y|ies)…/ });
  await expect(moreEntries).toBeVisible();
  await moreEntries.click();
  await expect(contentTree(page).getByRole("treeitem", { name: /^Browser journey article/ })).toBeVisible();

  // `Add model` asks name and kind once, instead of two New buttons creating
  // an "Untitled" record the author then has to find and rename.
  await contentNav(page).getByRole("button", { name: "Add model" }).click();
  const addModel = page.getByRole("dialog", { name: "Add Content model" });
  await addModel.getByRole("textbox", { name: "Model name" }).fill("Browser Site settings");
  await addModel.getByRole("radio", { name: "Single" }).click();
  await addModel.getByRole("button", { name: "Add model" }).click();
  const siteSettingsRow = contentTree(page).getByRole("treeitem", { name: /^Browser Site settings/ });
  await expect(siteSettingsRow).toContainText("single");
  await expect(contentTree(page).getByRole("treeitem", { name: /Untitled/ })).toHaveCount(0);
  await contentNav(page).getByRole("button", { name: "Add entry" }).click();
  // A Single holds exactly one Entry, so its add row withdraws once it has one.
  await expect(contentNav(page).getByRole("button", { name: "Add entry" })).toHaveCount(0);
  await expect(siteSettingsRow).toContainText("(1)");

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
  const journalMapping = mappingRow(page, COLLECTION_MAPPING);
  await expect(journalMapping.getByRole("cell").filter({ hasText: /^4$/ })).toHaveCount(1);
  await expect(journalMapping.getByText("Ready", { exact: true })).toBeVisible();
  await journalMapping.getByRole("link", { name: COLLECTION_MAPPING, exact: true }).click();
  const mappingFrame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await selectEntry(page, /Start with the question.*article-first-question/);
  await expect(mappingFrame.getByRole("heading", { name: "Start with the question" })).toBeVisible();
  await selectEntry(page, /Map the moving parts.*article-moving-parts/);
  await expect(mappingFrame.getByRole("heading", { name: "Map the moving parts" })).toBeVisible();

  // Issue #171 made a binding one table row instead of three stacked cards, so
  // "the three region headings are not clipped" became "the fixed-layout table
  // fits its pane and ellipsises inside its cells rather than widening".
  const bindingsTable = page.getByRole("table", { name: "Bindings" });
  expect(await page.locator(".cms-mapping-table .cms-table-wrap").evaluate(
    (node) => node.scrollWidth <= node.clientWidth,
  )).toBe(true);
  await expect(bindingsTable.getByRole("row")).toHaveCount(5);

  const headingBinding = bindingRow(page, "Heading → SectionHeading.heading");
  const headingTransform = headingBinding.getByRole("combobox", { name: /^Transform for / });
  await expect(headingTransform.locator("option")).toHaveText(["Pass through", "Truncate to 160", "Add prefix"]);
  await expect(headingTransform.locator("option", { hasText: "Format date" })).toHaveCount(0);

  // Reordering moved from a pair of arrow buttons to the row's own `⋯` menu.
  // Down then up is a round trip, so the authored order is what it started as.
  await bindingAction(page, "Heading → SectionHeading.heading", "Move down");
  await bindingAction(page, "Heading → SectionHeading.heading", "Move up");
  await expect(page.getByRole("combobox", { name: /^Transform for / }).first())
    .toHaveAccessibleName(/^Transform for Heading → SectionHeading\.heading/);

  // The Test modal is gone: Test re-runs the evaluation and brings the
  // Diagnostics tab forward. Its focus-restore contract went with the dialog —
  // there is no longer anything to escape from.
  await expectTestReports(page, /No diagnostics/);
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toHaveCount(0);

  // The seeded date binding is addressable by its source directly now; it used
  // to be found by scanning every binding's source `<select>` for a match.
  await expect(bindingRow(page, "Published on")).toHaveCount(1);
  await bindingAction(page, "Published on", "Remove binding");
  await expect(bindingRow(page, "Published on")).toHaveCount(0);

  // Binding starts from the freed prop's own chip, which offers only the
  // sources compatible with it — the add-binding form's two `<select>`s are
  // gone, and with them the chance of choosing an incompatible pair at all.
  await bindTarget(page, "ProseP.children", "journal-entry-date", /Review date/);
  const reviewDateTransform = bindingRow(page, "Review date").getByRole("combobox", { name: /^Transform for / });
  await expect(reviewDateTransform.locator("option")).toHaveText(["Pass through", "Format date", "Truncate to 160", "Add prefix"]);
  await reviewDateTransform.selectOption({ label: "Format date" });
  await selectEntry(page, /Start with the question.*article-first-question/);
  await expectTestReports(page, /not canonical YYYY-MM-DD/);
  await selectEntry(page, /Map the moving parts.*article-moving-parts/);
  await expectTestReports(page, /Optional source field "Review date" has no value/);
  // "Ready" was the modal's own word for it; the tab says it by carrying no
  // blocking diagnostic beside the nonblocking one.
  await expect(mappingInspector(page).getByText("Entry · nonblocking")).toBeVisible();
  await expect(mappingInspector(page).getByText(/· blocking/)).toHaveCount(0);
  await bindingAction(page, "Review date", "Remove binding");

  await bindTarget(page, "SectionHeading.as", "journal-entry-heading", /Heading/);
  await expectTestReports(page, /is not a current option/);
  await bindingAction(page, "Heading → SectionHeading.as", "Remove binding");

  await bindTarget(page, "ProseP.children", "journal-entry-date", /Published on/);
  await bindingRow(page, "Published on").getByRole("combobox", { name: /^Transform for / })
    .selectOption({ label: "Format date" });
  await expectTestReports(page, /No diagnostics/);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // The route publishes its save state through `useEditorStatus` now, so the
  // shell draws it — the editor has no status line of its own.
  await expect(saveStatus(page)).toContainText("Saved");

  // A record is its own URL since #171, so a reload lands back in the editor
  // rather than on the library.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Mapping name" })).toHaveValue(COLLECTION_MAPPING);

  await page.getByRole("link", { name: "Back to Mappings" }).click();
  await page.getByRole("button", { name: "New Mapping" }).click();
  const createMappingDialog = page.getByRole("dialog", { name: "Create Mapping" });
  await createMappingDialog.getByRole("textbox", { name: "Name" }).fill(SINGLE_MAPPING);
  await selectOptionMatching(createMappingDialog.getByRole("combobox", { name: "Content model" }), /Browser Site settings · single/);
  await createMappingDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("textbox", { name: "Mapping name" })).toHaveValue(SINGLE_MAPPING);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await page.goto("/composer");
  await page.getByRole("link", { name: "Journal entry page", exact: true }).click();
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
  await contentTree(page).getByRole("treeitem", { name: /^Journal articles/ }).click();
  // Three regions of the shared chrome, not three floating cards: they share a
  // top edge, sit inside the viewport, and never overlap.
  const regions = page.locator(".cms-editor__region");
  const regionGeometry = await regions.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, shadow: getComputedStyle(node).boxShadow };
  }));
  expect(regionGeometry).toHaveLength(3);
  expect(new Set(regionGeometry.map(({ top }) => Math.round(top))).size).toBe(1);
  expect(regionGeometry.every(({ bottom, shadow }) => bottom <= 900 && shadow === "none")).toBe(true);
  expect(regionGeometry[0]!.right).toBeLessThanOrEqual(regionGeometry[1]!.left);
  expect(regionGeometry[1]!.right).toBeLessThanOrEqual(regionGeometry[2]!.left);
  // Each pane scrolls inside itself rather than growing the page.
  const paneBodies = await page.locator(".cms-editor__region .cms-pane__body").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).overflowY));
  expect(paneBodies.length).toBeGreaterThan(0);
  expect(paneBodies.every((overflowY) => overflowY === "auto")).toBe(true);
  await expect(page.locator(".cms-topbar")).toHaveCSS("height", "48px");

  const themeColors: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    themeColors.push(await page.locator(".cms-editor__region .cms-pane").first().evaluate((node) => getComputedStyle(node).backgroundColor));
    await screenshot(page, testInfo, `content-desktop-${theme}`);
  }
  expect(themeColors[0]).not.toBe(themeColors[1]);

  await page.setViewportSize({ width: 375, height: 812 });
  // Below 64rem the rail leaves the side and becomes the bottom tab strip.
  await expect(page.locator(".cms-topbar")).toHaveCSS("height", "48px");
  await expect(page.locator(".cms-rail")).toHaveCSS("height", "56px");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const product of PRODUCT_LINKS) await expect(navigation.getByRole("link", { name: product, exact: true })).toBeVisible();
  // `EditorChrome` replaced the route's own tablist with the shared pane
  // switch. Scoped to the group: the toolbar also carries a Preview button.
  const contentPaneSwitch = page.getByRole("radiogroup", { name: "Pane" });
  await expectArrowRadios(page, contentPaneSwitch, ["Content", "Editor", "Preview"]);
  await expect(contentPaneSwitch.getByRole("radio").first()).toHaveCSS("outline-width", "2px");
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

  // Back to the navigator by position: hosts rename these panes freely.
  await contentPaneSwitch.getByRole("radio").nth(0).click();
  await expect(contentNav(page)).toBeVisible();
  await openRowMenu(page, "Journal articles");
  const deleteTrigger = contentNav(page).getByRole("button", { name: "More actions for Journal articles" });
  await page.getByRole("menuitem", { name: /^Delete model/ }).click();
  // The shared destructive question is an `alertdialog`, never a `dialog`.
  const dialog = page.getByRole("alertdialog", { name: "Delete model?" });
  await expect(page.getByRole("dialog", { name: "Delete model?" })).toHaveCount(0);
  const dialogStyle = await dialog.evaluate((node) => {
    const style = getComputedStyle(node);
    return { radius: Number.parseFloat(style.borderRadius), shadow: style.boxShadow };
  });
  expect(dialogStyle.radius).toBeGreaterThanOrEqual(4);
  expect(dialogStyle.radius).toBeLessThanOrEqual(12);
  expect(dialogStyle.shadow).not.toBe("none");
  // A destructive answer is never the one a stray Enter lands on.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deleteTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await screenshot(page, testInfo, `content-narrow-${theme}`);
  }
  await expectNoHorizontalOverflow(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".sg-content-app button").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  const milliseconds = (value: string) => value.split(",").map((part) => part.trim()).reduce((max, part) => Math.max(max, part.endsWith("ms") ? Number.parseFloat(part) : Number.parseFloat(part) * 1000), 0);
  expect(milliseconds(motion.animation)).toBeLessThanOrEqual(0.01);
  expect(milliseconds(motion.transition)).toBeLessThanOrEqual(0.01);

  await page.goto("/mapping");
  await mappingRow(page, COLLECTION_MAPPING).getByRole("link", { name: COLLECTION_MAPPING, exact: true }).click();
  // `EditorChrome` replaced the route's own tablist with the shared pane
  // switch, and the Mapping editor names its three panes Fields / Bindings /
  // Inspector. Scoped to the group, which is the habit the other two editors
  // already keep here.
  const mappingPaneSwitch = page.getByRole("radiogroup", { name: "Pane" });
  await expectArrowRadios(page, mappingPaneSwitch, ["Fields", "Bindings", "Inspector"]);
  await expectNoHorizontalOverflow(page);

  await mappingPaneSwitch.getByRole("radio", { name: "Bindings", exact: true }).click();
  await expect(page.getByRole("region", { name: "Bindings" })).toBeVisible();
  // The panes stopped being the surface that carries the rounding — `.cms-pane`
  // is a grid region with no radius of its own — so the flat-panel rule is read
  // where it now lives, on the bindings table's frame.
  await expectFlatPanels(page.locator(".cms-mapping-table .cms-table-wrap"));
  await expectNoHorizontalOverflow(page);

  // The route's arrow-navigable tablist survived the rewrite; it moved from the
  // workspace to the inspector, where the Diagnostics tab carries a count badge
  // that its accessible name has to tolerate.
  await mappingPaneSwitch.getByRole("radio", { name: "Inspector", exact: true }).click();
  await expectArrowTabs(page, "Inspector", [/^Preview$/, /^Diagnostics/]);
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
