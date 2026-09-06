import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function currentProject(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/app/provider-integration.ts";
    const { createProductionProviderIntegration } = await import(path);
    const integration = createProductionProviderIntegration();
    const result = await integration.getCurrentSiteProject();
    if (result.status !== "ready") throw result.error;
    return { project: result.project, workspaceId: integration.workspace.id };
  });
}
async function changeDraft(page: Page, title: string) {
  return page.evaluate(async (title) => {
    const path = "/src/app/provider-integration.ts";
    const { createProductionProviderIntegration } = await import(path);
    const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
    const loaded = await integration.contentProvider.store.getEntry("news-supply-notes");
    if (loaded.status !== "loaded") throw new Error("Expected the example's real draft entry.");
    const snapshot = await integration.contentProvider.store.readAll();
    await integration.contentProvider.store.putEntry({ ...loaded.record, values: { ...loaded.record.values, "news-title": title } });
    return { mutationToken: snapshot.mutationToken, record: loaded.record };
  }, title);
}
const responseFor = (page: Page, operation: string) => page.waitForResponse((response) => {
  try { return response.request().postDataJSON()?.request?.operation === operation; } catch { return false; }
});

/** Registered LAST by the existing guarded SiteProject spec. The manager's
 * disposable release root is mandatory; this is never run against a user store.
 * Fixture amplification uses real provider transactions, not fake UI success.
 */
export function registerCatalogJourney(lane: string) {
  test("catalog example: persistent graph, >25 references, query pins, Media versions and local immutable release", async ({ page, context }, info) => {
    test.skip(lane !== "dev", "This authoring/activation journey belongs only to the isolated local release lane.");
    expect(process.env.ZUDO_SITE_PROJECT_ROOT, "Guarded runner must supply a disposable release root").toBeTruthy();
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const before = await currentProject(page);
    await page.getByRole("button", { name: "Create catalog & editorial example", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await currentProject(page)).workspaceId).toBe(before.workspaceId);
    await page.getByRole("button", { name: "Create catalog & editorial example", exact: true }).click();
    await page.getByRole("button", { name: "Confirm create separate project", exact: true }).click();
    await expect(page.getByRole("button", { name: "Return to previous workspace" })).toBeVisible();
    const loaded = await currentProject(page); expect(loaded.project.id).toBe("catalog-editorial-example");
    expect(loaded.workspaceId).toBe("example-catalog-editorial-v1");
    await page.reload(); expect(await currentProject(page)).toEqual(loaded);
    let ownedAssetId = "", ownedVersionChecksum = "";

    await test.step("generic named pins address canonical task views without renaming model data", async () => {
      await page.getByRole("button", { name: "Products actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Pin Writing task", exact: true }).click();
      const pinned = page.getByRole("list", { name: "Pinned views", exact: true });
      await pinned.getByRole("link", { name: "Writing task", exact: true }).click();
      await expect(page).toHaveURL(/model=catalog-products.*view=product-writing/);
      await page.getByRole("button", { name: "Writing task pin actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Rename pin", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Rename pin", exact: true });
      await dialog.getByLabel("Pin label").fill("Product writing shortcut");
      await dialog.getByRole("button", { name: "Save label", exact: true }).click();
      await page.reload();
      await expect(pinned.getByRole("link", { name: "Product writing shortcut", exact: true })).toBeVisible();
      expect((await currentProject(page)).project).toEqual(loaded.project);
    });

    await test.step("real reference catalog loads beyond the first page and preserves explicit relation order", async () => {
      await page.evaluate(async () => {
        const path = "/src/app/provider-integration.ts", modelPath = "/src/content/index.ts";
        const { createProductionProviderIntegration } = await import(path);
        const { createContentModelRecord, createContentEntryRecord } = await import(modelPath);
        const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
        const store = integration.contentProvider.store;
        await store.putModel(createContentModelRecord({ name: "Browser reference targets", description: "Invented pagination probe", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", kind: "text", required: true }] }, { id: "browser-targets" }));
        await store.putModel(createContentModelRecord({ name: "Browser reference owner", description: "Canonical ordered references", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", kind: "text", required: true }, { id: "related", key: "related", label: "Related targets", kind: "reference-list", ordered: true, required: false, target: { providerId: "content-indexeddb", recordId: "browser-targets" } }] }, { id: "browser-owner" }));
        for (let i = 0; i < 31; i++) await store.putEntry(createContentEntryRecord("browser-targets", { title: `Target ${String(i).padStart(2, "0")}` }, { id: `browser-target-${i}` }));
        await store.putEntry(createContentEntryRecord("browser-owner", { title: "Reference owner", related: [] }, { id: "browser-owner-entry" }));
      });
      await page.goto("/content?provider=content-indexeddb&model=browser-owner&entry=browser-owner-entry");
      await page.getByRole("checkbox", { name: /^Target 30/ }).check();
      await page.getByRole("checkbox", { name: /^Target 00/ }).check();
      await expect(page.locator(".cms-topbar__status")).toContainText("Saved");
      await page.reload();
      await expect(page.locator(".sg-content-order li > span")).toHaveText(["Target 30", "Target 00"]);
      await page.getByRole("tab", { name: "Raw", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Exact field-ID storage" })).toBeVisible();
      const raw = JSON.parse(await page.locator(".sg-content-raw section").filter({ has: page.getByRole("heading", { name: "Exact field-ID storage" }) }).locator("pre").innerText());
      expect(raw.values.related.map((ref: { recordId: string }) => ref.recordId)).toEqual(["browser-target-30", "browser-target-0"]);
    });

    await test.step("query pins, nested ancestor contexts, menus and real Composition cards", async () => {
      await page.goto("/mapping?provider=mapping-indexeddb&mapping=catalog-latest-news-mapping");
      await expect(page.locator(".cms-mapping-query__result li")).toHaveCount(2);
      await page.getByRole("button", { name: "Choose", exact: true }).click();
      const pins = page.getByRole("dialog", { name: "Choose ordered pins" });
      await pins.getByRole("checkbox", { name: /Material notes/ }).check();
      await pins.getByRole("button", { name: "Save pins" }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator(".cms-topbar__status")).toContainText("Saved"); await page.reload();
      await expect(page.locator(".cms-mapping-query__pins li").first()).toContainText("news-material-notes");
      await page.goto("/sitemapper?provider=sitemap-indexeddb&sitemap=catalog-editorial-sitemap");
      const views = page.getByRole("radiogroup", { name: "View", exact: true });
      const expandCatalog = page.getByRole("button", { name: "Expand Catalog", exact: true });
      if (await expandCatalog.isVisible()) await expandCatalog.click();
      await expect(page.getByRole("button", { name: "Add child page to Products", exact: true })).toBeEnabled();
      for (const name of ["Canvas", "Outline", "Routes", "Navigation"]) { await views.getByRole("radio", { name, exact: true }).click(); await expect(views.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true"); }
      await expect(page.getByLabel("External shop external URL")).toHaveValue("https://shop.example.test/catalog");
      await page.goto("/composer");
      await page.getByRole("radio", { name: "Cards", exact: true }).click();
      const card = page.locator(".cms-composition-card").filter({ hasText: "Catalog home" });
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText("Rendered preview", { exact: true })).toBeVisible();
      await card.getByRole("button", { name: "Preview", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Preview — Catalog home" });
      await expect(dialog.locator("iframe")).toBeVisible();
      await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
      await page.goto("/website-preview/catalog/products/quiet-timer/guides/starting-with-one-interval");
      await expect(page.getByRole("heading", { name: "Starting with one interval", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Read about the related product" })).toHaveAttribute("href", "/website-preview/catalog/products/quiet-timer");
    });

    await test.step("actual uploaded replacement retains old immutable bytes", async () => {
      const a = Buffer.from("%PDF-1.4\nCMS browser owned version A\n%%EOF\n");
      const b = Buffer.from("%PDF-1.4\nCMS browser owned version B\n%%EOF\n");
      const fileName = `browser-owned-version-${Date.now()}-${process.pid}.pdf`;
      await page.goto("/media");
      const uploading = page.waitForResponse((response) => response.request().headers()["x-zudo-composer-media-operation"] === "upload");
      await page.locator('.sg-media-upload input[type="file"]').setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: a });
      const record = (await (await uploading).json()).result;
      await page.getByRole("button", { name: `Inspect ${fileName}` }).click();
      await page.getByRole("complementary", { name: "Asset details" }).getByRole("button", { name: "Replace file", exact: true }).click();
      const replacing = page.waitForResponse((response) => response.request().headers()["x-zudo-composer-media-operation"] === "replace");
      await page.getByLabel("Replacement file").setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: b });
      const next = (await (await replacing).json()).result;
      ownedAssetId = next.id; ownedVersionChecksum = createHash("sha256").update(b).digest("hex");
      expect(next.id).toBe(record.id); expect(next.document.versions).toHaveLength(2);
      for (const [version, bytes] of [[record.document.versions[0], a], [next.document.versions.find((version: { id: string }) => version.id === next.document.currentVersionId), b]] as const) {
        expect(version.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
        const response = await page.request.get(version.url); expect(response.ok()).toBe(true); expect(await response.body()).toEqual(bytes);
      }
      await page.evaluate(async (assetId) => {
        const path = "/src/app/provider-integration.ts";
        const { createProductionProviderIntegration } = await import(path);
        const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
        const entry = await integration.contentProvider.store.getEntry("product-quiet-timer");
        if (entry.status !== "loaded") throw new Error("Expected the owned example Product.");
        await integration.contentProvider.store.putEntry({ ...entry.record, values: { ...entry.record.values, "product-resource": { kind: "link", asset: { providerId: integration.mediaProvider.descriptor.id, assetId }, label: "Browser-owned exact version dependency" } } });
      }, ownedAssetId);
    });

    await test.step("review invalidates cross-tab approval and stages an exact candidate while newer drafts remain private", async () => {
      await page.goto("/review"); await expect(page.getByText(/Local release only/)).toBeVisible();
      await expect(page.getByRole("checkbox").first()).toBeVisible();
      for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
      await page.getByRole("checkbox", { name: /news-supply-notes/ }).uncheck();
      await page.getByRole("button", { name: "Run release checks", exact: true }).click();
      await expect(page.getByRole("button", { name: "Approve reviewed candidate" })).toBeEnabled();
      const other = await context.newPage(); await other.goto("/"); const stale = await changeDraft(other, "Draft edited in another tab");
      const conflict = await page.evaluate(async (stale) => {
        const path = "/src/app/provider-integration.ts";
        const { createProductionProviderIntegration } = await import(path);
        const integration = createProductionProviderIntegration(); await integration.initialization.initialize();
        try { await integration.contentProvider.store.transact({ expectedMutationToken: stale.mutationToken, operations: [{ kind: "put-entry", record: stale.record }] }); return "unexpected success"; }
        catch (error) { return (error as { code: string }).code; }
      }, stale);
      expect(conflict).toBe("conflict");
      await expect(page.getByRole("button", { name: "Approve reviewed candidate" })).toBeDisabled();
      await page.getByRole("button", { name: "Run release checks", exact: true }).click();
      await page.getByRole("button", { name: "Approve reviewed candidate" }).click();
      const applied = responseFor(page, "apply"); await page.getByRole("button", { name: "Apply / stage exact candidate" }).click();
      const staged = (await (await applied).json()).result;
      expect(staged.stageGeneration).toBeGreaterThan(0);
      expect(staged.staged.mediaLock.pins).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: ownedAssetId, checksum: ownedVersionChecksum })]));
      await changeDraft(other, "Newer private working B"); await other.close();
      await page.getByRole("button", { name: "Build staged candidate" }).click();
      await page.getByRole("button", { name: "Activate locally", exact: true }).click();
      await expect(page.getByText(/Activated locally\. Publication reconciliation/)).toBeVisible();
      await page.goto("/site");
      await expect(page.getByRole("heading", { name: "Useful objects for a clearer day" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link")).toHaveText(["Home", "Catalog", "Journal", "Support"]);
      await expect(page.getByRole("link", { name: "External shop", exact: true })).toHaveAttribute("href", "https://shop.example.test/catalog");
      await expect(page.getByText("Material notes for a shared shelf", { exact: true })).toBeVisible();
      await page.goto("/site/journal/stories/supply-notes-for-the-next-season"); await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await page.goto("/content?provider=content-indexeddb&model=catalog-news&entry=news-supply-notes");
      await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Newer private working B");
      await page.screenshot({ path: info.outputPath("catalog-private-draft-after-activation.png"), fullPage: true });
      await page.goto("/review");
      await page.getByRole("button", { name: "Review remaining working changes", exact: true }).click();
      await page.getByRole("button", { name: "Inspect current state", exact: true }).click();
      await page.getByRole("checkbox", { name: /news-supply-notes/ }).check();
      await page.getByRole("button", { name: "Run release checks", exact: true }).click();
      await page.getByRole("button", { name: "Approve reviewed candidate", exact: true }).click();
      await page.getByRole("button", { name: "Apply / stage exact candidate", exact: true }).click();
      await page.getByRole("button", { name: "Build staged candidate", exact: true }).click();
      await page.getByRole("button", { name: "Activate locally", exact: true }).click();
      await expect(page.getByText(/Activated locally\. Publication reconciliation/)).toBeVisible();
      await page.goto("/site/journal/stories/supply-notes-for-the-next-season");
      await expect(page.getByRole("heading", { name: "Newer private working B", exact: true })).toBeVisible();
      await page.reload(); await expect(page.getByRole("heading", { name: "Newer private working B", exact: true })).toBeVisible();
    });
  });
}
