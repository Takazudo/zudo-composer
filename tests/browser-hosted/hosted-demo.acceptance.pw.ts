import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { watchRuntimeFailures } from "../runtime-failures";

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
      const stream = "BT\n/F1 24 Tf\n72 72 Td\n(Hosted confirmation PDF) Tj\nET\n";
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

const ROUTES = [
  ["/", "Dashboard"],
  ["/composer", "Compositions"],
  ["/content", "Content"],
  ["/mapping", "Mappings"],
  ["/sitemapper", "Sitemaps"],
  ["/assets", "Assets"],
  ["/review", "Review & release"],
] as const;

async function waitForRoute(page: Page, title: string): Promise<void> {
  if (title === "Dashboard") {
    await expect(page.getByRole("main", { name: "Dashboard" })).toBeVisible();
    return;
  }
  await expect(page.locator("h1").first()).toHaveText(title);
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

function watchLocalEndpointRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/__zudo-") || /^\/(?:api|release|site-project)(?:\/|$)/u.test(path)) requests.push(`${request.method()} ${request.url()}`);
  });
  return requests;
}

async function screenshotWithGeometry(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const bytes = await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  expect(bytes.byteLength, `${name} screenshot should contain rendered UI`).toBeGreaterThan(5_000);
}

test.describe("hosted demo", () => {
  test("serves every authoring route after direct navigation and refresh", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    for (const [path, title] of ROUTES) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForRoute(page, title);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRoute(page, title);
    }
    for (const path of ["/website-preview", "/site"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content")).toBeVisible();
      await expect(page.getByText("Sample Studio", { exact: true }).first()).toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("main#main-content")).toBeVisible();
      await expect(page.getByText("Sample Studio", { exact: true }).first()).toBeVisible();
    }
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("keeps the hosted shell legible at required sizes and themes", async ({ page }, testInfo) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);

    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto("/review", { waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Review & release");
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
    const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
      schemaVersion?: number;
      id?: string;
      name?: string;
      providers?: Record<string, unknown>;
    };
    expect(exported.schemaVersion).toBe(2);
    expect(exported.id).toBe("sample-studio-site");
    expect(exported.name).toBe("Sample Studio");
    expect(exported.providers).toEqual(expect.objectContaining({ compositions: expect.any(Array), content: expect.any(Array), mappings: expect.any(Array), sitemaps: expect.any(Array) }));
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("16px");
    await screenshotWithGeometry(page, testInfo, "review-1440-light");

    await page.setViewportSize({ width: 1_000, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Review & release");
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("8px");
    await screenshotWithGeometry(page, testInfo, "review-1000-light");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Assets");
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator(".cms-library").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("8px");
    await screenshotWithGeometry(page, testInfo, "assets-390-light");

    await page.evaluate(() => localStorage.setItem("zudo-composer-theme", "dark"));
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Assets");
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe("dark");
    await expectNoHorizontalOverflow(page);
    await screenshotWithGeometry(page, testInfo, "assets-390-dark");

    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("uploads real PNG and PDF bytes, previews exact versions, and isolates tabs", async ({ page, context }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    await page.setViewportSize({ width: 1_000, height: 900 });
    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Assets");
    await expect(page.locator(".sg-assets-grid img")).toHaveCount(4);
    await expect.poll(() => page.locator(".sg-assets-grid img").evaluateAll((images) => images.map((image) => ({
      width: (image as HTMLImageElement).naturalWidth,
      height: (image as HTMLImageElement).naturalHeight,
    })))).toEqual(Array.from({ length: 4 }, () => ({ width: 480, height: 320 })));

    await page.getByRole("button", { name: "Inspect demo-lagoon.png", exact: true }).click();
    const seedInspector = page.getByRole("complementary", { name: "Asset details" });
    await expect(seedInspector).toBeVisible();
    await seedInspector.getByRole("button", { name: "Preview demo-lagoon.png", exact: true }).click();
    const seedDialog = page.getByRole("dialog", { name: "demo-lagoon.png" });
    await expect(seedDialog).toBeVisible();
    await expect(seedDialog.locator("img")).toHaveJSProperty("naturalWidth", 480);
    const seedVersion = await seedDialog.getByRole("link", { name: "Open exact immutable version" }).getAttribute("href");
    expect(seedVersion).toMatch(/^blob:/);
    expect((await digestObjectUrl(page, seedVersion!)).byteLength).toBeGreaterThan(0);
    await seedDialog.getByRole("button", { name: "Close", exact: true }).click();

    const uploadInput = page.locator(".sg-assets-upload input[type=file]");
    await uploadInput.setInputFiles([
      { name: "hosted-confirm-unique.png", mimeType: "image/png", buffer: PNG_BYTES },
      { name: "hosted-confirm-guide.pdf", mimeType: "application/pdf", buffer: PDF_BYTES },
    ]);
    const uploadStatus = page.getByRole("list", { name: "Upload status" });
    await expect(uploadStatus.getByText("Stored", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Inspect hosted-confirm-unique.png", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inspect hosted-confirm-guide.pdf", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Inspect hosted-confirm-unique.png", exact: true }).click();
    const pngInspector = page.getByRole("complementary", { name: "Asset details" });
    await pngInspector.getByRole("button", { name: "Preview hosted-confirm-unique.png", exact: true }).click();
    const pngDialog = page.getByRole("dialog", { name: "hosted-confirm-unique.png" });
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

    await page.getByRole("button", { name: "Inspect hosted-confirm-guide.pdf", exact: true }).click();
    const pdfInspector = page.getByRole("complementary", { name: "Asset details" });
    await pdfInspector.getByRole("button", { name: "Preview hosted-confirm-guide.pdf", exact: true }).click();
    const pdfDialog = page.getByRole("dialog", { name: "hosted-confirm-guide.pdf" });
    await expect(pdfDialog.locator("iframe")).toBeVisible();
    const pdfHref = await pdfDialog.getByRole("link", { name: "Open exact immutable version" }).getAttribute("href");
    expect(pdfHref).toMatch(/^blob:/);
    expect(await digestObjectUrl(page, pdfHref!)).toEqual({ byteLength: PDF_BYTES.byteLength, checksum: PDF_CHECKSUM });
    const pdfPopupPromise = page.waitForEvent("popup");
    await pdfDialog.getByRole("link", { name: "Open exact immutable version" }).click();
    const pdfPopup = await pdfPopupPromise;
    // Chromium's built-in PDF viewer owns this popup and exposes no normal DOM.
    await pdfPopup.close();
    await pdfDialog.getByRole("button", { name: "Close", exact: true }).click();

    const assetId = await page.locator(".sg-assets-inspector code").innerText();
    const authoringUrl = `${new URL(page.url()).origin}/uploaded-assets/asset-${assetId}`;
    expect((await page.evaluate(async (url) => (await fetch(url)).status, authoringUrl))).toBe(200);
    const secondTab = await context.newPage();
    await secondTab.goto("/assets", { waitUntil: "domcontentloaded" });
    await waitForRoute(secondTab, "Assets");
    await expect(secondTab.getByRole("button", { name: "Inspect hosted-confirm-unique.png", exact: true })).toHaveCount(0);
    expect(await secondTab.evaluate(async (url) => (await fetch(url)).status, authoringUrl)).toBe(404);
    await secondTab.close();

    await page.getByRole("link", { name: "Review & release", exact: true }).click();
    await waitForRoute(page, "Review & release");
    const workingPreviewPopupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Live working preview", exact: true }).click({ modifiers: ["Control"] });
    const workingPreviewPopup = await workingPreviewPopupPromise;
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
    await waitForRoute(page, "Assets");
    await expect(page.getByRole("button", { name: "Inspect hosted-confirm-unique.png", exact: true })).toHaveCount(0);
    await expect(page.locator(".sg-assets-grid img")).toHaveCount(4);
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("renders library previews and carries an edited composition into working preview", async ({ page }) => {
    const failures = watchRuntimeFailures(page);
    const localEndpointRequests = watchLocalEndpointRequests(page);
    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.goto("/composer", { waitUntil: "domcontentloaded" });
    await waitForRoute(page, "Compositions");
    await page.getByRole("radio", { name: "Cards", exact: true }).click();
    await expect(page.locator(".cms-composition-card")).toHaveCount(6);
    await expect(page.getByText("Rendered preview", { exact: true }).first()).toBeVisible();

    await page.goto("/composer?provider=files&composition=about-page", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue("About page");
    await expect.poll(() => page.locator(".sg-composer-preview-iframe").boundingBox().then((box) => box?.height ?? 0)).toBeGreaterThan(400);

    await page.goto("/composer?provider=files&composition=home-page", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Composition name", exact: true })).toHaveValue("Home page");
    await page.getByRole("treeitem", { name: /Hero.*Clear ideas/ }).click();
    const headingField = page.getByRole("textbox", { name: "Heading", exact: true });
    await expect(headingField).toBeVisible();
    await headingField.fill("Hosted confirmation heading");
    await headingField.blur();
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();

    await page.getByRole("radio", { name: "Preview", exact: true }).click();
    await expect(page.locator("iframe").first().contentFrame().getByText("Hosted confirmation heading", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Review & release", exact: true }).click();
    await waitForRoute(page, "Review & release");
    const workingPreviewPopupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Live working preview", exact: true }).click({ modifiers: ["Control"] });
    const workingPreviewPopup = await workingPreviewPopupPromise;
    await expect(workingPreviewPopup.getByText("Hosted confirmation heading", { exact: true })).toBeVisible();
    await expect(workingPreviewPopup.getByText("Live working preview — not activated", { exact: true })).toBeVisible();
    await workingPreviewPopup.close();

    await page.goto("/composer?provider=files&composition=home-page", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("textbox", { name: "Heading", exact: true })).toHaveValue("Clear ideas, carefully shaped");
    expect(localEndpointRequests, localEndpointRequests.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
