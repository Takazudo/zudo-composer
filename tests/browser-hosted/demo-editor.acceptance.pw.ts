import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { watchRuntimeFailures } from "../runtime-failures";
import { loadDemoEditorContext } from "./editor-context";

const context = await loadDemoEditorContext();

const AUTHORING_ROUTES = [
  ["/", "Dashboard"],
  ["/composer", "Compositions"],
  ["/composer/preview", "Composer preview"],
  ["/content", "Content"],
  ["/mapping", "Mappings"],
  ["/sitemapper", "Sitemaps"],
  ["/assets", "Assets"],
  ["/review", "Review & release"],
] as const;

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function validPdfBytes(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    (() => {
      const stream = "BT\n/F1 24 Tf\n72 72 Td\n(Demo confirmation PDF) Tj\nET\n";
      return `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`;
    })(),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source, "binary"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, "binary");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "binary");
}

const PDF_BYTES = validPdfBytes();
const PNG_CHECKSUM = createHash("sha256").update(PNG_BYTES).digest("hex");
const PDF_CHECKSUM = createHash("sha256").update(PDF_BYTES).digest("hex");

async function waitForAuthoringRoute(page: Page, title: string): Promise<void> {
  if (title === "Dashboard") {
    await expect(page.getByRole("main", { name: "Dashboard" })).toBeVisible();
    return;
  }
  if (title === "Composer preview") {
    await expect(page.locator("#app")).toBeVisible();
    return;
  }
  await expect(page.locator("h1").first()).toHaveText(title);
}

async function waitForDeliveryRoute(page: Page): Promise<void> {
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.locator(".zc-preview-strip")).toBeAttached();
}

async function navigateToReview(page: Page): Promise<void> {
  const reviewLink = page.getByRole("link", { name: "Review & release", exact: true });
  if (!(await reviewLink.isVisible())) await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await reviewLink.click();
  await waitForAuthoringRoute(page, "Review & release");
}

function expectDemoNotice(page: Page): Promise<void> {
  return expect(page.getByText("Public demo of zudo-composer", { exact: true }).first()).toBeVisible();
}

// On a delivery route the notice moved into the strip's shadow root, which
// Playwright's CSS engine pierces but its text selectors reach just the same.
function expectDeliveryDemoNotice(page: Page): Promise<void> {
  return expect(page.locator(".zc-preview-strip").getByText("Public demo of zudo-composer", { exact: true })).toBeVisible();
}

function watchLocalEndpointRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/__zudo-") || /^\/(?:api|release|site-project)(?:\/|$)/u.test(path)) requests.push(`${request.method()} ${request.url()}`);
  });
  return requests;
}

async function digestObjectUrl(page: Page, href: string): Promise<{ byteLength: number; checksum: string }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot read preview bytes: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return {
      byteLength: bytes.byteLength,
      checksum: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""),
    };
  }, href);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return scrollingElement.scrollWidth <= document.documentElement.clientWidth;
  })).toBe(true);
}

async function screenshotWithGeometry(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const bytes = await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  expect(bytes.byteLength, `${name} screenshot should contain rendered UI`).toBeGreaterThan(5_000);
}

/** Find the editor control for the host-derived inline text field. */
async function selectEditableTextField(page: Page): Promise<Locator> {
  const escapedTitle = context.editableText.componentTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titledTreeItems = page.getByRole("treeitem", { name: new RegExp(`^${escapedTitle}(?:\\s|$)`) });
  const treeItems = await titledTreeItems.count() > 0 ? titledTreeItems : page.getByRole("treeitem");
  const controls = () => page.locator('.sg-composer-inspector-row input[type="text"], .sg-composer-inspector-row textarea');
  for (let index = 0; index < await treeItems.count(); index++) {
    await treeItems.nth(index).click();
    const candidates = controls();
    for (let candidate = 0; candidate < await candidates.count(); candidate++) {
      const control = candidates.nth(candidate);
      if (await control.isVisible() && await control.inputValue() === context.editableText.originalValue) return control;
    }
  }
  throw new Error(`Could not select ${context.editableText.componentTitle}.${context.editableText.fieldProp} in the Composer inspector.`);
}

/**
 * A plain click is the real path now that the delivery links carry
 * `target="_blank"`: the hosted demo's capturing handler prevents the default
 * and re-opens the URL itself so the preview keeps a `window.opener` to read
 * its one-use snapshot from.
 */
async function openDeliveryPopup(page: Page, name: string): Promise<Page> {
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name, exact: true }).click();
  return popupPromise;
}

async function openWorkingPreview(page: Page): Promise<Page> {
  return openDeliveryPopup(page, "Live working preview");
}

/** A compiled site route below the root, used for the nested-reload checks. */
const nestedRoute = context.manifest.routes.find((route) => route.startsWith("/site/"))?.slice("/site".length);

/**
 * A Structure tree row action lives in `.cms-tree-acts`, which is
 * `width: 0; opacity: 0` until its row is `:focus-within` — Playwright's
 * actionability check waits on a zero-size element forever. Focusing the
 * button itself (no actionability check) gives it a box first.
 */
async function treeRowAction(structure: Locator, action: string): Promise<void> {
  const button = structure.getByRole("button", { name: action, exact: true });
  await button.focus();
  await button.click();
}

test.describe(`demo editor: ${context.name}`, () => {
  test("serves every authoring and delivery route after direct navigation and refresh", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    for (const [path, title] of AUTHORING_ROUTES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForAuthoringRoute(page, title);
      if (path !== "/composer/preview") await expectDemoNotice(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForAuthoringRoute(page, title);
      if (path !== "/composer/preview") await expectDemoNotice(page);
    }
    for (const path of ["/site", "/website-preview"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForDeliveryRoute(page);
      await expectDeliveryDemoNotice(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForDeliveryRoute(page);
      await expectDeliveryDemoNotice(page);
    }
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("opens the working preview in a new tab from the rail and from Review & release", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Dashboard");
    const railPopup = await openDeliveryPopup(page, "Website preview — choose preview source");
    await waitForDeliveryRoute(railPopup);
    await expectDeliveryDemoNotice(railPopup);
    await railPopup.close();

    await navigateToReview(page);
    for (const link of ["Live working preview", "Demo website preview"]) {
      const popup = await openDeliveryPopup(page, link);
      await waitForDeliveryRoute(popup);
      await expectDeliveryDemoNotice(popup);
      await popup.close();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("serves a nested delivery route on direct load and on reload", async ({ page }) => {
    test.skip(nestedRoute === undefined, "This host compiles only the site root.");
    const failures = watchRuntimeFailures(page);
    for (const basePath of ["/site", "/website-preview"]) {
      await page.goto(`${basePath}${nestedRoute}`, { waitUntil: "domcontentloaded" });
      await waitForDeliveryRoute(page);
      await expectDeliveryDemoNotice(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForDeliveryRoute(page);
      await expectDeliveryDemoNotice(page);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("reports a blocked preview pop-up in the authoring document", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Dashboard");
    await navigateToReview(page);
    await page.evaluate(() => { window.open = () => null; });
    await page.getByRole("link", { name: "Live working preview", exact: true }).click();
    await expect(page.locator('#hosted-demo-error[role="alert"]')).toContainText("blocked");
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("falls back to the bundled sample when the preview reloads without its token", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Dashboard");
    await navigateToReview(page);
    const popup = await openWorkingPreview(page);
    await waitForDeliveryRoute(popup);
    // The preview strips `#demoPreview` before the exchange, so the reload
    // carries no token and must land on the bundled public sample.
    expect(new URL(popup.url()).hash).toBe("");
    await popup.reload({ waitUntil: "domcontentloaded" });
    await waitForDeliveryRoute(popup);
    await expectDeliveryDemoNotice(popup);
    await popup.close();
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("reports a handoff that never answers and survives a preview closed mid-handoff", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Dashboard");
    // An unknown token is never in the owner's ticket map, so no response ever
    // comes and the preview document reports the 10s handoff timeout.
    const orphanPromise = page.waitForEvent("popup");
    await page.evaluate(() => { window.open("/website-preview#demoPreview=never-issued", "_blank"); });
    const orphan = await orphanPromise;
    await expect(orphan.getByText("Demo preview handoff timed out. Open it again from the owning tab.", { exact: true })).toBeVisible({ timeout: 20_000 });
    await orphan.close();

    await navigateToReview(page);
    const closedEarly = await openWorkingPreview(page);
    await closedEarly.close();

    // The dropped ticket must not poison the owner: a later preview still
    // receives its snapshot.
    const reopened = await openWorkingPreview(page);
    await waitForDeliveryRoute(reopened);
    await expectDeliveryDemoNotice(reopened);
    await reopened.close();
  });

  test("seeds exactly the editor manifest assets", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Assets");
    await expect(page.locator(".sg-assets-grid .sg-assets-tile")).toHaveCount(context.assetCount);
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("carries a host-derived composition text edit through both previews and resets on reload", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    const detail = `/composer?provider=${encodeURIComponent(context.editableText.providerId)}&composition=${encodeURIComponent(context.editableText.compositionId)}`;
    const edited = `Browser edit — ${context.name}`;
    await page.goto(detail, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue(context.editableText.compositionName);
    const field = await selectEditableTextField(page);
    await expect(field).toHaveValue(context.editableText.originalValue);
    await field.fill(edited);
    await field.blur();
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();

    await page.getByRole("radio", { name: "Preview", exact: true }).click();
    await expect(page.locator("iframe").first().contentFrame().getByText(edited, { exact: true })).toBeVisible();

    await navigateToReview(page);
    const workingPreviewPopup = await openWorkingPreview(page);
    await expect(workingPreviewPopup.getByText(edited, { exact: true })).toBeVisible();
    await expect(workingPreviewPopup.getByText("Live working preview — not activated", { exact: true })).toBeVisible();
    await workingPreviewPopup.close();

    await page.goto(detail, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue(context.editableText.compositionName);
    const resetField = await selectEditableTextField(page);
    await expect(resetField).toHaveValue(context.editableText.originalValue);
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("shows the webshop's category-page region rule in the chooser, structure tree and new-composition dialog", async ({ page }) => {
    test.skip(context.name !== "shop", "The Category page region rule belongs to the webshop host.");
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    // Pack size comes from the editor seed rather than a hardcoded count, so
    // this test tracks the shop component pack instead of a number that would
    // silently drift when a component is added or removed.
    const packSize = context.seed.componentPack.components.length;

    const detail = `/composer?provider=${encodeURIComponent(context.editableText.providerId)}&composition=cat-desk`;
    await page.goto(detail, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue("Desk shelf");

    const structure = page.locator(".cms-editor__region--nav");
    const documentRow = structure.getByRole("treeitem").filter({ hasText: "Document" });
    await expect(documentRow.locator(".cms-tree-tag")).toHaveText("4 kinds");

    await treeRowAction(structure, "Add component to the document");
    // The composition root is bound to the Category page template's outlet,
    // so the dialog names the outlet's own label ("Main content") rather than
    // "Document root".
    const chooser = page.getByRole("dialog", { name: /^Add to /i });
    await expect(chooser).toBeVisible();
    const ruleHeader = chooser.locator("[data-chooser-rule]");
    await expect(ruleHeader).toBeVisible();
    await expect(ruleHeader.locator(".sg-composer-chooser-rule-chips li")).toHaveCount(4);

    const hiddenSummary = chooser.locator(".sg-composer-chooser-hidden-summary");
    const hiddenSummaryText = await hiddenSummary.innerText();
    const hiddenMatch = /^(\d+) hidden by this region's rule/.exec(hiddenSummaryText);
    expect(hiddenMatch, hiddenSummaryText).not.toBeNull();
    // The disclosure hides the rest of the pack minus the 4 accepted kinds
    // and the origin component (`shop.category-body`) itself.
    expect(Number(hiddenMatch![1])).toBe(packSize - 4 - 1);
    await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(chooser).toHaveCount(0);

    await page.goto("/composer", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New composition", exact: true }).click();
    const newCompositionDialog = page.getByRole("dialog", { name: "New composition", exact: true });
    await expect(newCompositionDialog).toBeVisible();
    const startFrom = newCompositionDialog.locator('[aria-label="Start from"]');
    await expect(startFrom.getByRole("button", { name: /Category page/ })).toContainText("4 kind");
    await expect(startFrom.getByRole("button", { name: /Site frame/ })).toContainText("Open");
    await newCompositionDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(newCompositionDialog).toHaveCount(0);

    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("keeps Sample Studio's review, export, upload and layout checks", async ({ page, context: browserContext }, testInfo) => {
    test.skip(context.name !== "sample", "The deeper review/upload/layout contract belongs to Sample Studio.");
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto("/review", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Review & release");
    await expect(page.locator(".cms-release__card")).toHaveCount(3);
    const inspect = page.getByRole("button", { name: "Inspect current state", exact: true });
    await expect(inspect).toBeEnabled();
    await inspect.click();
    const exportButton = page.getByRole("button", { name: "Export working JSON", exact: true });
    await expect(exportButton).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("working-site-project.json");
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as { schemaVersion?: number; id?: string; name?: string; providers?: Record<string, unknown> };
    expect(exported.schemaVersion).toBe(2);
    expect(exported.id).toBe(context.project.id);
    expect(exported.name).toBe(context.project.name);
    expect(exported.providers).toEqual(expect.objectContaining({ compositions: expect.any(Array), content: expect.any(Array), mappings: expect.any(Array), sitemaps: expect.any(Array) }));
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("16px");
    await screenshotWithGeometry(page, testInfo, "review-1440-light");

    await page.setViewportSize({ width: 1_000, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Review & release");
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("8px");
    await screenshotWithGeometry(page, testInfo, "review-1000-light");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Assets");
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("8px");
    await screenshotWithGeometry(page, testInfo, "assets-390-light");

    await page.evaluate(() => localStorage.setItem("zudo-composer-theme", "dark"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Assets");
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");
    await expectNoHorizontalOverflow(page);
    await screenshotWithGeometry(page, testInfo, "assets-390-dark");

    const uploadInput = page.locator(".sg-assets-upload input[type=file]");
    await uploadInput.setInputFiles([
      { name: "sample-confirm-unique.png", mimeType: "image/png", buffer: PNG_BYTES },
      { name: "sample-confirm-guide.pdf", mimeType: "application/pdf", buffer: PDF_BYTES },
    ]);
    const uploadStatus = page.getByRole("list", { name: "Upload status" });
    await expect(uploadStatus.getByText("Stored", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Inspect sample-confirm-unique.png", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inspect sample-confirm-guide.pdf", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Inspect sample-confirm-unique.png", exact: true }).click();
    const pngInspector = page.getByRole("complementary", { name: "Asset details" });
    await pngInspector.getByRole("button", { name: "Preview sample-confirm-unique.png", exact: true }).click();
    const pngDialog = page.getByRole("dialog", { name: "sample-confirm-unique.png" });
    await expect(pngDialog.locator("img")).toHaveJSProperty("naturalWidth", 1);
    const uploadedPngAssetId = await pngInspector.locator("code").innerText();
    const pngHref = await pngDialog.getByRole("link", { name: "Open exact immutable version" }).getAttribute("href");
    expect(pngHref).toMatch(/^blob:/);
    expect(await digestObjectUrl(page, pngHref!)).toEqual({ byteLength: PNG_BYTES.byteLength, checksum: PNG_CHECKSUM });
    const pngPopupPromise = page.waitForEvent("popup");
    await pngDialog.getByRole("link", { name: "Open exact immutable version" }).click();
    const pngPopup = await pngPopupPromise;
    await expect(pngPopup.locator("img")).toHaveJSProperty("naturalWidth", 1);
    await pngPopup.close();
    await pngDialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Inspect sample-confirm-guide.pdf", exact: true }).click();
    const pdfInspector = page.getByRole("complementary", { name: "Asset details" });
    await pdfInspector.getByRole("button", { name: "Preview sample-confirm-guide.pdf", exact: true }).click();
    const pdfDialog = page.getByRole("dialog", { name: "sample-confirm-guide.pdf" });
    await expect(pdfDialog.locator("iframe")).toBeVisible();
    const pdfHref = await pdfDialog.getByRole("link", { name: "Open exact immutable version" }).getAttribute("href");
    expect(pdfHref).toMatch(/^blob:/);
    expect(await digestObjectUrl(page, pdfHref!)).toEqual({ byteLength: PDF_BYTES.byteLength, checksum: PDF_CHECKSUM });
    const pdfPopupPromise = page.waitForEvent("popup");
    await pdfDialog.getByRole("link", { name: "Open exact immutable version" }).click();
    const pdfPopup = await pdfPopupPromise;
    await pdfPopup.close();
    await pdfDialog.getByRole("button", { name: "Close", exact: true }).click();

    const assetId = await page.locator(".sg-assets-inspector code").innerText();
    const authoringUrl = `${new URL(page.url()).origin}/uploaded-assets/asset-${assetId}`;
    expect(await page.evaluate(async (url) => (await fetch(url)).status, authoringUrl)).toBe(200);
    const secondTab = await browserContext.newPage();
    await secondTab.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(secondTab, "Assets");
    await expect(secondTab.getByRole("button", { name: "Inspect sample-confirm-unique.png", exact: true })).toHaveCount(0);
    expect(await secondTab.evaluate(async (url) => (await fetch(url)).status, authoringUrl)).toBe(404);
    await secondTab.close();

    await navigateToReview(page);
    const workingPreviewPopup = await openWorkingPreview(page);
    await expect(workingPreviewPopup.getByText("Live working preview — not activated", { exact: true })).toBeVisible();
    const uploadedPreview = await workingPreviewPopup.evaluate(async (path) => new Promise<{ width: number; height: number }>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ width: 0, height: 0 });
      image.src = path;
      document.body.append(image);
    }), `/uploaded-assets/asset-${uploadedPngAssetId}`);
    expect(uploadedPreview).toEqual({ width: 1, height: 1 });
    await workingPreviewPopup.close();

    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForAuthoringRoute(page, "Assets");
    await expect(page.getByRole("button", { name: "Inspect sample-confirm-unique.png", exact: true })).toHaveCount(0);
    await expect(page.locator(".sg-assets-grid .sg-assets-tile")).toHaveCount(context.assetCount);
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
