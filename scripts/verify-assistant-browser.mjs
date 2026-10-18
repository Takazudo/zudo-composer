// @ts-check
/* global CSS */
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
/** @param {import('@playwright/test').Page} page */
async function idle(page) {
  await expect(page.locator('.cms-assistant-message[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
}
/** @param {import('@playwright/test').Page} page @param {string} text */
async function send(page, text) {
  const replies = page.locator('.cms-assistant-message[data-role="assistant"]:not([aria-busy])');
  const before = await replies.count();
  await page.locator("#assistant-input").fill(text);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(replies).toHaveCount(before + 1, { timeout: 60_000 });
  await idle(page);
}
/** @param {import('@playwright/test').Page} page */
const lastReply = page => page.locator('.cms-assistant-message[data-role="assistant"]').last();
/** @param {import('@playwright/test').Page} page */
const count = page => page.locator(".cms-assistant-review .cms-assistant-count").first();
/** @param {import('@playwright/test').Page} page @param {"Draft" | "Current"} kind */
const frame = (page, kind) => page.frameLocator(`iframe[title="${kind} page preview"]`);
/** @param {import('@playwright/test').FrameLocator} preview */
const highlighted = preview => preview.locator("body").evaluate(() => {
  const value = /** @type {any} */ (CSS).highlights?.get("zc-review-insert");
  return value ? [...value].map((/** @type {Range} */ range) => range.toString()) : [];
});
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

async function exactInsertionJourneys() {
  const host = await prepareAssistantHost({ kind: "edit-host", dir: join(temporary, "native"), baseUrl: api.url, name: "Proof Bot" });
  const ref = (pageId) => ({ sitemapId: "main", pageId });
  const file = (id, ext) => join(host.dir, "cms/compositions/workspace-v1-native-proof", `composition-${id}.${ext}`);
  const read = async () => Promise.all(["home", "other"].flatMap(id => [readFile(file(id, "composition.json"), "utf8"), readFile(file(id, "tsx"), "utf8")]));
  await start(host.dir);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  await page.getByRole("button", { name: "Apply to Composer" }).click();
  await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
  const applied = await read();
  assert.ok(applied[1]?.includes("正確な日本語の追記。"), "home JSX carries the exact Japanese text");
  assert.ok(JSON.parse(applied[0] ?? "{}").document.root.some(node => node.componentId === "native.table"), "home JSON");
  assert.match(applied[2] ?? "", /now clearer/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
  await shot(page, "native-applied-receipt");
  await page.getByRole("button", { name: "Undo apply" }).click();
  await expect(page.getByRole("heading", { name: "Undo committed" })).toBeVisible({ timeout: 60_000 });
  assert.deepEqual((await read()).map(text => text.replace(/"updatedAt": "[^"]+"/g, "")), before.map(text => text.replace(/"updatedAt": "[^"]+"/g, "")));
  log("exact text/table/image + multi-page Apply committed both pages with one receipt; guarded Undo restored them");
  await page.close();
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
