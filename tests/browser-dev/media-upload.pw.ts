import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ensureDevWorkspace } from "./workspace-bootstrap";
import { requireDevBrowserRoots } from "./isolated-roots";

const { mediaRoot } = requireDevBrowserRoots(process.env);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const REPLACEMENT = Buffer.concat([PNG, Buffer.from("synthetic-version-2")]);

test("versioned Media persists bytes, folders, identity and per-use Content text", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${process.pid}-${Date.now()}`;
  const fileName = `media-${suffix}.png`; const modelId = `media-test-${suffix}`;
  let assetId: string | undefined;
  await ensureDevWorkspace(page);
  // Seed only this test's synthetic Content destination through real domain
  // operations before Media mounts, so the picker never depends on the timing
  // of a cross-context IndexedDB notification to discover it.
  await page.evaluate(async ({ modelId }) => {
    const integrationPath = "/src/app/provider-integration.ts", contentPath = "/src/content/index.ts";
    const { createProductionProviderIntegration } = await import(integrationPath);
    const { createContentModelRecord, createContentEntryRecord } = await import(contentPath);
    const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
    await integration.contentProvider.store.putModel(createContentModelRecord({ name: modelId, kind: "collection", fields: [{ id: "picture", key: "picture", label: "Picture", required: false, kind: "media-use", use: "image" }] }, { id: modelId }));
    await integration.contentProvider.store.putEntry(createContentEntryRecord(modelId, {}, { id: modelId + "-entry" }));
  }, { modelId });
  await page.goto("/media");
  await expect(page.getByRole("heading", { name: "Media", exact: true })).toBeVisible();
  try {
    const responsePromise = page.waitForResponse((response) => response.request().headers()["x-zudo-composer-media-operation"] === "upload");
    await page.locator('.sg-media-upload input[type="file"]').setInputFiles({ name: fileName, mimeType: "image/png", buffer: PNG });
    const response = await responsePromise; expect(response.ok()).toBe(true);
    const record = (await response.json()).result; assetId = record.id;
    const oldUrl: string = record.document.versions[0].url;
    expect(record.document.currentVersionId).toBe(createHash("sha256").update(PNG).digest("hex"));
    const tile = page.locator(".sg-media-tile").filter({ hasText: fileName });
    await expect(tile).toHaveCount(1);
    await expect.poll(() => tile.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await readFile(join(mediaRoot, "versions", oldUrl.split("/").at(-1)!))).toEqual(PNG);
    await page.getByRole("button", { name: `Inspect ${fileName}` }).click();
    const inspector = page.getByRole("complementary", { name: "Asset details" });
    await inspector.getByLabel("Asset name", { exact: true }).fill(`renamed-${suffix}.png`);
    await inspector.getByLabel("Internal note").fill("A library-only note");
    await inspector.getByRole("button", { name: "Save details" }).click();
    await expect(inspector.getByRole("heading", { name: `renamed-${suffix}.png` })).toBeVisible();
    await inspector.getByRole("button", { name: "Use in content" }).click();
    const picker = page.getByRole("dialog", { name: "Use this asset" });
    await picker.getByLabel("Alternative text for this usage").fill("Context-specific accessible image text");
    const destination = picker.getByLabel("Content destination");
    await expect(destination.locator("option").filter({ hasText: modelId })).toHaveCount(1);
    await destination.selectOption({ label: `${modelId} / ${modelId}-entry / Picture` });
    await picker.getByRole("button", { name: "Use in content" }).click();
    await expect(picker).toBeHidden();
    await inspector.getByRole("button", { name: "Trash…" }).click();
    const trash = page.getByRole("dialog", { name: "Move assets to trash?" });
    await expect(trash.getByRole("button", { name: "Move to trash" })).toBeDisabled();
    await expect(trash).toContainText(modelId);
    await trash.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "New folder", exact: true }).click();
    const folderDialog = page.getByRole("dialog", { name: "New folder" });
    await folderDialog.getByLabel("Folder name").fill(`Folder ${suffix}`);
    await folderDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(folderDialog).toBeHidden();
    await inspector.getByRole("button", { name: "Move", exact: true }).click();
    const move = page.getByRole("dialog", { name: "Move assets" });
    await move.getByLabel("Destination folder").selectOption({ label: `Folder ${suffix}` });
    await move.getByRole("button", { name: "Save", exact: true }).click();
    await expect(move).toBeHidden();
    // The explicit Replace action captures the selected revision before the picker.
    await inspector.getByRole("button", { name: "Replace file", exact: true }).click();
    const replaced = page.waitForResponse((response) => response.request().headers()["x-zudo-composer-media-operation"] === "replace");
    await page.getByLabel("Replacement file").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: REPLACEMENT });
    expect((await (await replaced).json()).result.id).toBe(assetId);
    await page.reload();
    await page.getByRole("button", { name: `Inspect renamed-${suffix}.png` }).click();
    await expect(inspector).toContainText(assetId!);
    await expect(inspector).toContainText("Historical pin");
    await expect(inspector.getByLabel("Internal note")).toHaveValue("A library-only note");
    expect(await (await page.request.get(oldUrl)).body()).toEqual(PNG);
    const saved = await page.evaluate(async (modelId) => {
      const path = "/src/app/provider-integration.ts"; const { createProductionProviderIntegration } = await import(path);
      const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
      const loaded = await integration.contentProvider.store.getEntry(modelId + "-entry"); return loaded.record.values.picture;
    }, modelId);
    expect(saved.alt).toBe("Context-specific accessible image text"); expect(saved.asset.assetId).toBe(assetId);
    await page.evaluate(async (modelId) => { const path = "/src/app/provider-integration.ts"; const { createProductionProviderIntegration } = await import(path); const integration = createProductionProviderIntegration(); await integration.initialization.initialize(); await integration.contentProvider.store.deleteEntry(modelId + "-entry"); }, modelId);
    await inspector.getByRole("button", { name: "Trash…" }).click();
    await expect(trash.getByRole("button", { name: "Move to trash" })).toBeEnabled();
    await trash.getByRole("button", { name: "Move to trash" }).click();
    await expect(trash).toBeHidden();
    await page.getByRole("button", { name: /^Trash \d/ }).click();
    await page.getByRole("button", { name: `Inspect renamed-${suffix}.png` }).click();
    await inspector.getByRole("button", { name: "Restore asset" }).click();
    await expect(inspector).toContainText("Replace file");
  } finally {
    // Reversible Media cleanup: retain records/versions in trash, never unlink bytes.
    await page.evaluate(async ({ modelId, assetId, suffix }) => {
      const path = "/src/app/provider-integration.ts"; const { createProductionProviderIntegration } = await import(path);
      const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
      await integration.contentProvider.store.deleteEntry(modelId + "-entry"); await integration.contentProvider.store.deleteModel(modelId);
      if (assetId && integration.mediaProvider) { const current = await integration.mediaProvider.store.get(assetId); if (current.status === "loaded" && current.record.document.state === "active") await integration.mediaProvider.store.trash(assetId, { expectedRevision: current.record.revision }); }
      if (integration.mediaProvider) for (const folder of (await integration.mediaProvider.store.snapshot()).folders) if (folder.name === `Folder ${suffix}` && folder.state === "active") await integration.mediaProvider.store.trashFolder(folder.id, { expectedRevision: folder.revision });
    }, { modelId, assetId, suffix });
  }
});
