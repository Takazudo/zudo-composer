import { expect, test, type Locator, type Page, type Response, type TestInfo } from "@playwright/test";

const PRODUCT_LINKS = ["Composer", "Content", "Mapping", "Sitemapper", "Media"] as const;
const COLLECTION_MAPPING = "News to Product overview";
const SINGLE_MAPPING = "Site settings to Product overview";

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

async function selectEntry(page: Page, label: RegExp) {
  const select = page.getByRole("combobox", { name: "Sample Entry" });
  await selectOptionMatching(select, label);
}

async function selectOptionMatching(select: Locator, label: RegExp) {
  const value = await select.locator("option").filter({ hasText: label }).first().getAttribute("value");
  expect(value).not.toBeNull();
  await select.selectOption(value!);
}

test("same-context Content to Mapping to Composer preview to Sitemapper journey", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/content");
  await expect(page.getByRole("heading", { name: "Content authoring" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Content authoring" })).toBeVisible();
  const newsCard = page.locator(".sg-content-library > li").first();
  await newsCard.getByRole("button", { name: /^News Collection\s+Collection$/ }).click();
  await newsCard.getByRole("button", { name: /^Model fields/ }).click();
  await page.getByRole("textbox", { name: "Model name" }).fill("Browser News Collection");
  await page.getByRole("button", { name: "Add field" }).click();
  const slugField = page.locator(".sg-content-field").last();
  await slugField.getByRole("textbox", { name: "Label" }).fill("Route slug");
  await slugField.getByRole("textbox", { name: "Key" }).fill("routeSlug");
  await slugField.getByRole("radiogroup", { name: "Type for Route slug" }).getByRole("radio", { name: /^Slug\b/ }).click();
  await slugField.getByRole("button", { name: "Move up" }).click();
  await page.getByRole("button", { name: "Add field" }).click();
  const dateField = page.locator(".sg-content-field").last();
  await dateField.getByRole("textbox", { name: "Label" }).fill("Publish date");
  await dateField.getByRole("textbox", { name: "Key" }).fill("publishDate");
  await dateField.getByRole("radiogroup", { name: "Type for Publish date" }).getByRole("radio", { name: /^Date\b/ }).click();
  await expect(page.locator(".sg-content-save")).toContainText("All changes saved.");

  await newsCard.getByRole("button", { name: /^Entries/ }).click();
  await newsCard.getByRole("button", { name: "New Entry" }).click();
  await expect(page.locator(".sg-content-completeness")).toContainText("Incomplete draft");
  await page.getByRole("textbox", { name: "Title (required)" }).fill("Browser journey article");
  await page.getByRole("textbox", { name: "Body (required)" }).fill("## Browser journey\n\nSaved Content drives the Mapping preview.");
  await page.getByRole("textbox", { name: "Route slug" }).fill("東京");
  await page.getByLabel("Publish date").fill("2026-08-29");
  await expect(page.locator(".sg-content-completeness")).toContainText("Complete");

  const additionalSlugs = ["東京", ".", "", ...Array.from({ length: 20 }, (_, index) => `browser-${index + 5}`)];
  for (const [index, routeSlug] of additionalSlugs.entries()) {
    await newsCard.getByRole("button", { name: "New Entry" }).click();
    await expect(page.locator(".sg-content-completeness")).toContainText("Incomplete draft");
    await page.getByRole("textbox", { name: "Title (required)" }).fill(`Browser article ${index + 2}`);
    await page.getByRole("textbox", { name: "Body (required)" }).fill(`Body ${index + 2}`);
    if (routeSlug) await page.getByRole("textbox", { name: "Route slug" }).fill(routeSlug);
    await expect(page.locator(".sg-content-save")).toContainText("All changes saved.");
  }
  await expect(newsCard.getByRole("button", { name: /^Entries.*26/ })).toBeVisible();
  await page.reload();
  const browserNewsCard = page.locator(".sg-content-library > li").filter({ hasText: "Browser News Collection" });
  await browserNewsCard.getByRole("button", { name: /^Entries/ }).click();
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

  // A native date input cannot author a malformed date, so preserve one
  // provider-level stale value to prove Mapping diagnoses it without rewriting it.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zudo-composer-content", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(["models", "entries"], "readwrite");
    const model = await new Promise<{ document: { fields: Array<{ id: string; key: string }> } }>((resolve, reject) => {
      const request = transaction.objectStore("models").get("news-collection");
      request.onsuccess = () => resolve(request.result as { document: { fields: Array<{ id: string; key: string }> } });
      request.onerror = () => reject(request.error);
    });
    const dateFieldId = model.document.fields.find((field) => field.key === "publishDate")!.id;
    const entries = transaction.objectStore("entries");
    const entry = await new Promise<{ values: Record<string, unknown> } & Record<string, unknown>>((resolve, reject) => {
      const request = entries.get("news-entry-mapping");
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
  await page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}.*2 bindings.*Ready`) }).click();
  const frame = page.frameLocator('iframe[title="Resolved Mapping preview"]');
  await selectEntry(page, /Welcome to the newsroom.*news-entry-welcome/);
  await expect(frame.getByRole("heading", { name: "Welcome to the newsroom" })).toBeVisible();
  await selectEntry(page, /Mapping is ready.*news-entry-mapping/);
  await expect(frame.getByRole("heading", { name: "Mapping is ready" })).toBeVisible();

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

  const addBinding = page.locator(".sg-mapping-add-binding");
  await addBinding.getByRole("combobox", { name: "Source field" }).selectOption({ label: "Publish date · date" });
  await selectOptionMatching(addBinding.getByRole("combobox", { name: "Target field" }), /SectionHeading.*\/ Intro · text/);
  await addBinding.getByRole("button", { name: "Add binding" }).click();
  const dateBinding = page.locator(".sg-mapping-binding").last();
  await expect(dateBinding.getByRole("combobox", { name: "Transform" }).locator("option")).toHaveText(["Use value", "Format date (medium)", "Truncate to 160", "Add prefix"]);
  await dateBinding.getByRole("combobox", { name: "Transform" }).selectOption({ label: "Format date (medium)" });
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Blocked");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("not canonical YYYY-MM-DD");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await selectEntry(page, /Welcome to the newsroom.*news-entry-welcome/);
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Optional source field \"Publish date\" has no value");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Ready");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await dateBinding.getByRole("button", { name: "Remove" }).click();

  await selectEntry(page, /Mapping is ready.*news-entry-mapping/);
  await addBinding.getByRole("combobox", { name: "Source field" }).selectOption({ label: "Title · text" });
  await selectOptionMatching(addBinding.getByRole("combobox", { name: "Target field" }), /SectionHeading.*\/ Heading level · select/);
  await addBinding.getByRole("button", { name: "Add binding" }).click();
  const selectBinding = page.locator(".sg-mapping-binding").last();
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Blocked");
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("is not a current option");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await selectBinding.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".sg-mapping-save")).toContainText("saved", { ignoreCase: true });
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}`) }).click();
  await expect(page.getByRole("heading", { name: COLLECTION_MAPPING })).toBeVisible();

  await page.getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: "New Mapping" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create Mapping" });
  await createDialog.getByRole("textbox", { name: "Name" }).fill(SINGLE_MAPPING);
  await selectOptionMatching(createDialog.getByRole("combobox", { name: "Content model" }), /Browser Site settings · single/);
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: SINGLE_MAPPING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.goto("/composer");
  await page.getByRole("button", { name: "Open Product overview" }).click();
  const composerFrame = page.frameLocator('iframe[title="Composer preview canvas"]');
  await expect(composerFrame.getByRole("heading", { name: "Build a clear product story" })).toBeVisible();
  await expect(composerFrame.getByRole("heading", { name: "Mapping is ready" })).toHaveCount(0);

  await page.goto("/sitemapper");
  await expect(page.getByRole("heading", { name: "Sitemaps", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New sitemap" }).click();
  const createSitemapDialog = page.getByRole("dialog", { name: "Create sitemap" });
  await createSitemapDialog.getByRole("textbox", { name: "Sitemap name" }).fill("Content Mapping journey");
  await createSitemapDialog.getByRole("button", { name: "Create sitemap" }).click();
  const outline = page.getByRole("region", { name: "Sitemap outline" });
  await outline.getByRole("button", { name: "Home", exact: true }).click();
  const inspector = page.getByLabel("Inspector for Home");
  await expect(inspector.getByText("Current: Unassigned", { exact: true })).toBeVisible();
  await inspector.getByRole("textbox", { name: "Slug" }).fill("news/latest");
  await inspector.getByRole("textbox", { name: "Slug" }).blur();
  await inspector.getByRole("button", { name: "Choose Content Mapping" }).click();
  const mappingPicker = page.getByRole("dialog", { name: "Choose a Content Mapping" });
  await mappingPicker.getByRole("button", { name: `Assign ${COLLECTION_MAPPING}` }).click();
  await expect(inspector.getByText("Current: Content Mapping", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Browser News Collection · collection", { exact: true })).toBeVisible();
  await expect(inspector.locator("dt", { hasText: /^Entries$/ }).locator("..")).toContainText("26");
  await expect(inspector.getByText("/news/latest/browser-24", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Entry slug is missing or empty.", { exact: true }).first()).toBeVisible();
  await expect(inspector.getByText("Entry slug contains a forbidden route delimiter.", { exact: true })).toBeVisible();
  await expect(inspector.getByText(/Route \/news\/latest\/%E6%9D%B1%E4%BA%AC collides/).first()).toBeVisible();
  await expect(page.getByText(/Mapping route family · 22 routes · blocked/)).toBeVisible();
  await expect(outline.locator(".sg-sitemapper-tree-row")).toHaveCount(1);
  await inspector.getByRole("textbox", { name: "Slug" }).fill("https://example.test/news");
  await inspector.getByRole("textbox", { name: "Slug" }).blur();
  await expect(page.getByText(/Mapping route family · 0 routes · blocked/)).toBeVisible();
  await inspector.getByRole("textbox", { name: "Slug" }).fill("news/latest");
  await inspector.getByRole("textbox", { name: "Slug" }).blur();
  await expect(page.getByText(/Mapping route family · 22 routes · blocked/)).toBeVisible();

  await inspector.getByRole("button", { name: "Replace Mapping" }).click();
  await page.getByRole("dialog", { name: "Choose a Content Mapping" }).getByRole("button", { name: `Assign ${SINGLE_MAPPING}` }).click();
  await expect(inspector.getByText("Browser Site settings · single", { exact: true })).toBeVisible();
  await expect(inspector.getByText("single", { exact: true })).toBeVisible();
  await expect(inspector.getByText("/news/latest", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "Clear Mapping" }).click();
  await expect(inspector.getByText("Current: Unassigned", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "Choose composition" }).click();
  await page.getByRole("dialog", { name: "Choose a composition" }).getByRole("button", { name: /Assign Product overview from Browser storage/ }).click();
  await expect(inspector.getByText("Current: Static Composition", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All sitemaps" }).click();
  await page.getByRole("button", { name: "Content Mapping journey 1 page" }).click();
  await page.getByRole("region", { name: "Sitemap outline" }).getByRole("button", { name: /^Home\b/ }).click();
  await expect(page.getByLabel("Inspector for Home").getByText("Current: Static Composition", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "journey-sitemapper-static-persisted");

  expect(failures).toEqual([]);
});

test("focused broken Mapping refs remain visible and can be repaired", async ({ page }) => {
  const failures = watchRuntimeFailures(page);
  await page.goto("/mapping");
  await page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}`) }).click();
  await page.getByRole("button", { name: "Library" }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zudo-composer-mapping", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction("mappings", "readwrite");
    const store = transaction.objectStore("mappings");
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get("news-product-overview");
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    const document = structuredClone(record.document) as {
      contentModel: { providerId: string; recordId: string };
      composition: { providerId: string; recordId: string };
      bindings: Array<{ sourceFieldId: string; target: { nodeId: string; prop: string } }>;
    };
    document.contentModel.recordId = "missing-content-model";
    document.composition.recordId = "missing-composition";
    document.bindings[0]!.sourceFieldId = "missing-field";
    document.bindings[0]!.target = { nodeId: "missing-node", prop: "missing-prop" };
    store.put({ ...record, document });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => undefined;
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}.*Broken`) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}`) }).click();
  await expect(page.getByRole("combobox", { name: "Content model" })).toHaveValue(/missing-content-model/);
  await expect(page.getByRole("combobox", { name: "Composition" })).toHaveValue(/missing-composition/);
  await selectOptionMatching(page.getByRole("combobox", { name: "Content model" }), /News Collection · collection · Browser storage/);
  await selectOptionMatching(page.getByRole("combobox", { name: "Composition" }), /Product overview · Browser storage/);
  const broken = page.locator(".sg-mapping-binding[data-broken=true]");
  await expect(broken).toHaveCount(1);
  await broken.getByRole("combobox", { name: "Source" }).selectOption({ label: "Title · text" });
  await selectOptionMatching(broken.getByRole("combobox", { name: "Target" }), /SectionHeading.*Heading · text/);
  await expect(page.locator(".sg-mapping-binding[data-broken=true]")).toHaveCount(0);
  await page.getByRole("button", { name: "Test Mapping" }).click();
  await expect(page.getByRole("dialog", { name: "Mapping test" })).toContainText("Ready");
  await page.getByRole("dialog", { name: "Mapping test" }).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  expect(failures).toEqual([]);
});

test("desktop and narrow light-dark seams use accessible computed geometry", async ({ page }, testInfo) => {
  const failures = watchRuntimeFailures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/content");
  await page.getByRole("button", { name: /^News Collection\b/ }).click();
  const panes = page.locator(".sg-content-pane");
  await expectFlatPanels(panes);
  const paneGeometry = await panes.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflowY: style.overflowY };
  }));
  expect(new Set(paneGeometry.map(({ top }) => Math.round(top))).size).toBe(1);
  expect(paneGeometry.every(({ bottom, overflowY }) => bottom <= 900 && overflowY === "auto")).toBe(true);
  expect(paneGeometry[0]!.right).toBeLessThanOrEqual(paneGeometry[1]!.left);
  expect(paneGeometry[1]!.right).toBeLessThanOrEqual(paneGeometry[2]!.left);
  await expect(page.locator(".app-header")).toHaveCSS("min-height", "56px");

  const themeColors: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    themeColors.push(await page.locator(".sg-content-pane").first().evaluate((node) => getComputedStyle(node).backgroundColor));
    await screenshot(page, testInfo, `content-desktop-${theme}`);
  }
  expect(themeColors[0]).not.toBe(themeColors[1]);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".app-header")).toHaveCSS("min-height", "112px");
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
  const deleteTrigger = page.getByRole("button", { name: "Delete News Collection" });
  await deleteTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Delete model?" });
  const dialogStyle = await dialog.evaluate((node) => {
    const style = getComputedStyle(node); return { radius: style.borderRadius, shadow: style.boxShadow };
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
    const style = getComputedStyle(node); return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  const milliseconds = (value: string) => value.split(",").map((part) => part.trim()).reduce((max, part) => Math.max(max, part.endsWith("ms") ? Number.parseFloat(part) : Number.parseFloat(part) * 1000), 0);
  expect(milliseconds(motion.animation)).toBeLessThanOrEqual(0.01);
  expect(milliseconds(motion.transition)).toBeLessThanOrEqual(0.01);

  await page.goto("/mapping");
  await page.getByRole("button", { name: new RegExp(`^${COLLECTION_MAPPING}`) }).click();
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
  await expectArrowTabs(page, "Sitemapper panels", ["Outline", "Canvas", "Inspector"]);
  await expectNoHorizontalOverflow(page);
  for (const theme of ["light", "dark"] as const) {
    await useTheme(page, theme);
    await screenshot(page, testInfo, `sitemapper-narrow-${theme}`);
  }
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
