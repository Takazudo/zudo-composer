// @ts-check
/* global CSS, document, window, location, innerWidth, innerHeight, getComputedStyle, HTMLElement, MutationObserver, sessionStorage, requestAnimationFrame */
// Real-browser AI Assistant proof. Owns browser port 4177 and a loopback
// scripted Messages API; run serially with the other browser lanes.
// Evidence class: real dev server, real pack renderers, real Assistant adapter
// and SDK, scripted (fake) model replies. This is NOT live-inference evidence.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHostServer } from "./packed-host-helpers.mjs";
import { prepareAssistantHost } from "./assistant/prepare-host.mjs";
import { startFakeMessagesApi } from "./fixtures/assistant/fake-messages-api.mjs";
import { count, frame, highlighted, idle, lastReply, send } from "./assistant/browser-helpers.mjs";

const root = resolve(import.meta.dirname, "..");
const port = 4177, origin = `http://127.0.0.1:${port}`;
const evidence = resolve(process.env.ASSISTANT_EVIDENCE_DIR ?? join(root, "test-results/assistant-browser"));
const temporary = await mkdtemp(join(tmpdir(), "assistant-browser-"));
const api = await startFakeMessagesApi();
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
/** @type {Awaited<ReturnType<typeof startHostServer>> | undefined} */
let server;
const log = (/** @type {string} */ line) => console.log(`assistant-browser: ${line}`);

/** @param {string} host @param {{ credential?: boolean }} [options] */
async function start(host, options = {}) {
  const env = { ...process.env };
  delete env.ZUDO_ASSISTANT_TEST_KEY;
  if (options.credential !== false) env.ZUDO_ASSISTANT_TEST_KEY = "test-key";
  server = await startHostServer(host, { port, env, command: process.execPath, args: [join(root, "bin/zudo-composer.mjs"), "dev", "--host", "127.0.0.1", "--port", String(port), "--strict-port"] });
}
async function stop() { await server?.stop(); server = undefined; }
/** @param {import('@playwright/test').Page} page @param {string} name */
const shot = (page, name) => page.screenshot({ path: join(evidence, `${name}.png`) });
const lastRequest = () => api.requests().at(-1);

async function landingJourneys() {
  const host = await prepareAssistantHost({ kind: "landing", dir: join(temporary, "orrery"), baseUrl: api.url, name: "Orrery Bot" });
  const homeRef = { sitemapId: "demo-landing-sitemap", pageId: "home-node" };
  const json = join(host.dir, "cms/compositions/workspace-v1-landing-assistant/composition-home.composition.json");
  const tsx = json.replace(".composition.json", ".tsx");
  const canonical = async () => [await readFile(json, "utf8"), await readFile(tsx, "utf8")].join("\n");
  await start(host.dir);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", error => errors.push(error.message));
  if (process.env.ASSISTANT_DEBUG) page.on("console", message => { if (message.text().startsWith("assistant-")) console.log("CONSOLE", message.text().slice(0, 400)); });
  if (process.env.ASSISTANT_DEBUG) page.on("response", async response => { if (response.url().endsWith("/__zudo-assistant")) { const body = response.request().postData() ?? ""; if (!body.includes('"events"')) console.log("DEBUG", body.slice(0, 200), "=>", (await response.text().catch(() => "")).slice(0, 200)); } });
  await page.goto(`${origin}/composer?assistant=1&sitemap=${homeRef.sitemapId}&page=${homeRef.pageId}`);
  await expect(frame(page, "Current").getByText("Every moving part of your week")).toBeVisible({ timeout: 90_000 });
  const before = await canonical();

  // Journey 1: save and review site policy in Memory (Read only by default).
  await page.getByRole("button", { name: /^Memory/ }).click();
  const memory = page.getByRole("dialog", { name: /Site Memory/ });
  await expect(memory.getByRole("radio", { name: /Read only/ })).toBeChecked();
  await memory.getByRole("textbox").fill("Audience: experts who schedule large teams.");
  await memory.getByRole("button", { name: "Save Memory" }).click();
  await expect(memory.getByText("Memory saved.")).toBeVisible();
  await memory.getByRole("button", { name: "Close" }).click();
  api.script([{ tools: [{ name: "remember", input: { change: { kind: "append", text: "Tone: warm and plain." } } }] }, { text: "I proposed adding the tone to Memory; it needs your approval." }]);
  await send(page, "Remember that our tone is warm and plain.");
  await expect(lastReply(page).getByText("Memory update proposal")).toBeVisible();
  assert.match(lastRequest()?.system ?? "", /Audience: experts/);
  await lastReply(page).getByRole("button", { name: "Save to Memory" }).click();
  await expect(lastReply(page).getByText("Saved as r2")).toBeVisible();
  log("journey 1: Memory saved, Read only proposal approved as r2");

  // Journey 2: a different conversation uses the saved policy on its actual model call.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Conversation" })).toHaveText(/New conversation/);
  await expect(page.locator(".cms-assistant-message")).toHaveCount(0);
  api.script([{ text: "Your site writes for experts, in a warm and plain tone." }]);
  await send(page, "Who do we write for?");
  await expect(lastReply(page).getByText("Used Memory r2")).toBeVisible();
  assert.match(lastRequest()?.system ?? "", /Tone: warm and plain\./);
  log("journey 2: second conversation used Memory r2");

  // Journey 5 (correction first, then reused below): the next call uses the corrected Memory.
  await page.getByRole("button", { name: /^Memory/ }).click();
  const box = memory.getByRole("textbox");
  await expect(box).toHaveValue(/Audience: experts/);
  await box.fill((await box.inputValue()).replace("experts who schedule large teams", "beginners planning their first team calendar"));
  await memory.getByRole("button", { name: "Save Memory" }).click();
  await expect(memory.getByText("Memory saved.")).toBeVisible();
  await memory.getByRole("button", { name: "Close" }).click();
  api.script([{ text: "Understood: beginners." }]);
  await send(page, "And now?");
  await expect(lastReply(page).getByText("Used Memory r3")).toBeVisible();
  assert.match(lastRequest()?.system ?? "", /beginners planning/);
  assert.doesNotMatch(lastRequest()?.system ?? "", /experts/);
  // The earlier answer still links to the revision it actually used.
  await expect(page.locator('.cms-assistant-message[data-role="assistant"]').filter({ hasText: "Your site writes for experts" }).getByText("Used Memory r2")).toBeVisible();
  log("journey 5: corrected Memory r3 used on the next call; old answer keeps r2");

  await stop();
  await start(host.dir);
  await page.reload();
  await expect(page.locator('.cms-assistant-message[data-role="assistant"]').filter({ hasText: "Your site writes for experts" }).getByText("Used Memory r2")).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator(".cms-assistant-message")).toHaveCount(0);
  api.script([{ text: "The corrected audience is beginners." }]);
  await send(page, "Who is the audience after restart?");
  await expect(lastReply(page).getByText("Used Memory r3")).toBeVisible();
  assert.match(lastRequest()?.system ?? "", /beginners planning/);
  assert.doesNotMatch(lastRequest()?.system ?? "", /experts/);
  log("corrected Memory r3 survives host restart and is used in a new conversation");

  // Journey 3/4 on a real theme: exact field update + registered component insertion, then review.
  api.script([
    { tools: [{ name: "inspect_page", input: {} }] },
    { tools: [{ name: "propose_changes", input: { operations: [
      { kind: "updateField", page: homeRef, nodeId: "home-land-step-11", prop: "title", value: "Connect your calendar in one click", reason: "simpler first step" },
      { kind: "insertComponent", page: homeRef, componentId: "land.feature-item", at: { after: "home-land-feature-item-7" }, props: { title: "Shared agendas", body: "Every meeting gets a short agenda everyone can edit.", icon: "people" }, reason: "add a fourth feature" },
    ] } }] },
    { text: "Two changes are ready for your review." },
  ]);
  await send(page, "Simplify the first how-it-works step for beginners and add a fourth feature about shared agendas.");
  await expect(count(page)).toHaveText("2");
  assert.equal(await canonical(), before, "proposals must not write canonical JSON/JSX");
  await page.getByRole("button", { name: /^Draft/ }).click();
  const draft = frame(page, "Draft");
  await expect(draft.getByText("Shared agendas")).toBeVisible();
  await expect.poll(() => highlighted(draft)).toEqual(expect.arrayContaining(["Shared agendas", "calendar in one click"]));
  await expect(draft.locator(".zc-review-badge")).toHaveText(["Added 1/2", "Changed 2/2"]);
  await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
  await page.getByRole("button", { name: "Next change" }).click();
  await shot(page, "orrery-draft-desktop");
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await expect(frame(page, "Current").locator(".zc-review-badge")).toHaveText(["Will change 1/1"]);
  await expect.poll(() => frame(page, "Current").locator("body").evaluate(() => /** @type {any} */ (CSS).highlights?.get("zc-review-delete")?.size ?? 0)).toBeGreaterThan(0);
  await shot(page, "orrery-current-desktop");
  log("journey 3/4: real-theme candidate rendered with yellow words, outlined labelled blocks and Current deletion marks");

  // Revision request: returning the field to its base value removes that semantic change.
  api.script([{ tools: [{ name: "inspect_page", input: {} }] }, { tools: [{ name: "propose_changes", input: { operations: [{ kind: "updateField", page: homeRef, nodeId: "home-land-step-11", prop: "title", value: "Connect your calendars", reason: "keep the original step title" }] } }] }, { text: "Restored the original step title." }]);
  await send(page, "Actually keep the original step title.");
  await expect(count(page)).toHaveText("1");
  // Mapping-owned collection slot: refused by the service, nothing added.
  api.script([{ tools: [{ name: "inspect_page", input: {} }] }, { tools: [{ name: "propose_changes", input: { operations: [{ kind: "insertComponent", page: homeRef, componentId: "land.pricing-tier", at: { parentId: "home-pricing", slotId: "tiers" }, props: { name: "Enterprise" } }] } }] }, { text: "Pricing tiers come from Content through Mapping, so I can't add one here." }]);
  await send(page, "Add an Enterprise pricing tier.");
  await expect(count(page)).toHaveText("1");
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("No pending AI changes")).toBeVisible();
  assert.equal(await canonical(), before);
  log("revision, Mapping-owned refusal and withdrawal kept canonical bytes unchanged");

  // Narrow layout uses whole Conversation/Page views.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Conversation" })).toBeVisible();
  await shot(page, "orrery-narrow-conversation");
  await page.getByRole("tab", { name: /^Page/ }).click();
  await expect(page.locator(".cms-assistant-left")).toBeHidden();
  await shot(page, "orrery-narrow-page");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "Conversation" }).click().catch(() => {});

  // Synthetic IME check (not physical-device evidence): Enter that confirms a composition must not send.
  const userMessages = page.locator('.cms-assistant-message[data-role="user"]');
  const sent = await userMessages.count();
  await page.locator("#assistant-input").fill("にほんご");
  await page.locator("#assistant-input").dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
  await page.waitForTimeout(500);
  await expect(userMessages).toHaveCount(sent);
  await expect(page.locator("#assistant-input")).toHaveValue("にほんご");
  await page.locator("#assistant-input").fill("");
  log("synthetic composition Enter did not send (physical IME not covered)");

  // Stop, quota failure with Retry, malformed tool input.
  api.script([{ holdUntilAbort: true }]);
  await page.locator("#assistant-input").fill("Write a long essay.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
  await idle(page);
  await expect(lastReply(page).getByText("Stopped")).toBeVisible();
  api.script([{ status: 429 }, { status: 429 }, { status: 429 }]);
  await send(page, "Try something.");
  await expect(lastReply(page).getByText("Failed")).toBeVisible();
  api.script([{ text: "Recovered after retry." }]);
  await lastReply(page).getByRole("button", { name: "Retry this turn" }).click();
  await idle(page);
  await expect(lastReply(page)).toContainText("Recovered after retry.");
  api.script([{ tools: [{ name: "inspect_page", input: {} }] }, { tools: [{ name: "propose_changes", input: { operations: "not a list" } }] }, { text: "That request was malformed; nothing changed." }]);
  await send(page, "Break the tool.");
  await expect(page.getByText("No pending AI changes")).toBeVisible();
  log("Stop, 429 failure + Retry and malformed tool input recovered honestly");
  assert.deepEqual(errors, []);
  await page.close();
  await stop();

  // Missing credential: honest configuration state; ordinary Composer keeps working.
  await start(host.dir, { credential: false });
  const unconfigured = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await unconfigured.goto(`${origin}/composer?assistant=1&sitemap=${homeRef.sitemapId}&page=${homeRef.pageId}`);
  await expect(unconfigured.getByText("AI replies are unavailable.")).toBeVisible({ timeout: 90_000 });
  await expect(unconfigured.getByText("ZUDO_ASSISTANT_TEST_KEY is not set")).toBeVisible();
  await expect(unconfigured.getByRole("button", { name: "Send" })).toBeDisabled();
  await unconfigured.goto(`${origin}/composer?provider=files&composition=home`);
  await expect(unconfigured.frameLocator('iframe[title="Composer preview canvas"]').getByText("Every moving part of your week")).toBeVisible({ timeout: 90_000 });
  log("missing credential shows configuration state; Composer still opens the page");
  await unconfigured.close();
  await stop();
}

/**
 * Editor-owned review chrome must sit on its target block: the outline 4px
 * outside the block, the label on the outline's outer edge, every yellow word
 * inside an outlined block, and none of it intercepting pointer hits.
 * Returns the mismatches (empty when aligned, within ±2px).
 * @param {import('@playwright/test').FrameLocator} preview
 */
const reviewGeometry = preview => preview.locator("body").evaluate(() => {
  const problems = /** @type {string[]} */ ([]);
  const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= 2;
  const json = (/** @type {DOMRect} */ rect) => `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
  const boxes = [...document.querySelectorAll(".zc-review-box[data-annotation]")].map(element => /** @type {HTMLElement} */ (element));
  if (!boxes.length) problems.push("no review outlines");
  const targets = [...document.querySelectorAll('[data-zc-owner="local"][data-zc-node-id]')].map(element => /** @type {HTMLElement} */ (element));
  const owners = /** @type {HTMLElement[]} */ ([]);
  for (const box of boxes) {
    const id = box.dataset.annotation ?? "";
    const target = targets.find(element => id.endsWith(`:${element.dataset.zcNodeId}`));
    if (!target) { problems.push(`${id}: target block not found`); continue; }
    owners.push(target);
    const t = target.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (!(near(b.left, t.left - 4) && near(b.top, t.top - 4) && near(b.width, Math.max(t.width, 24) + 8) && near(b.height, Math.max(t.height, 16) + 8))) problems.push(`${id}: outline ${json(b)} vs block ${json(t)}`);
    const badge = /** @type {HTMLElement | null} */ (box.querySelector(".zc-review-badge"));
    if (!badge?.textContent?.match(/^(Changed|Added|Will change|Removed) \d+\/\d+$/)) { problems.push(`${id}: missing label`); continue; }
    const l = badge.getBoundingClientRect();
    if (!near(l.left, b.left) || !(badge.dataset.placement === "below" ? near(l.top, b.bottom) : near(l.bottom, b.top))) problems.push(`${id}: label ${json(l)} vs outline ${json(b)}`);
    const x = l.left + l.width / 2, y = l.top + l.height / 2;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && document.elementFromPoint(x, y)?.closest("[data-zc-review-layer]")) problems.push(`${id}: label intercepts pointer hits`);
  }
  const ranges = /** @type {Range[]} */ ([.../** @type {any} */ (CSS).highlights?.get("zc-review-insert") ?? []]);
  if (!ranges.length) problems.push("no yellow words");
  for (const range of ranges) {
    const owner = owners.find(element => element.contains(range.commonAncestorContainer));
    if (!owner) { problems.push(`"${range}" is outside every outlined block`); continue; }
    const o = owner.getBoundingClientRect();
    for (const rect of range.getClientRects()) if (rect.width && (rect.left < o.left - 2 || rect.right > o.right + 2 || rect.top < o.top - 2 || rect.bottom > o.bottom + 2)) problems.push(`"${range}" ${json(rect)} leaves its block ${json(o)}`);
  }
  return problems;
});
/** @param {import('@playwright/test').FrameLocator} preview @param {string} when */
async function expectAligned(preview, when) {
  await expect.poll(() => reviewGeometry(preview), { message: `review annotations aligned ${when}`, timeout: 10_000 }).toEqual([]);
}
/** Scrolls the preview so the first outline is mid-view, then a bit further. @param {import('@playwright/test').FrameLocator} preview */
async function scrollPreview(preview) {
  await preview.locator("body").evaluate(() => {
    const box = document.querySelector(".zc-review-box");
    if (box) window.scrollTo(0, Math.max(0, box.getBoundingClientRect().top + window.scrollY - 120));
    window.scrollBy(0, 90);
  });
}
/**
 * Presses Tab until the locator has focus, then requires a visible focus ring.
 * @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} target @param {string} name
 */
async function tabTo(page, target, name) {
  for (let presses = 1; presses <= 400; presses++) {
    await page.keyboard.press("Tab");
    if (!await target.evaluate(element => element === document.activeElement).catch(() => false)) continue;
    const ring = await target.evaluate(element => { const style = getComputedStyle(element); return { focusVisible: element.matches(":focus-visible"), style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor }; });
    assert.ok(ring.focusVisible && ring.style !== "none" && ring.width >= 2 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(ring.color), `${name} needs a visible focus ring (${JSON.stringify(ring)})`);
    return presses;
  }
  throw new Error(`Tab never reached ${name}`);
}
/**
 * In a narrow Page view the preview must keep a usable height: at least half
 * the viewport tall, and at least half the viewport visible below the sticky
 * tabs once scrolled to.
 * @param {import('@playwright/test').Page} page @param {string} where
 */
async function expectPreviewRoom(page, where) {
  const room = await page.evaluate(() => {
    const iframe = /** @type {HTMLElement} */ (document.querySelector('iframe[title$="page preview"]'));
    const tabs = /** @type {HTMLElement} */ (document.querySelector(".cms-assistant-tabs"));
    iframe.scrollIntoView({ block: "end" });
    const rect = iframe.getBoundingClientRect();
    const review = /** @type {HTMLElement} */ (document.querySelector(".cms-assistant-review")).getBoundingClientRect();
    return { height: rect.height, visible: Math.min(rect.bottom, innerHeight) - Math.max(rect.top, tabs.getBoundingClientRect().bottom), viewport: innerHeight, overlap: Math.max(0, Math.min(rect.bottom, review.bottom) - Math.max(rect.top, review.top)) };
  });
  assert.ok(room.height >= room.viewport / 2 && room.visible >= room.viewport / 2, `the preview keeps at least half the viewport ${where} (${JSON.stringify(room)})`);
  assert.ok(room.overlap <= 1, `the review list never covers the preview ${where} (${JSON.stringify(room)})`);
}
/**
 * The Bot heading stays in the accessibility tree and Rename stays on screen
 * and usable, even when a short viewport folds the title row away.
 * @param {import('@playwright/test').Page} page @param {string} where
 */
async function expectRenameReachable(page, where) {
  await expect(page.getByRole("heading", { level: 1, name: /Orrery Bot/ }), `Bot heading ${where}`).toHaveCount(1);
  const rename = page.getByRole("button", { name: "Rename Orrery Bot" });
  await expect(rename).toBeVisible();
  assert.ok(await inViewport(page, rename), `Rename is on screen ${where}`);
  await rename.tap();
  await expect(page.getByRole("textbox", { name: "Assistant name" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(rename).toBeVisible();
}
/** True when the whole element lies inside the current viewport. @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} target */
async function inViewport(page, target) {
  const box = await target.boundingBox(), size = page.viewportSize();
  return !!box && !!size && box.y >= 0 && box.x >= 0 && box.y + box.height <= size.height && box.x + box.width <= size.width;
}

/**
 * Browser-level device checks that replace the former hand-run checklist:
 * Chromium IME composition through CDP, touch at Galaxy Fold sizes with a
 * virtual-keyboard height, highlight geometry through scroll/resize/rotation,
 * and a keyboard-only review → Apply → Undo path.
 */
async function deviceJourneys() {
  const host = await prepareAssistantHost({ kind: "landing", dir: join(temporary, "devices"), baseUrl: api.url, name: "Orrery Bot" });
  const homeRef = { sitemapId: "demo-landing-sitemap", pageId: "home-node" };
  const json = join(host.dir, "cms/compositions/workspace-v1-landing-assistant/composition-home.composition.json");
  const tsx = json.replace(".composition.json", ".tsx");
  const canonical = async () => [await readFile(json, "utf8"), await readFile(tsx, "utf8")].map(text => text.replace(/"updatedAt": "[^"]+"/g, ""));
  const url = `${origin}/composer?assistant=1&sitemap=${homeRef.sitemapId}&page=${homeRef.pageId}`;
  const propose = () => api.script([
    { tools: [{ name: "inspect_page", input: {} }] },
    { tools: [{ name: "propose_changes", input: { operations: [
      { kind: "updateField", page: homeRef, nodeId: "home-land-step-11", prop: "title", value: "Connect your calendar in one click", reason: "simpler first step" },
      { kind: "insertComponent", page: homeRef, componentId: "land.feature-item", at: { after: "home-land-feature-item-7" }, props: { title: "Shared agendas", body: "Every meeting gets a short agenda everyone can edit.", icon: "people" }, reason: "add a fourth feature" },
    ] } }] },
    { text: "Two changes are ready for your review." },
  ]);
  await start(host.dir);
  const before = await canonical();

  // ── Desktop, keyboard and Chromium IME ──
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await expect(frame(page, "Current").getByText("Every moving part of your week")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeEnabled();
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => { /** @type {any} */ (window).__zcKeys = []; document.addEventListener("keydown", event => /** @type {any} */ (window).__zcKeys.push({ key: event.key, isComposing: event.isComposing, keyCode: event.keyCode }), true); });
    const recorded = () => page.evaluate(() => /** @type {any} */ (window).__zcKeys.splice(0));
    const enter = (/** @type {number} */ keyCode) => cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    const enterUp = () => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    /** Chromium (Blink) order: the confirming Enter arrives while the composition is still active. */
    const composeChromium = async (/** @type {string} */ reading, /** @type {string} */ confirmed) => {
      await cdp.send("Input.imeSetComposition", { text: reading, selectionStart: reading.length, selectionEnd: reading.length });
      await enter(13);
      await cdp.send("Input.insertText", { text: confirmed });
      await enterUp();
    };
    /** WebKit order: the composition commits first, then Enter arrives with keyCode 229. */
    const composeWebKit = async (/** @type {string} */ reading, /** @type {string} */ confirmed) => {
      await cdp.send("Input.imeSetComposition", { text: reading, selectionStart: reading.length, selectionEnd: reading.length });
      await cdp.send("Input.insertText", { text: confirmed });
      await enter(229);
      await enterUp();
    };

    const input = page.locator("#assistant-input");
    const userMessages = page.locator('.cms-assistant-message[data-role="user"]');
    const sent = await userMessages.count();
    const requests = api.requests().length;
    await input.focus();
    await composeChromium("にほんご", "日本語");
    assert.deepEqual(await recorded(), [{ key: "Enter", isComposing: true, keyCode: 13 }], "the confirming Enter reached the page as a composition key event");
    await composeWebKit("です", "です");
    assert.deepEqual(await recorded(), [{ key: "Enter", isComposing: false, keyCode: 229 }], "the post-commit Enter reached the page with keyCode 229");
    // A send starts from the key handler; two frames later none has started. The exact
    // counts after the real send below also catch any late send from these Enters.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
    await expect(userMessages).toHaveCount(sent);
    await expect(input).toHaveValue("日本語です");
    assert.equal(api.requests().length, requests, "a conversion Enter must not reach the model");
    api.script([{ text: "受け取りました。" }]);
    await page.keyboard.press("Enter");
    await expect(userMessages).toHaveCount(sent + 1);
    await expect(userMessages.last().locator(".cms-assistant-message__text")).toHaveText("日本語です");
    await idle(page);
    assert.equal(api.requests().length, requests + 1);
    assert.match(JSON.stringify(lastRequest()?.messages.at(-1)), /日本語です/);
    assert.doesNotMatch(JSON.stringify(lastRequest()?.messages.at(-1)), /にほんご/);
    log("Chromium IME (CDP composition): confirming Enter in either order did not send; the next Enter sent exactly the confirmed text");

    // Memory editor: composition text is committed exactly; unsaved text asks before it is discarded.
    await page.getByRole("button", { name: /^Memory/ }).click();
    const memory = page.getByRole("dialog", { name: /Site Memory/ });
    const box = memory.getByRole("textbox");
    await expect(box).toBeEnabled();
    await box.focus();
    await box.press("End");
    await recorded();
    await composeChromium("かいぎはげつようび", "会議は月曜日");
    assert.deepEqual(await recorded(), [{ key: "Enter", isComposing: true, keyCode: 13 }]);
    await expect(memory).toBeVisible();
    await expect(box).toHaveValue(/会議は月曜日$/);
    await expect(memory.getByText("unsaved changes")).toBeVisible();
    const dialogs = /** @type {string[]} */ ([]);
    page.once("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await memory.getByRole("button", { name: "Close" }).click();
    await expect(memory).toBeVisible();
    assert.deepEqual(dialogs, ["Discard unsaved Memory changes?"]);
    await memory.getByRole("button", { name: "Save Memory" }).click();
    await expect(memory.getByText("Memory saved.")).toBeVisible();
    await memory.getByRole("button", { name: "Close" }).click();
    await expect(memory).toBeHidden();
    api.script([{ text: "Noted." }]);
    await send(page, "What day are meetings?");
    assert.match(lastRequest()?.system ?? "", /会議は月曜日/);
    log("Memory editor: IME text committed exactly, unsaved Close asked first, saved Memory reached the next call");

    // Keyboard only from here: review, Draft, change navigation, Apply, Undo.
    propose();
    await input.focus();
    await page.keyboard.type("Simplify the first step and add a shared agendas feature.");
    await page.keyboard.press("Enter");
    await expect(count(page)).toHaveText("2", { timeout: 60_000 });
    await idle(page);
    await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur());
    await tabTo(page, page.getByRole("button", { name: /^Draft/ }), "Draft");
    await page.keyboard.press("Enter");
    const draft = frame(page, "Draft");
    await expect(draft.getByText("Shared agendas")).toBeVisible();
    await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
    await expectAligned(draft, "on desktop");
    await tabTo(page, page.locator(".cms-assistant-change").first().locator(".cms-assistant-change__head button"), "first change in review");
    // The focus pulse is transient, so record it as it happens.
    await draft.locator("body").evaluate(() => {
      const seen = /** @type {any} */ (window).__zcFocused = /** @type {string[]} */ ([]);
      new MutationObserver(records => { for (const record of records) if (record.target instanceof HTMLElement && record.target.hasAttribute("data-focus")) seen.push(record.target.dataset.annotation ?? ""); })
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-focus"] });
    });
    await page.keyboard.press("Enter");
    await expect.poll(() => draft.locator("body").evaluate(() => /** @type {any} */ (window).__zcFocused.length)).toBeGreaterThan(0);
    const focused = await draft.locator("body").evaluate(() => /** @type {any} */ (window).__zcFocused[0]);
    await expect.poll(() => draft.locator(`.zc-review-box[data-annotation="${focused}"]`).evaluate(box => { const rect = box.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
    await expectAligned(draft, "after keyboard navigation scrolled the change into view");
    await scrollPreview(draft);
    await expectAligned(draft, "after scrolling on desktop");
    await page.setViewportSize({ width: 1180, height: 820 });
    await expectAligned(draft, "after a desktop resize");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expectAligned(draft, "after restoring the desktop size");
    await shot(page, "device-draft-desktop");
    await tabTo(page, page.getByRole("button", { name: "Apply to Composer" }), "Apply to Composer");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".cms-assistant-review").getByRole("status")).toContainText("Receipt ");
    const applied = await canonical();
    assert.ok(applied[0]?.includes("Connect your calendar in one click") && applied[1]?.includes("Shared agendas"), "Apply wrote JSON and JSX");
    for (const text of applied) assert.doesNotMatch(text, /zc-review|data-zc-review|Changed \d+\/\d+|Added \d+\/\d+/u, "saved JSON/JSX carry no review annotations");
    const visitor = await context.newPage();
    await visitor.goto(`${origin}/website-preview`);
    await expect(visitor.getByText("Connect your calendar in one click")).toBeVisible({ timeout: 90_000 });
    await expect(visitor.locator(".zc-review-box, .zc-review-badge, [data-zc-review-layer]")).toHaveCount(0);
    assert.equal(await visitor.evaluate(() => /** @type {any} */ (CSS).highlights?.size ?? 0), 0, "visitor output registers no review highlights");
    assert.doesNotMatch(await visitor.content(), /zc-review/u);
    await visitor.close();
    log("visitor /website-preview carries the applied text and no annotation markup or highlights");
    await tabTo(page, page.getByRole("button", { name: "Undo apply" }), "Undo apply");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Undo committed" })).toBeVisible({ timeout: 60_000 });
    assert.deepEqual(await canonical(), before, "Undo restored the saved page");
    log("keyboard only: Tab/Enter reached Draft, a review change, Apply and Undo with visible focus rings; outlines and labels aligned through scroll and resize");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── Touch at Galaxy Fold sizes ──
  for (const fold of /** @type {const} */ ([{ name: "folded", width: 344, height: 882, rotate: true }, { name: "unfolded", width: 673, height: 841, rotate: false }])) {
    const context = await browser.newContext({ viewport: { width: fold.width, height: fold.height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = /** @type {string[]} */ ([]);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    const conversationTab = page.getByRole("tab", { name: "Conversation" }), pageTab = page.getByRole("tab", { name: /^Page/ });
    await expect(conversationTab).toHaveAttribute("aria-selected", "true", { timeout: 90_000 });
    if (fold.name === "folded") {
      // A junk stored tab value falls back to Conversation, never to two overlapping panes.
      await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some(key => /^zudo-assistant:.+:conversation$/.test(key)))).toBe(true);
      for (const junk of ["junk", { tab: "page" }, 1]) {
        await page.evaluate(value => {
          const key = /** @type {string} */ (Object.keys(sessionStorage).find(entry => /^zudo-assistant:.+:conversation$/.test(entry)));
          sessionStorage.setItem(key.replace(/:conversation$/, ":tab"), JSON.stringify(value));
        }, junk);
        await page.reload();
        await expect(conversationTab).toHaveAttribute("aria-selected", "true", { timeout: 90_000 });
        await expect(page.locator(".cms-assistant-left")).toBeVisible();
        await expect(page.locator(".cms-assistant-right")).toBeHidden();
      }
      log("junk stored tab values fall back to the Conversation view alone");
    }
    await pageTab.tap();
    await expect(pageTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cms-assistant-left")).toBeHidden();
    const current = frame(page, "Current");
    await expect(current.getByText("Every moving part of your week")).toBeVisible({ timeout: 90_000 });

    // Selecting a block that contains a link selects it and never navigates.
    await expect(page.getByRole("button", { name: "Select block" })).toHaveAttribute("aria-pressed", "true");
    const link = current.locator('[data-zc-owner="local"][data-zc-node-id] a[href]').first();
    await expect(link).toBeVisible();
    const frameUrl = await current.locator("body").evaluate(() => location.href);
    const navigations = /** @type {string[]} */ ([]);
    const onNavigation = (/** @type {import('@playwright/test').Frame} */ navigated) => { navigations.push(navigated.url()); };
    page.on("framenavigated", onNavigation);
    await link.scrollIntoViewIfNeeded();
    await link.tap();
    // The selection chip proves the tap was handled; only then judge navigation.
    await conversationTab.tap();
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cms-assistant-right")).toBeHidden();
    await expect(page.locator(".cms-assistant-context").getByText(/^Selected: /)).toBeVisible();
    page.off("framenavigated", onNavigation);
    assert.deepEqual(navigations, [], "tapping a link while selecting must not navigate any frame");
    assert.equal(await current.locator("body").evaluate(() => location.href), frameUrl, "tapping a link while selecting must not navigate the preview");
    assert.equal(page.url(), url, "tapping a link while selecting must not navigate the editor");
    await page.getByRole("button", { name: "Clear selection" }).tap();

    // The authoring document asks Chromium to shrink the layout viewport for a virtual keyboard;
    // at that shorter height the message box and Send/Stop stay visible.
    assert.match(await page.locator('meta[name="viewport"]').getAttribute("content") ?? "", /interactive-widget=resizes-content/);
    const input = page.locator("#assistant-input");
    await input.tap();
    await page.setViewportSize({ width: fold.width, height: Math.round(fold.height * 0.55) });
    await input.fill("Write a long essay.");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    assert.ok(await inViewport(page, page.getByRole("button", { name: "Send" })), `Send stays visible above a virtual keyboard (${fold.name})`);
    assert.ok(await inViewport(page, input), `the message box stays visible above a virtual keyboard (${fold.name})`);
    api.script([{ holdUntilAbort: true }]);
    await page.getByRole("button", { name: "Send" }).tap();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    assert.ok(await inViewport(page, page.getByRole("button", { name: "Stop" })), `Stop stays visible above a virtual keyboard (${fold.name})`);
    await page.getByRole("button", { name: "Stop" }).tap();
    await idle(page);
    await expect(lastReply(page).getByText("Stopped")).toBeVisible();
    await expectRenameReachable(page, `with a virtual keyboard at Fold ${fold.name}`);
    await page.setViewportSize({ width: fold.width, height: fold.height });

    // Review by touch: Draft annotations, one-tap Apply and Undo with their receipts.
    propose();
    await send(page, "Simplify the first step and add a shared agendas feature.");
    await expect(count(page)).toHaveText("2");
    await pageTab.tap();
    await page.getByRole("button", { name: /^Draft/ }).tap();
    const draft = frame(page, "Draft");
    await expect(draft.getByText("Shared agendas")).toBeVisible();
    await expect.poll(() => highlighted(draft)).toEqual(expect.arrayContaining(["Shared agendas", "calendar in one click"]));
    await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
    await expectAligned(draft, `at Fold ${fold.name} ${fold.width}x${fold.height}`);
    await expectPreviewRoom(page, `at Fold ${fold.name}`);
    await expectAligned(draft, `after scrolling the Page view at Fold ${fold.name}`);
    await scrollPreview(draft);
    await expectAligned(draft, `after scrolling at Fold ${fold.name}`);
    await shot(page, `device-draft-fold-${fold.name}`);
    if (fold.rotate) {
      for (const [width, height] of [[390, 844], [844, 390], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await expectAligned(draft, `at ${width}x${height}`);
        await scrollPreview(draft);
        await expectAligned(draft, `after scrolling at ${width}x${height}`);
        await expectPreviewRoom(page, `at ${width}x${height}`);
        await expectAligned(draft, `after scrolling the Page view at ${width}x${height}`);
        if (width > height) {
          await shot(page, "device-draft-landscape");
          await conversationTab.tap();
          await expectRenameReachable(page, `at ${width}x${height}`);
          for (const [name, target] of /** @type {const} */ ([["message box", page.locator("#assistant-input")], ["Send", page.getByRole("button", { name: "Send" })]])) assert.ok(await inViewport(page, target), `${name} is on screen at ${width}x${height}`);
          await shot(page, "device-conversation-landscape");
          await pageTab.tap();
          await expectAligned(draft, `back on Page at ${width}x${height}`);
        }
      }
      await page.setViewportSize({ width: fold.width, height: fold.height });
      await expectAligned(draft, `back at Fold ${fold.name}`);
    }
    const apply = page.getByRole("button", { name: "Apply to Composer" });
    await apply.scrollIntoViewIfNeeded();
    // Apply reloads the editor under a new write epoch; the Page view and its receipt must come back.
    await apply.tap();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    await expect(pageTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cms-assistant-review").getByRole("status")).toContainText("Receipt ");
    await expect(page.locator("iframe[title$='page preview']").contentFrame().locator(".zc-review-box")).toHaveCount(0);
    const undo = page.getByRole("button", { name: "Undo apply" });
    await undo.scrollIntoViewIfNeeded();
    await undo.tap();
    await expect(page.getByRole("heading", { name: "Undo committed" })).toBeVisible({ timeout: 60_000 });
    await expect(pageTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cms-assistant-review").getByRole("status")).toContainText("Receipt ");
    assert.deepEqual(await canonical(), before, "Undo restored the saved page");
    log(`touch at Fold ${fold.name} ${fold.width}x${fold.height}: tab switch, link-safe selection, Send/Stop above a virtual keyboard, aligned annotations${fold.rotate ? " through 390x844/844x390 rotation" : ""}, one-tap Apply and Undo with receipts`);
    assert.deepEqual(errors, []);
    await context.close();
  }
  await stop();
}

async function exactInsertionJourneys() {
  const host = await prepareAssistantHost({ kind: "edit-host", dir: join(temporary, "native"), baseUrl: api.url, name: "Proof Bot" });
  const ref = (pageId) => ({ sitemapId: "main", pageId });
  const file = (id, ext) => join(host.dir, "cms/compositions/workspace-v1-native-proof", `composition-${id}.${ext}`);
  const read = async () => Promise.all(["home", "other"].flatMap(id => [readFile(file(id, "composition.json"), "utf8"), readFile(file(id, "tsx"), "utf8")]));
  await start(host.dir);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${origin}/composer?assistant=1&sitemap=main&page=home`);
  await expect(frame(page, "Current").getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 90_000 });
  const before = await read();
  // Select a real location in the page (links/navigation are suppressed while selecting).
  await frame(page, "Current").getByText("Before replacement", { exact: true }).click();
  await expect(page.getByText(/Selected: Paragraph/)).toBeVisible();
  const attach = async (kind, fill) => {
    await page.locator(".cms-assistant-compose > .cms-assistant-row").getByRole("button", { name: "Attach", exact: true }).click();
    await page.getByRole("combobox", { name: "Kind" }).selectOption(kind);
    await fill();
    await page.locator(".cms-assistant-attach").getByRole("button", { name: "Attach", exact: true }).click();
    await expect(page.locator(".cms-assistant-attach")).toHaveCount(0);
  };
  const exactText = "正確な日本語の追記。\n改行と  空白を保持。";
  await attach("text", () => page.getByRole("textbox", { name: "Exact text" }).fill(exactText));
  await attach("table", () => page.getByRole("textbox", { name: "Table JSON" }).fill(JSON.stringify({ columns: ["項目", "値"], rows: [["数量", "3"]] })));
  await attach("image", async () => { await page.getByRole("combobox", { name: "Image", exact: true }).selectOption({ index: 1 }); await page.getByRole("textbox", { name: "Alternative text" }).fill("Native managed image"); });
  await expect(page.locator(".cms-assistant-context .cms-assistant-chip")).toHaveCount(5);
  const payloads = body => [...JSON.stringify(body.messages).matchAll(/payload-[a-f0-9-]{36}/g)].map(match => match[0]).filter((id, index, all) => all.indexOf(id) === index);
  api.script([
    { tools: [{ name: "inspect_page", input: {} }, { name: "read_material", input: body => ({ payloadId: payloads(body)[0] }) }] },
    { tools: [{ name: "inspect_page", input: { page: ref("other") } }] },
    { tools: [{ name: "propose_changes", input: body => { const [text, table, image] = payloads(body); return { operations: [
      { kind: "insertExact", page: ref("home"), at: { after: "paragraph" }, payloadId: text },
      { kind: "insertExact", page: ref("home"), at: { after: "list" }, payloadId: table },
      { kind: "insertExact", page: ref("home"), at: { after: "table" }, payloadId: image },
      { kind: "updateField", page: ref("other"), nodeId: "paragraph", prop: "text", value: "Other page copy, now clearer", reason: "clarify the other page" },
    ] }; } }] },
    { text: "Your exact text, table and image are placed after the selected paragraph, list and table; the other page's copy is clarified." },
  ]);
  await send(page, "Insert my exact text after this paragraph, the table after the list and the image after the table. Also clarify the other page's paragraph.");
  await expect(count(page)).toHaveText("4");
  assert.deepEqual(await read(), before, "proposals must not write canonical files");
  await page.getByRole("button", { name: /^Draft/ }).click();
  const draft = frame(page, "Draft");
  await expect(draft.getByRole("cell", { name: "数量" })).toBeVisible();
  await expect.poll(() => highlighted(draft)).toEqual(expect.arrayContaining(["数量", "3"]));
  await expect.poll(() => draft.getByRole("img", { name: "Native managed image" }).evaluate(element => /** @type {HTMLImageElement} */ (element).complete && /** @type {HTMLImageElement} */ (element).naturalWidth > 0)).toBe(true);
  await shot(page, "native-exact-insertions");
  // Both changed pages need their own successful Draft render before Apply.
  await expect(page.locator("#assistant-apply-state")).toContainText("other");
  await page.getByRole("navigation", { name: "Changed pages" }).getByRole("button", { name: /other/ }).click();
  await expect(frame(page, "Draft").locator(".zc-review-badge")).toHaveText(["Changed 1/1"]);
  await expect.poll(() => highlighted(frame(page, "Draft"))).toEqual([", now clearer"]);
  await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 30_000 });
  // Another tab holding an unsaved iframe edit blocks Apply without consuming that edit or writing anything.
  const second = await page.context().newPage();
  await second.goto(`${origin}/composer?provider=files&composition=other`);
  const structural = second.frameLocator('iframe[title="Composer preview canvas"]');
  await structural.getByText("Editable Markdown source", { exact: true }).dblclick();
  const prose = structural.getByRole("textbox", { name: "Markdown source", exact: true });
  await prose.fill("未保存の Markdown");
  await page.getByRole("button", { name: "Apply to Composer" }).click();
  await expect(page.locator(".cms-assistant-review [role=alert]")).toContainText("Finish saving in every authoring tab", { timeout: 30_000 });
  await expect(prose).toHaveText("未保存の Markdown");
  assert.deepEqual(await read(), before, "a dirty tab must block Apply");
  await prose.press("Escape");
  await structural.getByRole("button", { name: "Discard changes", exact: true }).click();
  await second.close();
  log("an unsaved edit in another tab blocked Apply and was retained");
  await expect(page.getByRole("button", { name: "Apply to Composer" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Apply to Composer" }).click();
  await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
  const applied = await read();
  assert.ok(applied[1]?.includes("正確な日本語の追記。"), "home JSX carries the exact Japanese text");
  assert.ok(JSON.parse(applied[0] ?? "{}").document.root.some(node => node.componentId === "native.table"), "home JSON");
  assert.match(applied[2] ?? "", /now clearer/);
  await stop();
  await start(host.dir);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
  await shot(page, "native-applied-receipt");
  // A just-reloaded tab's previous socket may still be registered; coordination then refuses safely and a retry succeeds.
  for (let attempt = 0; ; attempt++) {
    await page.getByRole("button", { name: "Undo apply" }).click();
    const outcome = await Promise.race([
      page.getByRole("heading", { name: "Undo committed" }).waitFor({ timeout: 60_000 }).then(() => "done"),
      page.locator(".cms-assistant-review [role=alert]").filter({ hasText: "Finish saving in every authoring tab" }).waitFor({ timeout: 60_000 }).then(() => "refused"),
    ]);
    if (outcome === "done") break;
    assert.ok(attempt < 2, "Undo kept being refused by browser coordination");
    log("Undo refused while a stale tab connection drained; retrying as an operator would");
  }
  assert.deepEqual((await read()).map(text => text.replace(/"updatedAt": "[^"]+"/g, "")), before.map(text => text.replace(/"updatedAt": "[^"]+"/g, "")));
  log("exact text/table/image + multi-page Apply committed both pages with one receipt; guarded Undo restored them");
  await context.close();
  await stop();
}

async function otherThemes() {
  for (const kind of /** @type {const} */ (["blog", "webshop"])) {
    const host = await prepareAssistantHost({ kind, dir: join(temporary, kind), baseUrl: api.url });
    await start(host.dir);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const target = host.pages[0];
    await page.goto(`${origin}/composer?assistant=1&sitemap=${target.sitemapId}&page=${target.pageId}`);
    await expect(page.locator('iframe[title="Current page preview"]')).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(3000);
    await shot(page, `${kind}-assistant`);
    log(`${kind}: Assistant opened on the real ${kind} pack`);
    await page.close();
    await stop();
  }
}

try {
  await rm(evidence, { recursive: true, force: true });
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  await landingJourneys();
  await deviceJourneys();
  await exactInsertionJourneys();
  await otherThemes();
  log(`passed; screenshots in ${evidence}`);
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: join(evidence, `failure-${Date.now()}.png`) }).catch(() => {});
  if (server) console.error(server.output().slice(-4000));
  throw error;
} finally {
  await stop().catch(() => {});
  await browser?.close();
  await api.close();
  await rm(temporary, { recursive: true, force: true });
}
