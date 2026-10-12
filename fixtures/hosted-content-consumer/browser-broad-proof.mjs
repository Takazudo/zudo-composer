/* global window */
// Authored browser acceptance. Execute only when the pinned Chromium is available.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startBrowserFixture, buildBrowserFixture } from "./browser-proof.mjs";
import { prepareRenderProof, buildRenderer, rendererRoot, run } from "./render-proof.mjs";
import { fixtureEntry, fixtureDetachedFaq, fixtureAlternateAsset } from "./fixture-data.mjs";
const homeKey = JSON.stringify([fixtureEntry.providerId, fixtureEntry.modelId, fixtureEntry.recordId]);
const assetKey = JSON.stringify([fixtureAlternateAsset.providerId, "asset", fixtureAlternateAsset.assetId]);
export async function proveBroadBrowser(filename, artifactDirectory) {
  await prepareRenderProof(filename);
  await buildRenderer();
  await buildBrowserFixture();
  const running = await startBrowserFixture(filename);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await running.close(); throw error; }
  const errors = [];
  const request = async (path, payload) => {
    const response = await fetch(`${running.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  const waitSaved = page => page.waitForFunction(() => !window.hostedCheckpoint.handle.state.dirty && !window.hostedCheckpoint.handle.state.pending && ["saved", "clean"].includes(window.hostedCheckpoint.handle.state.phase));
  const savedSnapshot = async page => {
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    await page.waitForFunction(() => !!window.hostedCheckpoint.handle.state.reviewedSnapshot);
    const result = await page.evaluate(() => ({ snapshot: window.hostedCheckpoint.handle.state.reviewedSnapshot, preview: window.hostedCheckpoint.preview.state }));
    assert.equal(result.preview.status, "rendered");
    assert.equal(result.preview.result.snapshotId, result.snapshot.id);
    assert.equal(result.preview.result.snapshotDigest, result.snapshot.digest);
    return result.snapshot;
  };
  try {
    const context = await browser.newContext();
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${running.url}/browser-checkpoint.html`);
    await page.getByRole("textbox", { name: "講座名", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "slug", exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: /Open in Assets|Composer|Mapping|Sitemap/ }).count(), 0);
    await page.getByRole("textbox", { name: "講座名", exact: true }).fill("UI講座A");
    await page.getByRole("spinbutton", { name: "price", exact: true }).fill("0");
    const notes = page.getByRole("textbox", { name: "notes", exact: true });
    await notes.click(); await notes.press("ControlOrMeta+A");
    await page.keyboard.insertText("## UI Markdown\n\n**日本語の強調**と[安全なリンク](https://example.com/course)");
    await page.getByRole("combobox", { name: "image: Approved asset", exact: true }).selectOption(assetKey);
    await page.getByRole("textbox", { name: "image: Alternative text", exact: true }).fill("UIで保存した代替テキスト");
    await page.getByRole("textbox", { name: "image: Caption", exact: true }).fill("承認済みの青い画像");
    await page.getByRole("button", { name: "保存", exact: true }).click(); await waitSaved(page);
    await page.getByRole("button", { name: "Create item: questions", exact: true }).click();
    await page.getByRole("textbox", { name: "question", exact: true }).fill("UIで作成した質問");
    await page.getByRole("textbox", { name: "answer", exact: true }).fill("UIで保存した回答");
    await page.getByRole("button", { name: "Create item", exact: true }).click();
    await page.waitForFunction(() => !!window.hostedCheckpoint.handle.state.lastCreatedEntry && !window.hostedCheckpoint.handle.state.pending);
    const createdEntry = await page.evaluate(() => window.hostedCheckpoint.handle.state.lastCreatedEntry);
    await page.getByRole("textbox", { name: "question", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "question", exact: true }).inputValue(), "UIで作成した質問");
    await page.getByRole("combobox", { name: "Content", exact: true }).selectOption(homeKey);
    await page.getByRole("textbox", { name: "講座名", exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Add existing item: questions", exact: true }).selectOption(fixtureDetachedFaq.recordId);
    await page.getByRole("button", { name: "Add existing item", exact: true }).click(); await waitSaved(page);
    await page.getByRole("button", { name: "Move up: UIで作成した質問", exact: true }).click(); await waitSaved(page);
    const A = await savedSnapshot(page);
    assert.equal(A.renderData.title, "UI講座A");
    assert.equal(A.renderData.price, 0);
    assert.equal(A.renderData.notes, "## UI Markdown\n\n**日本語の強調**と[安全なリンク](https://example.com/course)");
    assert.equal(A.renderData.image.url, fixtureAlternateAsset.url);
    assert.equal(A.renderData.image.checksum, fixtureAlternateAsset.checksum);
    assert.equal(A.renderData.image.alt, "UIで保存した代替テキスト");
    assert(A.renderData.questions.some(question => question.id === fixtureDetachedFaq.recordId));
    assert.equal(A.renderData.questions[1].id, createdEntry.recordId);
    assert.equal(await page.frameLocator("#preview").locator("h1").textContent(), "UI講座A");
    await page.getByRole("button", { name: "提出", exact: true }).click();
    await page.waitForFunction(() => !!window.hostedCheckpoint.handle.state.publication);
    const publicationA = await page.evaluate(() => window.hostedCheckpoint.handle.state.publication);
    assert.equal(publicationA.snapshotId, A.id);
    await page.getByRole("button", { name: "Refresh submission status", exact: true }).click();
    await page.waitForFunction(() => window.hostedCheckpoint.handle.state.publication.status === "verified");
    await page.getByRole("textbox", { name: "講座名", exact: true }).fill("UI講座B");
    assert(await page.getByRole("button", { name: "提出", exact: true }).isDisabled(), "Dirty B invalidates reviewed A");
    await page.getByRole("button", { name: "保存", exact: true }).click(); await waitSaved(page);
    await request("/api/provider/integrate", { publicationId: publicationA.id, crashBeforeReconcile: true });
    await request("/api/restart", {}); await context.close();
    const reopenedContext = await browser.newContext();
    const reopened = await reopenedContext.newPage(); reopened.on("pageerror", error => errors.push(error.message));
    await reopened.goto(`${running.url}/browser-checkpoint.html`);
    await reopened.getByRole("textbox", { name: "講座名", exact: true }).waitFor();
    assert.equal(await reopened.getByRole("textbox", { name: "講座名", exact: true }).inputValue(), "UI講座B");
    await request("/api/provider/reconcile", { publicationId: publicationA.id });
    await reopened.getByRole("button", { name: "Reload saved content", exact: true }).click();
    await reopened.waitForFunction(() => window.hostedCheckpoint.handle.state.content.integrationFence === 1);
    assert.equal(await reopened.getByRole("textbox", { name: "講座名", exact: true }).inputValue(), "UI講座B");
    const B = await savedSnapshot(reopened);
    assert.notEqual(B.id, A.id); assert.notEqual(B.digest, A.digest);
    assert.equal(B.renderData.title, "UI講座B");
    assert.deepEqual(B.renderData.questions, A.renderData.questions);
    await reopened.getByRole("button", { name: "提出", exact: true }).click();
    await reopened.waitForFunction(() => !!window.hostedCheckpoint.handle.state.publication);
    const publicationB = await reopened.evaluate(() => window.hostedCheckpoint.handle.state.publication);
    assert.equal(publicationB.snapshotId, B.id);
    await request("/api/provider/integrate", { publicationId: publicationB.id });
    const afterB = await request("/api/state"); assert.equal(afterB.integrationFence, 2); assert.equal(afterB.baseline.contentDigest, B.digest);
    await request("/api/provider/reconcile", { publicationId: publicationA.id });
    assert.deepEqual(await request("/api/state"), afterB);
    assert.deepEqual(errors, []); assert.deepEqual(running.providerWarnings, []);
    await reopenedContext.close();
    await browser.close(); browser = null;
    // Compare the actual UI-produced saved A/B snapshots through no-JS static,
    // the real SG story and a separately acknowledged iframe using the same module.
    for (const snapshot of [A, B]) {
      await writeFile(join(rendererRoot, "src/snapshot.json"), JSON.stringify(snapshot, null, 2));
      await buildRenderer();
      await run(process.execPath, ["scripts/verify-browser.mjs", running.url]);
    }
    const evidence = { proof: "actual-broad-editor-browser", browserExecution: "PASS", create: createdEntry.recordId, addExisting: fixtureDetachedFaq.recordId,
      snapshotA: A.id, digestA: A.digest, snapshotB: B.id, digestB: B.digest, independentBrowserContexts: 2,
      checks: ["real Markdown source/numeric/asset controls", "real create/add/reorder", "exact saved preview and Submit", "durable B during A with backend restart", "two baseline integrations", "UI snapshots A/B no-JS ZFB/SG/iframe parity"] };
    if (artifactDirectory) { await mkdir(artifactDirectory, { recursive: true }); await writeFile(join(artifactDirectory, "broad-browser-evidence.json"), JSON.stringify(evidence, null, 2)); }
    console.log(JSON.stringify(evidence)); return evidence;
  } finally { await browser?.close(); await running.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error("Supply a fresh disposable SQLite filename");
  await proveBroadBrowser(resolve(process.argv[2]), process.argv[3] ? resolve(process.argv[3]) : undefined);
}
