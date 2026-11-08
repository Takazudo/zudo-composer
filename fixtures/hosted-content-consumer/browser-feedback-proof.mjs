/* global window, document */
// Browser acceptance for the editor's explanation surfaces: required-field
// marks, preview failure reasons, field-level conflict review and a host
// without submission. Execute only when the pinned Chromium is available.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startBrowserFixture, buildBrowserFixture } from "./browser-proof.mjs";
import { prepareRenderProof, buildRenderer } from "./render-proof.mjs";
import { fixtureAlternateAsset, fixtureEntry } from "./fixture-data.mjs";
const alternateKey = JSON.stringify([fixtureAlternateAsset.providerId, "asset", fixtureAlternateAsset.assetId]);
export async function proveEditorFeedback(filename, artifactDirectory) {
  await prepareRenderProof(filename);
  await buildRenderer();
  await buildBrowserFixture();
  const running = await startBrowserFixture(filename);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await running.close(); throw error; }
  const errors = [];
  const api = async (path, payload) => {
    const response = await fetch(`${running.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  const open = async (context, query = "") => {
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${running.url}/browser-checkpoint.html${query}`);
    await page.getByRole("textbox", { name: "講座名", exact: true }).waitFor();
    return page;
  };
  const shot = async (page, name) => { if (artifactDirectory) { await mkdir(artifactDirectory, { recursive: true }); await page.locator(".hosted-content-editor").screenshot({ path: join(artifactDirectory, `${name}.png`) }); } };
  const phase = (page, expected) => page.waitForFunction(name => window.hostedCheckpoint.handle.state.phase === name, expected);
  try {
    // 1. Submission prompt follows host availability.
    const context = await browser.newContext();
    const offered = await open(context);
    assert.equal(await offered.getByText("Preview the current saved content before submitting.", { exact: true }).count(), 1);
    assert.equal(await offered.getByRole("button", { name: "提出", exact: true }).count(), 1);
    await offered.close();
    const page = await open(context, "?submission=off");
    assert.equal(await page.getByText("Preview the current saved content before submitting.", { exact: true }).count(), 0, "No submit prompt without submission");
    assert.equal(await page.getByRole("button", { name: "提出", exact: true }).count(), 0, "No Submit without submission");
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    await page.getByText("Current saved content previewed", { exact: true }).waitFor();

    // 2. An emptied required field is marked and still saves as a draft.
    const title = page.getByRole("textbox", { name: "講座名", exact: true });
    assert.equal(await title.getAttribute("aria-invalid"), null);
    await title.fill(" ");
    await page.waitForFunction(() => document.querySelector('[data-hosted-field="title"] input')?.getAttribute("aria-invalid") === "true");
    const describedBy = await title.getAttribute("aria-describedby");
    assert.ok(describedBy, "The invalid control names its explanation");
    const problem = page.locator(`[id="${describedBy}"]`);
    assert.equal(await problem.textContent(), "This field is required.");
    assert(await problem.isVisible(), "The required message is visible");
    await page.getByRole("button", { name: "保存", exact: true }).click(); await phase(page, "saved");
    assert.equal((await api("/api/state")).providers[0].entries.find(entry => entry.id === fixtureEntry.recordId).values.title, " ");

    // 3. A failed preview names its reason, its diagnostics and the technical detail.
    // The alternate image was never decoded by this preview document, so its
    // blocked request is the preview's missing dependency.
    await context.route(`**${fixtureAlternateAsset.url}`, route => route.abort());
    await page.getByRole("combobox", { name: "image: Approved asset", exact: true }).selectOption(alternateKey);
    await page.getByRole("button", { name: "保存", exact: true }).click(); await phase(page, "saved");
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    const failure = page.locator(".hosted-content-editor__preview-failure");
    await failure.waitFor();
    assert.equal(await failure.getAttribute("role"), "alert");
    const failureTexts = await failure.locator("p, li").allTextContents();
    assert.deepEqual(failureTexts.slice(0, 4), ["The preview could not be shown.", "A file the preview needs could not be loaded.", "Required content is incomplete.", "講座名 is required."]);
    assert.match(failureTexts[4], /^Details: missing-dependency: /);
    assert.equal(await page.getByRole("alert").count(), 1, "One alert explains the failure");
    await shot(page, "preview-failure");
    const state = await page.evaluate(() => window.hostedCheckpoint.handle.state.previewFailure.diagnostics.map(diagnostic => diagnostic.fieldId));
    assert.deepEqual(state, ["title"]);
    await context.unroute(`**${fixtureAlternateAsset.url}`);
    await title.fill("ローカルの講座名");
    await page.waitForFunction(() => !document.querySelector(".hosted-content-editor__preview-failure"));
    assert.equal(await title.getAttribute("aria-invalid"), null);

    // 4. A stale save lists the differing fields; unchanged ones stay collapsed.
    const remote = await api("/api/state");
    await api("/api/execute", { kind: "set-fields", operationKey: `remote-${Date.now()}`, expected: { draftRevision: remote.draftRevision, baseline: remote.baseline, definition: remote.definition }, entry: fixtureEntry, values: { price: 7 }, clear: [] });
    await page.getByRole("button", { name: "保存", exact: true }).click(); await phase(page, "conflict");
    await page.getByRole("button", { name: "Review current content", exact: true }).click();
    const differing = page.getByRole("group", { name: "Fields that differ from the current saved content (2)", exact: true });
    await differing.waitFor();
    assert.deepEqual(await differing.locator("[data-hosted-difference]").evaluateAll(rows => rows.map(row => row.getAttribute("data-hosted-difference"))), ["title", "price"]);
    assert.equal(await differing.getByText("Your value: ローカルの講座名", { exact: true }).count(), 1);
    assert.equal(await differing.getByText("Current saved value: 7", { exact: true }).count(), 1);
    const recovery = page.locator(".hosted-content-editor__recovery");
    assert.equal(await recovery.getByText(/安心して学べます/).count(), 0, "The unchanged Markdown body is not printed");
    const unchanged = recovery.locator("details.hosted-content-editor__unchanged");
    assert.equal(await unchanged.evaluate(element => element.open), false);
    assert.match(await unchanged.locator("summary").textContent(), /^Unchanged fields \(\d+\)$/);
    assert.equal(await unchanged.getByText("notes", { exact: true }).isVisible(), false);
    await shot(page, "conflict-review");
    await unchanged.locator("summary").click();
    assert.equal(await unchanged.getByText("notes", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Reapply my changes", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click(); await phase(page, "saved");
    const saved = (await api("/api/state")).providers[0].entries.find(entry => entry.id === fixtureEntry.recordId).values;
    assert.equal(saved.title, "ローカルの講座名"); assert.equal(saved.price, 7);
    assert.deepEqual(errors, []);
    await context.close();
    const evidence = { proof: "hosted-editor-feedback-browser", browserExecution: "PASS",
      checks: ["submission prompt and Submit follow the host's submission option", "empty required field: aria-invalid, visible described message, draft saved", "failed preview: localized reason, snapshot diagnostics, technical detail, cleared by edit", "stale save review lists only differing fields; unchanged fields collapsed"] };
    if (artifactDirectory) { await mkdir(artifactDirectory, { recursive: true }); await writeFile(join(artifactDirectory, "editor-feedback-evidence.json"), JSON.stringify(evidence, null, 2)); }
    console.log(JSON.stringify(evidence)); return evidence;
  } finally { await browser?.close(); await running.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error("Supply a fresh disposable SQLite filename");
  await proveEditorFeedback(resolve(process.argv[2]), process.argv[3] ? resolve(process.argv[3]) : undefined);
}
