// @ts-check
/* global sessionStorage, MouseEvent */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

export const browserText = "ブラウザーからの正確な挿入。\n改行と  空白を保持。";
const columns = ["列", "値"], rows = [["ブラウザーの行", "供給値"]];

/** Public installed UI, with canonical file checks in the disposable host only.
 * @param {import('@playwright/test').Page} page
 * @param {string} host
 * @param {(args: string[], input: unknown) => Promise<any>} cli
 * @param {{workspaceId: string, assetId: string}} initialized
 */
export async function proveBrowserEdits(page, host, cli, initialized) {
  const inspect = () => cli(["edit", "inspect", "--stdin"], { workspaceId: initialized.workspaceId, page: "/" });
  const canonical = async () => Promise.all(["composition-home.composition.json", "composition-home.tsx"].map(name => readFile(join(host, "cms", "compositions", `workspace-v1-${initialized.workspaceId}`, name), "utf8")));
  /** @type {Record<string, string> | undefined} */
  let operatorHeaders;
  /** @type {{url: string, headers: Record<string, string>, body: string} | undefined} */
  let delayedProvider;
  page.on("request", request => {
    if (request.url().endsWith("/__zudo-native-edit")) operatorHeaders = request.headers();
    if (request.url().endsWith("/__zudo_composer_file_provider") && request.headers()["x-zudo-native-client"]) delayedProvider = { url: request.url(), headers: request.headers(), body: request.postData() ?? "" };
  });
  await page.goto("http://127.0.0.1:4175/composer?native=1&sitemap=main&page=home");
  const frame = page.frameLocator('iframe[title="Native page preview"]');
  await expect(frame.getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByText("Installed template frame", { exact: true })).toBeVisible();
  const second = await page.context().newPage();
  await second.goto("http://127.0.0.1:4175/composer?provider=files&composition=home");
  await expect(second.frameLocator('iframe[title="Composer preview canvas"]').getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 60_000 });
  // The same public structural save path must retain its dirty input on failure.
  const unchanged = await canonical();
  let blockedSaves = 0;
  await second.route("**/__zudo_composer_file_provider", route => {
    const operation = route.request().postDataJSON()?.operation;
    if (operation === "put" || operation === "save-lifecycle-record") { blockedSaves++; return route.abort(); }
    return route.continue();
  });
  await second.frameLocator('iframe[title="Composer preview canvas"]').locator('[data-zc-node-id="paragraph"]').click();
  const structuralText = second.getByRole("textbox", { name: "Text", exact: true });
  await structuralText.fill("Unseen unsaved Japanese 日本語");
  await structuralText.blur();
  await expect.poll(() => blockedSaves).toBeGreaterThan(0);
  await frame.locator('[data-zc-node-id="list"]').click();
  await page.getByLabel("Exact text", { exact: true }).fill("Retained exact request");
  await page.getByRole("button", { name: "Review insertion", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save all authoring tabs");
  await expect(structuralText).toHaveValue("Unseen unsaved Japanese 日本語");
  await expect(page.getByLabel("Exact text", { exact: true })).toHaveValue("Retained exact request");
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toHaveCount(0);
  assert.deepEqual(await canonical(), unchanged, "Failed structural flush cannot be bypassed by the operator tab");
  await second.unroute("**/__zudo_composer_file_provider");
  await structuralText.fill("Before replacement");
  await structuralText.blur();
  await expect(second.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect current page", exact: true }).click();
  await expect(frame.getByText("Before replacement", { exact: true })).toBeVisible();
  for (const insertion of [
    { kind: "image", node: "paragraph", label: "Managed image" },
    { kind: "text", node: "list", label: "Exact text" },
    { kind: "table", node: "table", label: "Supplied table" },
  ]) {
    const before = await inspect(), files = await canonical();
    await frame.locator(`[data-zc-node-id="${insertion.node}"]`).click();
    await page.getByLabel("Insertion", { exact: true }).selectOption(insertion.kind);
    if (insertion.kind === "image") {
      await page.getByLabel("Existing managed image", { exact: true }).selectOption(initialized.assetId);
      await page.getByLabel("Alternative text (empty is intentional)", { exact: true }).fill("Browser managed image");
    } else await page.getByLabel(insertion.kind === "text" ? "Exact text" : "Table JSON: columns and rows", { exact: true }).fill(insertion.kind === "text" ? browserText : JSON.stringify({ columns, rows }));
    // Composition Enter remains native input, never an implicit submit.
    if (insertion.kind === "text") {
      await page.getByLabel("Exact text", { exact: true }).dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
      await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Review insertion", exact: true }).click();
    const apply = page.getByRole("button", { name: "Apply to draft", exact: true });
    await expect(apply).toBeEnabled({ timeout: 30_000 });
    assert.deepEqual(await canonical(), files, `${insertion.kind}: planning/preview changed JSON or JSX`);
    if (insertion.kind === "image") {
      assert.ok(operatorHeaders, "Real operator request must carry session capability");
      const pending = await page.evaluate(() => Object.values(sessionStorage).map(value => { try { return JSON.parse(value); } catch { return null; } }).find(value => value?.planId));
      const rejected = await page.request.post("http://127.0.0.1:4175/__zudo-native-edit", { headers: { "content-type": "application/json", origin: "http://127.0.0.1:4175", "x-zudo-native-client": operatorHeaders["x-zudo-native-client"], "x-zudo-native-capability": operatorHeaders["x-zudo-native-capability"] }, data: { operation: "apply", input: { planId: pending.planId, approve: "0".repeat(64) } } });
      assert.equal(rejected.status(), 403, "Proposal capability cannot approve a write");
      const unauthenticated = await page.request.post("http://127.0.0.1:4175/__zudo-native-edit", { data: { operation: "inspect", input: {} } });
      assert.equal(unauthenticated.status(), 403);
      assert.deepEqual(await canonical(), files, "Rejected operator requests cannot write");
    }
    if (insertion.kind === "image") {
      await page.getByLabel("Page", { exact: true }).selectOption("main/other");
      await expect(frame.getByText("Other page copy", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toHaveCount(0);
      await frame.locator('[data-zc-node-id="note"]').click();
      await expect(page.getByRole("alert")).toContainText("No supported native editing declaration");
      await page.getByLabel("Page", { exact: true }).selectOption("main/home");
      await expect(apply).toBeEnabled({ timeout: 30_000 });
      assert.deepEqual(await canonical(), files, "Navigating to colliding node ids must preserve the home plan");
    }
    await page.getByRole("button", { name: "Original", exact: true }).click();
    await expect(apply).toBeDisabled();
    assert.deepEqual(await canonical(), files);
    await page.getByRole("button", { name: "Proposed", exact: true }).click();
    await expect(apply).toBeEnabled();
    if (insertion.kind === "text") await expect(frame.getByText(browserText, { exact: true })).toBeVisible();
    if (insertion.kind === "image") await expect(frame.getByRole("img", { name: "Browser managed image", exact: true })).toBeVisible();
    if (insertion.kind === "table") await expect(frame.getByRole("cell", { name: "供給値", exact: true })).toBeVisible();
    let applyRequests = 0;
    if (insertion.kind === "image") await page.route("**/__zudo-native-edit", async route => {
      if (route.request().postDataJSON()?.operation !== "apply") return route.continue();
      applyRequests++;
      await route.fetch(); // Commit is real; only its browser acknowledgement is lost.
      await route.abort().catch(() => {});
    });
    if (insertion.kind === "image") await apply.evaluate(element => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    else await apply.click();
    // Native mutations invalidate old browser write epochs and reopen records.
    await expect(page.getByRole("region", { name: "Durable receipt", exact: true })).toBeVisible({ timeout: 60_000 });
    const after = await inspect();
    if (insertion.kind === "image") {
      assert.equal(applyRequests, 1, "Duplicate action delivery must send one application");
      await page.unroute("**/__zudo-native-edit");
      await expect(second.frameLocator('iframe[title="Composer preview canvas"]').getByRole("img", { name: "Browser managed image", exact: true })).toBeVisible({ timeout: 60_000 });
      assert.ok(delayedProvider, "Real provider request must carry its bound epoch");
      const staleHeaders = Object.fromEntries(Object.entries(delayedProvider.headers).filter(([key]) => key.startsWith("x-zudo-") || key === "content-type"));
      const stale = await page.request.post(delayedProvider.url, { headers: { ...staleHeaders, origin: "http://127.0.0.1:4175", "sec-fetch-site": "same-origin", "x-zudo-native-epoch": "0" }, data: { operation: "save-lifecycle-record", record: before.record, outputsById: { [before.record.id]: { status: "generated", code: files[1] } } } });
      assert.equal(stale.status(), 409, "Delayed old-epoch provider request must be rejected");
      assert.deepEqual((await inspect()).record, after.record);
    }
    const oldIds = before.record.document.root.map(node => node.id);
    const added = after.record.document.root.filter(node => !oldIds.includes(node.id));
    assert.equal(added.length, 1);
    assert.deepEqual(after.record.document.root.filter(node => oldIds.includes(node.id)), before.record.document.root);
    if (insertion.kind === "text") assert.equal(added[0].props.text, browserText);
    if (insertion.kind === "image") assert.equal(added[0].props.alt, "Browser managed image");
    if (insertion.kind === "table") { assert.deepEqual(added[0].props.columns, columns); assert.deepEqual(added[0].props.rows, rows); }
    await page.reload();
    await expect(page.getByRole("region", { name: "Durable receipt", exact: true })).toBeVisible({ timeout: 60_000 });
    if (insertion.kind === "table") {
      await page.getByRole("button", { name: "Guarded Undo", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Undo committed", exact: true })).toBeVisible({ timeout: 60_000 });
      assert.deepEqual((await inspect()).record, before.record);
    }
    await page.getByRole("button", { name: "New insertion", exact: true }).click();
  }
  // Discard is detached preview disposal and must preserve both canonical files.
  const files = await canonical();
  await frame.locator('[data-zc-node-id="list"]').click();
  await page.getByLabel("Insertion", { exact: true }).selectOption("table");
  await page.getByLabel("Table JSON: columns and rows", { exact: true }).fill(JSON.stringify({ columns: ["A", "B"], rows: [["Only one cell"]] }));
  await page.getByRole("button", { name: "Review insertion", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toHaveCount(0);
  assert.deepEqual(await canonical(), files, "Malformed exact table cannot write");
  await page.getByLabel("Insertion", { exact: true }).selectOption("text");
  await page.getByLabel("Exact text", { exact: true }).fill("Discarded exact input");
  await page.getByRole("button", { name: "Review insertion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review insertion", exact: true })).toBeVisible();
  assert.deepEqual(await canonical(), files);
  // A boot-ready/reloaded frame with broken real asset bytes is no render proof.
  await page.getByLabel("Insertion", { exact: true }).selectOption("image");
  await page.getByLabel("Existing managed image", { exact: true }).selectOption(initialized.assetId);
  await page.getByLabel("Intentionally empty alternative text", { exact: true }).check();
  await page.getByRole("button", { name: "Review insertion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toBeEnabled();
  await page.route("**/uploaded-assets/**", route => route.abort());
  await page.locator('iframe[title="Native page preview"]').evaluate(element => { const frame = /** @type {HTMLIFrameElement} */ (element); frame.contentWindow?.location.reload(); });
  await expect(page.getByRole("alert")).toContainText("image dependency", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toBeDisabled();
  assert.deepEqual(await canonical(), files, "Missing dependencies cannot approve a candidate");
  await page.unroute("**/uploaded-assets/**");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator('iframe[title="Native page preview"]').evaluate(element => { const frame = /** @type {HTMLIFrameElement} */ (element); frame.contentWindow?.location.reload(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Page", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Exact native insertion", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Page", exact: true }).click();
  await expect(page.locator('iframe[title="Native page preview"]')).toBeVisible();
  await second.close();
  console.log("Installed page-first UI: exact insertions, approval isolation, dirty structural save retention, two tabs, delayed stale writes, duplicate Apply/lost acknowledgement recovery, unchanged JSON/JSX before Apply, guarded undo, discard, malformed table, missing assets, synthetic IME and narrow tabs passed.");
}
