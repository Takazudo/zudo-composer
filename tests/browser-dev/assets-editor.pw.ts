import { expect, test, type Page } from "@playwright/test";
import type { AssetRecord } from "../../src/assets/model/types";
import { ensureDevWorkspace } from "./workspace-bootstrap";

async function imageBytes(page: Page, type: string, width = 800, height = 600): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ({ type, width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#34678a"; context.fillRect(0, 0, width, height);
    context.fillStyle = "#edbd65"; context.fillRect(width / 8, height / 8, width / 2, height / 2);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image encoding failed")), type, .9));
    if (blob.type !== type) throw new Error("Browser did not preserve fixture MIME");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { type, width, height }));
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<AssetRecord> {
  const response = page.waitForResponse((value) => value.request().headers()["x-zudo-composer-asset-operation"] === "upload");
  await page.locator('.sg-assets-upload input[type="file"]').setInputFiles({ name, mimeType, buffer });
  const saved = await response;
  expect(saved.ok()).toBe(true);
  const record = (await saved.json()).result as AssetRecord;
  await page.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  return record;
}

async function openEditor(page: Page) {
  await page.getByRole("complementary", { name: "Asset details" }).getByRole("button", { name: /Edit image/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit image:/ });
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect.poll(() => dialog.getByRole("region", { name: "Image editor", exact: true }).evaluate((editor) => editor.getBoundingClientRect().width)).toBeGreaterThan(300);
  return dialog;
}

test("image edits persist versions and copies while stale revisions retain the editor", async ({ page }) => {
  test.setTimeout(120_000);
  await ensureDevWorkspace(page);
  await page.goto("/assets");
  const name = `editor-${Date.now()}.png`;
  const original = await imageBytes(page, "image/png");
  const record = await upload(page, name, "image/png", original);
  const originalVersion = record.document.versions[0];
  let dialog = await openEditor(page);
  await dialog.getByRole("combobox", { name: "Crop aspect" }).selectOption("1");
  await dialog.getByRole("button", { name: "Rotate", exact: true }).click();
  await dialog.getByRole("button", { name: "Rotate 90° clockwise", exact: true }).click();
  await dialog.getByRole("button", { name: "Tone", exact: true }).click();
  await dialog.getByRole("spinbutton", { name: "brightness value", exact: true }).fill("20");
  await dialog.getByRole("spinbutton", { name: "brightness value", exact: true }).press("Tab");
  await dialog.getByRole("button", { name: "Resize", exact: true }).click();
  await dialog.getByRole("button", { name: "50%", exact: true }).click();
  const replaced = page.waitForResponse((value) => value.request().headers()["x-zudo-composer-asset-operation"] === "replace");
  await dialog.getByRole("button", { name: "Save", exact: true }).focus();
  await page.keyboard.press("Space");
  const replacementResponse = await replaced;
  expect(replacementResponse.ok()).toBe(true);
  const replacement = (await replacementResponse.json()).result as AssetRecord;
  expect(replacement.id).toBe(record.id);
  expect(replacement.revision).toBeGreaterThan(record.revision);
  expect(replacement.document.currentVersionId).not.toBe(record.document.currentVersionId);
  await expect(dialog).toBeHidden();
  const inspector = page.getByRole("complementary", { name: "Asset details" });
  await expect.poll(() => inspector.locator("img").evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([300, 300]);
  expect(await (await page.request.get(originalVersion.url)).body()).toEqual(original);

  dialog = await openEditor(page);
  const copied = page.waitForResponse((value) => value.request().headers()["x-zudo-composer-asset-operation"] === "upload");
  await dialog.getByRole("button", { name: "Save as copy", exact: true }).click();
  const copyResponse = await copied;
  expect(copyResponse.ok()).toBe(true);
  const copy = (await copyResponse.json()).result as AssetRecord;
  expect(copy.id).not.toBe(record.id);
  expect(copy.document.fileName).toBe(name.replace(/\.png$/, " (edited).png"));
  await expect(dialog).toBeHidden();
  await expect(inspector).toContainText(copy.id);

  await page.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  dialog = await openEditor(page);
  await page.evaluate(async (id) => {
    const path = "/src/app/provider-integration.ts";
    const { createProductionProviderIntegration } = await import(path);
    const integration = createProductionProviderIntegration();
    await integration.initialization.initialize();
    const store = integration.assetProvider.store;
    const loaded = await store.get(id);
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
    canvas.getContext("2d")!.fillRect(0, 0, 64, 32);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    await store.replace(id, blob, { expectedRevision: loaded.record.revision });
  }, record.id);
  const conflicted = page.waitForResponse((value) => value.request().headers()["x-zudo-composer-asset-operation"] === "replace");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  expect((await conflicted).ok()).toBe(false);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/changed|conflict|revision/i);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("JPEG and WebP editing retains MIME and GIF editing is disabled", async ({ page }) => {
  test.setTimeout(120_000);
  await ensureDevWorkspace(page);
  await page.goto("/assets");
  for (const [mimeType, extension] of [["image/jpeg", "jpg"], ["image/webp", "webp"]]) {
    const record = await upload(page, `editor-${Date.now()}.${extension}`, mimeType, await imageBytes(page, mimeType, 80, 60));
    const dialog = await openEditor(page);
    await dialog.getByRole("button", { name: "Resize", exact: true }).click();
    await dialog.getByRole("button", { name: "50%", exact: true }).click();
    const replaced = page.waitForResponse((value) => value.request().headers()["x-zudo-composer-asset-operation"] === "replace");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const response = await replaced; expect(response.ok()).toBe(true);
    const saved = (await response.json()).result as AssetRecord;
    expect(saved.id).toBe(record.id);
    expect(saved.document.versions.find(({ id }) => id === saved.document.currentVersionId)?.mimeType).toBe(mimeType);
    await expect(dialog).toBeHidden();
  }
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  await upload(page, `editor-${Date.now()}.gif`, "image/gif", gif);
  const gifEdit = page.getByRole("complementary", { name: "Asset details" }).getByRole("button", { name: /Edit image/ });
  await expect(gifEdit).toBeDisabled();
  await expect(gifEdit).toHaveAccessibleDescription("GIF editing is not supported yet");
});
