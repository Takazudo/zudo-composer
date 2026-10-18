// @ts-check
// OPT-IN LIVE Assistant acceptance. Unlike `test:browser:assistant` (loopback
// scripted replies), this lane sends real requests to the Anthropic Messages API
// through the product's own adapter. It never injects model replies or tool
// sequences: the loopback meter in front of the API only forwards, records the
// contract and refuses requests that would exceed the approved spend.
//
// It runs only when ALL of these hold, and otherwise writes a "blocked" result
// and exits 3 (never 0):
//   ZUDO_ASSISTANT_LIVE_API_KEY   a key provisioned for this purpose (never ANTHROPIC_API_KEY,
//                                 never a Claude Code login); passed only to the authoring server
//   ZUDO_ASSISTANT_LIVE_MAX_USD   the approved spend cap (<= 50); the meter fails closed above it
//   not CI, unless ZUDO_ASSISTANT_LIVE_ALLOW_CI=1
// `--plan` prints provider, model, inputs, request cap and spend cap without sending anything.
//
// Inputs are public demo definitions (Orrery, Margin Notes, Nightjar Supply)
// seeded into new disposable hosts plus the synthetic texts below. Owns browser
// port 4177; run serially with the other browser lanes.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHostServer } from "./packed-host-helpers.mjs";
import { prepareAssistantHost } from "./assistant/prepare-host.mjs";
import { startLiveMeter } from "./assistant/live-meter.mjs";
import { frame, highlighted, lastReply, send } from "./assistant/browser-helpers.mjs";

const root = resolve(import.meta.dirname, "..");
const port = 4177, origin = `http://127.0.0.1:${port}`;
const KEY_ENV = "ZUDO_ASSISTANT_LIVE_API_KEY";
const MODEL = "claude-opus-5-5";
const HARD_CEILING_USD = 50;
const REPLY_TIMEOUT = 300_000;
const LIVE_UPSTREAM = "https://api.anthropic.com";
const upstream = process.env.ZUDO_ASSISTANT_LIVE_UPSTREAM ?? LIVE_UPSTREAM;
const loopbackUpstream = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(upstream);
const maxRequests = Number(process.env.ZUDO_ASSISTANT_LIVE_MAX_REQUESTS ?? 90);
const maxUsd = Number(process.env.ZUDO_ASSISTANT_LIVE_MAX_USD);
const evidence = resolve(process.env.ZUDO_ASSISTANT_LIVE_EVIDENCE_DIR ?? join(root, "test-results/assistant-live"));

const ORRERY = { sitemapId: "demo-landing-sitemap", home: "home-node", features: "features-node", pricing: "pricing-node" };
const BLOG = { sitemapId: "margin-notes-sitemap", newsletter: "newsletter" };
const SHOP = { sitemapId: "nightjar-supply-sitemap", home: "home" };
const LONG_TEXT = [
  "Each Sunday the note brings one essay, one passage from a book on the desk, and one small tool we have been testing for a month or more.",
  ...Array.from({ length: 14 }, (_, index) => `Paragraph ${index + 1}. The note is written slowly during the week and finished on Saturday evening. It keeps to a single page, avoids links that only exist to be clicked, and says plainly when a recommendation comes from a gift or a loan rather than a purchase. Readers write back often, and their replies shape the next letter.`),
  "You will recieve the note at seven in the morning in your own time zone, and you can leave with one click at the bottom of any letter.",
].join("\n\n");
/** Every message the lane can send, listed in the plan before anything is spent. */
const TURNS = {
  A1: "Our readers are first-time team leads. Please remember for this site: write in a warm, plain tone and avoid jargon.",
  A2: "In one sentence: who do we write for, and in what tone?",
  B1: "Change the title of the selected step to say \"Link your calendar in one click\". Don't change anything else.",
  B2: "最初の機能カードの説明文を、初めてのチームリーダーにも分かる平易な一文に書き換えてください。他は変えないでください。",
  B3: "Add a fourth feature card after the last one, titled \"Shared agendas\", with a one-sentence body about agendas everyone can edit. Use the same kind of card as the others.",
  C1: "On this page, change the intro under the main \"Features\" heading to exactly: \"Seven things Orrery does so that nobody misses a planning session.\"",
  C2: "Actually, put the first step's title back exactly to what it was originally.",
  E1: "In one sentence, according to site Memory: who is our audience?",
  E3: "What does site Memory say about our audience?",
  E4: "Please remember for future conversations: we always write numbers as numerals.",
  E5: "What do you remember about this site?",
  F1: "Make the heading better.",
  F2: "Add a custom HTML embed with a <script> tag below the hero that loads a third-party chat widget.",
  F3: "Add an Enterprise tier to the pricing table on this page.",
  G1: "Replace the newsletter page's body text with my attached text, exactly as attached.",
  G2: "In the newsletter page's body, the last paragraph misspells \"receive\". Fix only that word and keep everything else exactly the same.",
  G3: "Change the intro under the newsletter page heading to exactly: \"One short letter every Sunday morning.\"",
  H1: "Change the selected block's heading to \"Notes from the workbench\".",
};

const plan = {
  lane: "assistant-live",
  evidenceClass: upstream === LIVE_UPSTREAM ? "live inference (real Anthropic Messages API through the product adapter)" : "HARNESS SMOKE against a loopback upstream: not live inference",
  provider: "anthropic", model: MODEL, adapter: "@anthropic-ai/sdk 0.131.0 (pinned), streaming, adaptive thinking, effort medium, fallbacks: \"default\"",
  upstream, credentialEnv: KEY_ENV, limits: { maxRequests, maxUsd: Number.isFinite(maxUsd) ? maxUsd : null, hardCeilingUsd: HARD_CEILING_USD, replyTimeoutMs: REPLY_TIMEOUT },
  data: "Public demo definitions seeded into new disposable hosts, plus the synthetic texts listed here. No private data.",
  hosts: ["Orrery (packages/demo-landing)", "Margin Notes (packages/demo-blog)", "Nightjar Supply (packages/demo-webshop)"],
  turns: Object.entries(TURNS).map(([id, text]) => ({ id, text })), syntheticAttachment: { kind: "text", characters: LONG_TEXT.length },
  estimate: "About 45-60 model calls (18 turns) at roughly $0.05-0.20 each; the meter refuses any call whose worst case would pass the cap.",
};

/** @param {Record<string, unknown>} record */
const withoutSystem = record => { const copy = { ...record }; delete copy.system; return copy; };
const sanitize = (/** @type {unknown} */ value, /** @type {string[]} */ paths) => JSON.parse(paths.reduce((text, path, index) => text.split(path).join(`<host-${index}>`), JSON.stringify(value)));
const git = () => { try { return { sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "" }; } catch { return { sha: "unknown", dirty: true }; } };

async function writeResult(/** @type {Record<string, unknown>} */ result) {
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "result.json"), `${JSON.stringify({ ...git(), at: new Date().toISOString(), plan, ...result }, null, 2)}\n`);
}

if (process.argv.includes("--plan")) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
const blockers = [
  ...(process.env[KEY_ENV]?.trim() ? [] : [`${KEY_ENV} is not set (no credential provisioned for live Assistant verification)`]),
  ...(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= HARD_CEILING_USD ? [] : [`ZUDO_ASSISTANT_LIVE_MAX_USD must be an approved spend cap between 0 and ${HARD_CEILING_USD}`]),
  ...(upstream === LIVE_UPSTREAM || loopbackUpstream ? [] : [`ZUDO_ASSISTANT_LIVE_UPSTREAM must be ${LIVE_UPSTREAM} (live) or a loopback URL (harness smoke); the key is never sent elsewhere`]),
  ...(process.env.CI && process.env.ZUDO_ASSISTANT_LIVE_ALLOW_CI !== "1" ? ["CI is set; the live lane never runs in CI unless ZUDO_ASSISTANT_LIVE_ALLOW_CI=1"] : []),
];
if (blockers.length) {
  await writeResult({ status: "blocked", blockers });
  console.error(`assistant-live: blocked\n- ${blockers.join("\n- ")}\nRun with --plan to review what would be sent.`);
  process.exit(3);
}

/** @typedef {{ journey: string, id: string, expectation: string, observed: unknown, verdict: "pass" | "fail" | "deterministic-only" }} Check */
/** @type {Check[]} */
const checks = [];
const log = (/** @type {string} */ line) => console.log(`assistant-live: ${line}`);
const check = (/** @type {string} */ journey, /** @type {string} */ id, /** @type {string} */ expectation, /** @type {unknown} */ observed, /** @type {boolean} */ pass) => {
  checks.push({ journey, id, expectation, observed, verdict: pass ? "pass" : "fail" });
  log(`${pass ? "PASS" : "FAIL"} ${journey}/${id}: ${expectation}`);
};
const deterministicOnly = (/** @type {string} */ journey, /** @type {string} */ id, /** @type {string} */ expectation, /** @type {string} */ coveredBy) => checks.push({ journey, id, expectation, observed: { coveredBy }, verdict: "deterministic-only" });

const temporary = await mkdtemp(join(tmpdir(), "assistant-live-"));
const meter = await startLiveMeter({ upstream, maxUsd, maxRequests, captureInputs: true });
/** @type {{ turn: string, host: string, reply: string, outcome: unknown, memory: unknown, tools: string[], requests: unknown[] }[]} */
const transcript = [];
/** @type {import('@playwright/test').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startHostServer>> | undefined} */
let server;
const hostDirs = /** @type {string[]} */ ([]);

async function start(/** @type {string} */ dir) {
  const env = { ...process.env };
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ZUDO_ASSISTANT_TEST_KEY"]) delete env[name];
  server = await startHostServer(dir, { port, env, command: process.execPath, args: [join(root, "bin/zudo-composer.mjs"), "dev", "--host", "127.0.0.1", "--port", String(port), "--strict-port"] });
}
async function stop() { await server?.stop(); server = undefined; }

/** All JSON records under one host directory's named private store. */
async function records(/** @type {string} */ dir, /** @type {string} */ store) {
  const found = /** @type {any[]} */ ([]);
  const walk = async (/** @type {string} */ path) => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === "node_modules") continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.name.endsWith(".json") && next.includes(`/${store}/`)) found.push(JSON.parse(await readFile(next, "utf8")));
    }
  };
  await walk(join(dir, "cms"));
  return found;
}
async function draftState(/** @type {string} */ dir) {
  const all = await records(dir, "edit-drafts");
  const state = all.find(record => "currentDraftId" in record);
  return { generation: state?.generation ?? 0, draft: all.find(record => record.kind === "assistant-shared-draft" && record.id === state?.currentDraftId) ?? null, all: all.filter(record => record.kind === "assistant-shared-draft") };
}
async function assistantState(/** @type {string} */ dir) {
  const all = await records(dir, "assistant");
  // Run records also carry a `memory` (the revision they used); the site record is the one with history.
  return { site: all.find(record => record.memory && Array.isArray(record.history)), conversations: all.filter(record => Array.isArray(record.messages)), runs: all.filter(record => Array.isArray(record.events)) };
}
/** Canonical composition documents of the host: file name -> text. */
async function canonical(/** @type {string} */ dir) {
  const base = join(dir, "cms/compositions");
  const [workspace] = await readdir(base);
  const files = /** @type {Record<string, string>} */ ({});
  for (const name of (await readdir(join(base, workspace))).sort()) files[name] = await readFile(join(base, workspace, name), "utf8");
  return files;
}
/** Structural diff of canonical JSON documents: changed props, added/removed nodes and order of the rest. */
function diff(/** @type {Record<string, string>} */ before, /** @type {Record<string, string>} */ after) {
  const flat = (/** @type {string} */ text) => { const nodes = /** @type {any[]} */ ([]); const walk = (/** @type {any[]} */ list) => list.forEach(node => { nodes.push(node); Object.values(node.slots ?? {}).forEach(walk); }); walk(JSON.parse(text).document.root); return nodes; };
  const props = /** @type {{ file: string, nodeId: string, prop: string, before: unknown, after: unknown }[]} */ ([]), added = /** @type {string[]} */ ([]), removed = /** @type {string[]} */ ([]), reordered = /** @type {string[]} */ ([]), jsx = /** @type {string[]} */ ([]);
  for (const file of Object.keys(after)) {
    if (file.endsWith(".tsx")) { if (before[file] !== after[file]) jsx.push(file); continue; }
    if (!file.endsWith(".composition.json") || before[file] === after[file]) continue;
    const a = flat(before[file]), b = flat(after[file]);
    const byId = new Map(a.map(node => [node.id, node]));
    for (const node of b) {
      const old = byId.get(node.id);
      if (!old) { added.push(`${file}#${node.id}`); continue; }
      for (const key of new Set([...Object.keys(old.props), ...Object.keys(node.props)])) if (JSON.stringify(old.props[key]) !== JSON.stringify(node.props[key])) props.push({ file, nodeId: node.id, prop: key, before: old.props[key], after: node.props[key] });
    }
    for (const node of a) if (!b.some(next => next.id === node.id)) removed.push(`${file}#${node.id}`);
    const kept = (/** @type {any[]} */ list) => list.filter(node => a.some(x => x.id === node.id) && b.some(x => x.id === node.id)).map(node => node.id).join(",");
    if (kept(a) !== kept(b)) reordered.push(file);
  }
  return { props, added, removed, reordered, jsx };
}
const withoutTimestamps = (/** @type {Record<string, string>} */ files) => Object.fromEntries(Object.entries(files).map(([name, text]) => [name, text.replace(/"updatedAt": "[^"]+"/g, "")]));
/** Effective field changes of a draft: the last value per field compared with the saved page. */
function effective(/** @type {any} */ draft) {
  if (!draft) return { fields: [], inserts: [] };
  const last = new Map();
  for (const operation of draft.operations) if (operation.kind === "updateField") last.set(`${operation.page.pageId}|${operation.nodeId}|${operation.prop}`, operation);
  const fields = [...last.values()].filter(operation => {
    const page = draft.pages.find((/** @type {any} */ entry) => entry.page.pageId === operation.page.pageId);
    const nodes = /** @type {any[]} */ ([]); const walk = (/** @type {any[]} */ list) => list.forEach(node => { nodes.push(node); Object.values(node.slots ?? {}).forEach(walk); });
    walk(page?.before?.document?.root ?? []);
    return JSON.stringify(nodes.find(node => node.id === operation.nodeId)?.props?.[operation.prop]) !== JSON.stringify(operation.value);
  }).map(operation => ({ page: operation.page.pageId, nodeId: operation.nodeId, prop: operation.prop, value: operation.value }));
  const inserts = draft.operations.filter((/** @type {any} */ operation) => operation.kind === "insertNode").map((/** @type {any} */ operation) => ({ page: operation.page.pageId, componentId: operation.origin?.componentId ?? operation.node.componentId, at: operation.at, props: operation.node.props }));
  return { fields, inserts };
}

/** Sends one turn through the real UI and returns what the server persisted and what the API saw. */
async function turn(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ host, /** @type {keyof typeof TURNS} */ id) {
  const firstRequest = meter.records().length;
  await send(page, TURNS[id], REPLY_TIMEOUT);
  const state = await assistantState(host);
  const conversation = state.conversations.find(entry => entry.messages.some((/** @type {any} */ message) => message.role === "user" && message.text === TURNS[id]));
  const userIndex = conversation?.messages.findLastIndex((/** @type {any} */ message) => message.role === "user" && message.text === TURNS[id]) ?? -1;
  const reply = conversation?.messages.slice(userIndex + 1).find((/** @type {any} */ message) => message.role === "assistant");
  const run = state.runs.find(entry => entry.id === reply?.runId);
  const tools = (run?.events ?? []).filter((/** @type {any} */ event) => event.type === "tool" && event.data.status === "running").map((/** @type {any} */ event) => event.data.name);
  const requests = meter.records().slice(firstRequest);
  transcript.push({ turn: id, host: hostDirs.indexOf(host) >= 0 ? `host-${hostDirs.indexOf(host)}` : "host", reply: reply?.text ?? "", outcome: reply?.outcome, memory: reply?.memory, tools, requests: requests.map(withoutSystem) });
  return { reply: reply?.text ?? "", outcome: reply?.outcome, memory: reply?.memory, proposals: reply?.memoryProposals ?? [], remembered: reply?.remembered ?? [], clarification: (run?.events ?? []).some((/** @type {any} */ event) => event.type === "clarification"), tools, requests, conversationId: conversation?.id, run };
}
/** Runs one journey; any harness or model failure is recorded and the lane continues. */
async function journey(/** @type {string} */ name, /** @type {() => Promise<void>} */ body, /** @type {import('@playwright/test').Page} */ page) {
  try { await body(); } catch (error) {
    check(name, "completed", "journey ran to the end", error instanceof Error ? error.message.split("\n")[0] : String(error), false);
    // A failed journey may leave a modal open; the next journey starts from a fresh load of the same page.
    await shot(page, `failure-${name}`);
    await page.reload().catch(() => {});
    await expect(page.locator('iframe[title="Current page preview"]')).toBeVisible({ timeout: 90_000 }).catch(() => {});
  }
}
/** Starts an empty conversation and waits until the previous messages are gone. */
async function newConversation(/** @type {import('@playwright/test').Page} */ page) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator(".cms-assistant-message")).toHaveCount(0, { timeout: 30_000 });
}
const shot = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ name) => page.screenshot({ path: join(evidence, `${name}.png`) }).catch(() => {});
const openMemory = async (/** @type {import('@playwright/test').Page} */ page) => { await page.getByRole("button", { name: /^Memory/ }).click(); return page.getByRole("dialog", { name: /Site Memory/ }); };
const japanese = /[぀-ヿ一-龯]/u;

async function orrery() {
  const host = (await prepareAssistantHost({ kind: "landing", dir: join(temporary, "orrery"), baseUrl: meter.url, apiKeyEnv: KEY_ENV, workspaceId: "site", name: "Orrery Bot" })).dir;
  hostDirs.push(host);
  await start(host);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("dialog", dialog => void dialog.accept());
  const open = async (/** @type {string} */ pageId) => { await page.goto(`${origin}/composer?assistant=1&sitemap=${ORRERY.sitemapId}&page=${pageId}`); await expect(page.locator('iframe[title="Current page preview"]')).toBeVisible({ timeout: 90_000 }); };
  await open(ORRERY.home);
  await expect(frame(page, "Current").getByText("Connect your calendars")).toBeVisible({ timeout: 90_000 });
  const pristine = await canonical(host);

  await journey("A", async () => {
    const a1 = await turn(page, host, "A1");
    const saved = (await assistantState(host)).site?.memory;
    check("A", "read-only-proposal", "Read only: the model proposes a Memory update instead of saving it", { proposals: a1.proposals.map((/** @type {any} */ proposal) => proposal.change), savedRevision: saved?.revision, tools: a1.tools }, a1.proposals.length > 0 && saved?.revision === 0);
    await lastReply(page).getByRole("button", { name: "Save to Memory" }).first().click();
    await expect(lastReply(page).getByText(/Saved as r\d+/)).toBeVisible({ timeout: 30_000 });
    const approved = (await assistantState(host)).site?.memory;
    check("A", "human-approval", "Only the human approval saves the proposal", { revision: approved?.revision, body: approved?.body }, approved?.revision === 1 && /team lead/i.test(approved?.body ?? ""));
    await newConversation(page);
    const a2 = await turn(page, host, "A2");
    const first = /** @type {any} */ (a2.requests[0]);
    check("A", "other-conversation-uses-memory", "A new conversation's actual model input carries the saved Memory revision and no earlier history", { usedMemory: a2.memory, messagesInRequest: first?.messages, memoryInSystem: first?.system?.includes(approved?.body ?? "\u0000"), reply: a2.reply }, /** @type {any} */ (a2.memory)?.revision === 1 && first?.messages === 1 && first?.system?.includes(approved?.body ?? "\u0000"));
    check("A", "answer-reflects-memory", "The answer names the audience and tone from Memory (meaning, not wording)", a2.reply, /lead/i.test(a2.reply) && /(warm|plain)/i.test(a2.reply));
    await expect(lastReply(page).getByText(/Used Memory r1/)).toBeVisible();
  }, page);

  await journey("B", async () => {
    await newConversation(page);
    await frame(page, "Current").getByText("Connect your calendars").click();
    await expect(page.getByText(/Selected:/)).toBeVisible();
    const b1 = await turn(page, host, "B1");
    let changes = effective((await draftState(host)).draft);
    check("B", "narrow-field-update", "Only the selected step's title changes, to the requested words", changes, changes.fields.length === 1 && changes.fields[0].nodeId === "home-land-step-11" && changes.fields[0].prop === "title" && /calendar/i.test(String(changes.fields[0].value)) && /one click/i.test(String(changes.fields[0].value)) && changes.inserts.length === 0);
    check("B", "inspected-before-proposing", "The model inspected the page before proposing", b1.tools, b1.tools.indexOf("inspect_page") >= 0 && b1.tools.indexOf("inspect_page") < b1.tools.indexOf("propose_changes"));
    const b2 = await turn(page, host, "B2");
    changes = effective((await draftState(host)).draft);
    const feature = changes.fields.filter(field => field.nodeId === "home-land-feature-item-5");
    check("B", "japanese-request", "A Japanese request rewrites only the first feature card's body, and the reply is in Japanese", { fields: changes.fields, reply: b2.reply }, feature.length === 1 && feature[0].prop === "body" && changes.fields.length === 2 && japanese.test(b2.reply));
    const b3 = await turn(page, host, "B3");
    changes = effective((await draftState(host)).draft);
    const insert = changes.inserts[0];
    check("B", "registered-component-insert", "One registered land.feature-item is added after the last card with the requested title", { inserts: changes.inserts, tools: b3.tools }, changes.inserts.length === 1 && insert.componentId === "land.feature-item" && /shared agendas/i.test(String(insert.props?.title)) && (insert.at?.after === "home-land-feature-item-7" || (insert.at?.parentId === "home-land-feature-grid-4" && insert.at?.index === 3)));
    check("B", "canonical-unchanged-before-apply", "Proposals never write canonical JSON/JSX", diff(pristine, await canonical(host)), JSON.stringify(await canonical(host)) === JSON.stringify(pristine));
  }, page);

  await journey("C", async () => {
    await page.getByRole("button", { name: /^Draft/ }).click();
    const draft = frame(page, "Draft");
    await expect(page.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 60_000 });
    const words = await highlighted(draft);
    const badges = await draft.locator(".zc-review-badge").allTextContents();
    check("C", "draft-annotations", "Draft view marks changed words in yellow and labels changed/added blocks", { words, badges }, words.length > 0 && badges.some(text => /^Added \d+\/\d+$/.test(text)) && badges.some(text => /^Changed \d+\/\d+$/.test(text)));
    await shot(page, "orrery-draft");
    await page.getByRole("button", { name: "Current", exact: true }).click();
    const current = await frame(page, "Current").locator(".zc-review-badge").allTextContents();
    check("C", "current-annotations", "Current view marks the blocks and words that will change", { badges: current, deletions: await highlighted(frame(page, "Current"), "zc-review-delete") }, current.some(text => /^Will change/.test(text)));
    await shot(page, "orrery-current");
    await open(ORRERY.features);
    await turn(page, host, "C1");
    const changes = effective((await draftState(host)).draft);
    const intro = changes.fields.find(field => field.page === ORRERY.features);
    check("C", "second-page-exact", "The features page intro is set exactly as requested", changes.fields, intro?.nodeId === "features-land-section-heading-2" && intro?.prop === "intro" && intro?.value === "Seven things Orrery does so that nobody misses a planning session.");
    const tabs = await page.getByRole("navigation", { name: "Changed pages" }).getByRole("button").allTextContents();
    check("C", "multi-page-badge", "The review lists both changed pages", tabs, tabs.length === 2);
    await page.locator('.cms-assistant-change[data-kind="added"]').getByRole("button", { name: "Withdraw" }).click();
    await expect(page.locator('.cms-assistant-change[data-kind="added"]')).toHaveCount(0, { timeout: 30_000 });
    check("C", "withdraw", "Withdraw removes the added card and keeps the other changes", effective((await draftState(host)).draft), effective((await draftState(host)).draft).inserts.length === 0 && effective((await draftState(host)).draft).fields.length === 3);
    await open(ORRERY.home);
    await turn(page, host, "C2");
    const after = effective((await draftState(host)).draft);
    check("C", "zero-diff", "Returning the step title to its saved value removes that change", after.fields, !after.fields.some(field => field.nodeId === "home-land-step-11") && after.fields.length === 2);
    check("C", "canonical-unchanged", "Nothing was saved before Apply", null, JSON.stringify(await canonical(host)) === JSON.stringify(pristine));
  }, page);

  await journey("D", async () => {
    const expected = effective((await draftState(host)).draft).fields;
    await page.getByRole("button", { name: /^Draft/ }).click();
    for (const tab of await page.getByRole("navigation", { name: "Changed pages" }).getByRole("button").all()) { await tab.click(); await page.waitForTimeout(1000); }
    await expect(page.getByRole("button", { name: "Apply to Composer" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Apply to Composer" }).click();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    const applied = await canonical(host);
    const changed = diff(pristine, applied);
    const matches = changed.props.length === expected.length && expected.every(field => changed.props.some(prop => prop.nodeId === field.nodeId && prop.prop === field.prop && JSON.stringify(prop.after) === JSON.stringify(field.value)));
    check("D", "atomic-multi-page-apply", "Apply saves exactly the reviewed fields on both pages, with their JSX, and nothing else", changed, matches && changed.added.length === 0 && changed.removed.length === 0 && changed.reordered.length === 0 && changed.jsx.length === 2);
    const receipt = (await draftState(host)).all.find(entry => entry.status === "applied");
    check("D", "receipt", "The draft carries the writer's receipt", receipt?.applied ?? null, !!receipt?.applied?.operationId);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 90_000 });
    await shot(page, "orrery-applied");
    await page.getByRole("button", { name: "Undo apply" }).click();
    await expect(page.getByRole("heading", { name: "Undo committed" })).toBeVisible({ timeout: 60_000 });
    check("D", "undo", "Undo restores both pages", diff(pristine, await canonical(host)), JSON.stringify(withoutTimestamps(await canonical(host))) === JSON.stringify(withoutTimestamps(pristine)));
    deterministicOnly("D", "lost-response-retry", "A lost Apply response is reconciled from the receipt and retry is idempotent", "server/edit/__tests__/draft-service.test.ts (receipt reconciliation) and test:browser:assistant");
    deterministicOnly("D", "undo-refused-after-edit", "Undo is refused after a later ordinary edit", "server/edit/__tests__/draft-service.test.ts (guarded Undo)");
  }, page);

  await journey("E", async () => {
    let dialog = await openMemory(page);
    const box = dialog.getByRole("textbox");
    await box.fill((await box.inputValue()).replace(/first-time team leads/i, "experienced operations managers"));
    await dialog.getByRole("button", { name: "Save Memory" }).click();
    await expect(dialog.getByText("Memory saved.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    const memory = (await assistantState(host)).site?.memory;
    const sameConversation = await turn(page, host, "E1");
    const sent = /** @type {any} */ (sameConversation.requests[0]);
    check("E", "correction-same-conversation", "The next call in the same conversation carries the corrected Memory and not the old text", { revision: memory?.revision, used: sameConversation.memory, reply: sameConversation.reply }, sent?.system?.includes("experienced operations managers") && !/first-time team leads/i.test(sent?.system ?? "") && /** @type {any} */ (sameConversation.memory)?.revision === memory?.revision && /operations/i.test(sameConversation.reply));
    await newConversation(page);
    const fresh = await turn(page, host, "E1");
    check("E", "correction-new-conversation", "A new conversation (no history) answers from the corrected Memory", { messages: /** @type {any} */ (fresh.requests[0])?.messages, reply: fresh.reply }, /** @type {any} */ (fresh.requests[0])?.messages === 1 && /operations/i.test(fresh.reply));
    dialog = await openMemory(page);
    await dialog.getByRole("radio", { name: /^Off/ }).check();
    await expect(dialog.getByText(/Memory mode: Off/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    const off = await turn(page, host, "E3");
    const offRequest = /** @type {any} */ (off.requests[0]);
    check("E", "off", "Off sends no Memory and no remember tool", { tools: offRequest?.tools, reply: off.reply }, !offRequest?.tools?.some((/** @type {any} */ tool) => tool.name === "remember") && /turned off/i.test(offRequest?.system ?? "") && !offRequest?.system?.includes("operations managers"));
    dialog = await openMemory(page);
    await dialog.getByRole("radio", { name: /Auto remember/ }).check();
    await expect(dialog.getByText(/Memory mode: Auto remember/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    const before = (await assistantState(host)).site?.memory;
    const auto = await turn(page, host, "E4");
    const saved = (await assistantState(host)).site?.memory;
    check("E", "auto", "Auto remember saves one bounded fact without approval", { remembered: auto.remembered, before: before?.revision, after: saved?.revision, body: saved?.body }, auto.remembered.length >= 1 && saved?.revision > before?.revision && /numeral/i.test(saved?.body ?? ""));
    dialog = await openMemory(page);
    await dialog.getByRole("button", { name: "Clear" }).click();
    await expect(dialog.getByText(/Memory cleared/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await newConversation(page);
    const cleared = await turn(page, host, "E5");
    check("E", "clear", "After Clear the model input says Memory is empty and earlier conversations are kept", { system: /Site Memory is empty/.test(/** @type {any} */ (cleared.requests[0])?.system ?? ""), conversations: (await assistantState(host)).conversations.length, reply: cleared.reply }, /Site Memory is empty/.test(/** @type {any} */ (cleared.requests[0])?.system ?? "") && (await assistantState(host)).conversations.length >= 4);
    deterministicOnly("E", "late-run-fence", "Clear/mode change fences replies that started earlier", "server/assistant/__tests__/store.test.ts and runner.test.ts");
    deterministicOnly("E", "memory-cas", "Concurrent Memory saves conflict instead of overwriting", "server/assistant/__tests__/store.test.ts");
    dialog = await openMemory(page);
    await dialog.getByRole("radio", { name: /Read only/ }).check();
    await dialog.getByRole("button", { name: "Close" }).click();
  }, page);

  await journey("F", async () => {
    const draftBefore = JSON.stringify(effective((await draftState(host)).draft));
    await newConversation(page);
    const ambiguous = await turn(page, host, "F1");
    check("F", "ambiguous-clarifies", "An ambiguous request asks a question and changes nothing", { clarification: ambiguous.clarification, reply: ambiguous.reply, tools: ambiguous.tools }, JSON.stringify(effective((await draftState(host)).draft)) === draftBefore && (ambiguous.clarification || /\?/.test(ambiguous.reply)));
    const unsupported = await turn(page, host, "F2");
    check("F", "unsupported-refused", "Free HTML/script is refused without any draft change", { reply: unsupported.reply, tools: unsupported.tools }, JSON.stringify(effective((await draftState(host)).draft)) === draftBefore && !unsupported.tools.includes("propose_changes"));
    await open(ORRERY.pricing);
    const mapped = await turn(page, host, "F3");
    check("F", "mapped-refused", "A Mapping-owned collection is not changed", { reply: mapped.reply, tools: mapped.tools, draft: effective((await draftState(host)).draft) }, JSON.stringify(effective((await draftState(host)).draft)) === draftBefore);
    check("F", "canonical-unchanged", "Refusals saved nothing", null, JSON.stringify(withoutTimestamps(await canonical(host))) === JSON.stringify(withoutTimestamps(pristine)));
    const conversations = (await assistantState(host)).site?.conversations?.length ?? 0;
    await page.close();
    await stop();
    await start(host);
    const again = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await again.goto(`${origin}/composer?assistant=1&sitemap=${ORRERY.sitemapId}&page=${ORRERY.home}`);
    await expect(again.getByRole("combobox", { name: "Conversation" })).toBeVisible({ timeout: 90_000 });
    // The list loads after the control renders; wait for it rather than reading the placeholder.
    const listed = again.getByRole("combobox", { name: "Conversation" }).locator("option:not([value=''])");
    await expect.poll(() => listed.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(conversations).catch(() => {});
    const options = await listed.count();
    check("F", "restart-keeps-state", "After a server restart, conversations and Memory are still there", { conversations, options }, options >= conversations);
    await again.close();
  }, page);
  await stop();
  return host;
}

async function marginNotes(/** @type {string} */ orreryHost) {
  const host = (await prepareAssistantHost({ kind: "blog", dir: join(temporary, "margin-notes"), baseUrl: meter.url, apiKeyEnv: KEY_ENV, workspaceId: "site", name: "Margin Bot" })).dir;
  hostDirs.push(host);
  await start(host);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("dialog", dialog => void dialog.accept());
  await page.goto(`${origin}/composer?assistant=1&sitemap=${BLOG.sitemapId}&page=${BLOG.newsletter}`);
  await expect(page.locator('iframe[title="Current page preview"]')).toBeVisible({ timeout: 90_000 });
  await journey("F", async () => {
    const dialog = await openMemory(page);
    const body = await dialog.getByRole("textbox").inputValue();
    await dialog.getByRole("button", { name: "Close" }).click();
    const own = await assistantState(host), other = await assistantState(orreryHost);
    const ownMessages = own.conversations.flatMap(conversation => conversation.messages);
    const otherIds = new Set(other.conversations.map(conversation => conversation.id));
    check("F", "workspace-isolation", "A different host with the same workspace id shares no Memory, messages, conversations or draft", { memoryBody: body, messages: ownMessages.length, sharedConversationIds: own.conversations.filter(conversation => otherIds.has(conversation.id)).length, draft: (await draftState(host)).draft?.id ?? null, otherMessages: other.conversations.flatMap(conversation => conversation.messages).length }, body === "" && ownMessages.length === 0 && own.conversations.every(conversation => !otherIds.has(conversation.id)) && !(await draftState(host)).draft);
  }, page);
  await journey("G", async () => {
    await page.locator(".cms-assistant-compose > .cms-assistant-row").getByRole("button", { name: "Attach", exact: true }).click();
    await page.getByRole("combobox", { name: "Kind" }).selectOption("text");
    await page.getByRole("textbox", { name: "Exact text" }).fill(LONG_TEXT);
    await page.locator(".cms-assistant-attach").getByRole("button", { name: "Attach", exact: true }).click();
    await turn(page, host, "G1");
    let changes = effective((await draftState(host)).draft);
    check("G", "exact-attachment", "The attached text becomes the body exactly", changes.fields.map(field => ({ ...field, value: typeof field.value === "string" ? `${field.value.length} chars` : field.value })), changes.fields.length === 1 && changes.fields[0].nodeId === "newsletter-body" && changes.fields[0].value === LONG_TEXT);
    await page.getByRole("button", { name: /^Draft/ }).click();
    await expect(page.getByRole("button", { name: "Apply to Composer" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Apply to Composer" }).click();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    const withLong = await canonical(host);
    await newConversation(page);
    const g2 = await turn(page, host, "G2");
    changes = effective((await draftState(host)).draft);
    const fixed = LONG_TEXT.replace("recieve", "receive");
    check("G", "long-field-read", "A shortened field is read with read_field before it is edited", g2.tools, g2.tools.includes("read_field") && g2.tools.indexOf("read_field") < g2.tools.lastIndexOf("propose_changes"));
    check("G", "long-field-narrow", "Only the misspelt word changes in the long field", changes.fields.map(field => ({ nodeId: field.nodeId, prop: field.prop, equalsExpected: field.value === fixed })), changes.fields.length === 1 && changes.fields[0].value === fixed);
    await page.getByRole("button", { name: "Discard all" }).click();
    await expect(page.getByText("No pending AI changes")).toBeVisible({ timeout: 30_000 });
    check("G", "discard", "Discard drops the draft and saves nothing", null, JSON.stringify(await canonical(host)) === JSON.stringify(withLong) && !(await draftState(host)).draft);
    await turn(page, host, "G3");
    changes = effective((await draftState(host)).draft);
    check("G", "blog-narrow", "The heading intro is set exactly", changes.fields, changes.fields.length === 1 && changes.fields[0].nodeId === "newsletter-heading" && changes.fields[0].prop === "intro" && changes.fields[0].value === "One short letter every Sunday morning.");
    await page.getByRole("button", { name: /^Draft/ }).click();
    await expect(page.getByRole("button", { name: "Apply to Composer" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Apply to Composer" }).click();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    const changed = diff(withLong, await canonical(host));
    check("G", "blog-apply", "Apply saved only that field", changed, changed.props.length === 1 && changed.props[0].nodeId === "newsletter-heading" && changed.added.length === 0 && changed.removed.length === 0);
    await shot(page, "margin-notes-applied");
  }, page);
  await page.close();
  await stop();
}

async function nightjar() {
  const host = (await prepareAssistantHost({ kind: "webshop", dir: join(temporary, "nightjar"), baseUrl: meter.url, apiKeyEnv: KEY_ENV, workspaceId: "site", name: "Nightjar Bot" })).dir;
  hostDirs.push(host);
  await start(host);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/composer?assistant=1&sitemap=${SHOP.sitemapId}&page=${SHOP.home}`);
  await expect(frame(page, "Current").getByText("Letters from the shelf")).toBeVisible({ timeout: 90_000 });
  const pristine = await canonical(host);
  await journey("H", async () => {
    await frame(page, "Current").getByText("Letters from the shelf").click();
    await expect(page.getByText(/Selected:/)).toBeVisible();
    await turn(page, host, "H1");
    const changes = effective((await draftState(host)).draft);
    check("H", "shop-narrow", "Only the selected newsletter heading changes", changes.fields, changes.fields.length === 1 && changes.fields[0].nodeId === "home-shop-newsletter-4" && changes.fields[0].prop === "heading" && changes.fields[0].value === "Notes from the workbench");
    await page.getByRole("button", { name: /^Draft/ }).click();
    await expect(page.getByRole("button", { name: "Apply to Composer" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Apply to Composer" }).click();
    await expect(page.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
    const changed = diff(pristine, await canonical(host));
    check("H", "shop-apply", "Apply saved only that field", changed, changed.props.length === 1 && changed.props[0].nodeId === "home-shop-newsletter-4" && changed.added.length === 0 && changed.removed.length === 0);
    await shot(page, "nightjar-applied");
  }, page);
  await page.close();
  await stop();
}

let status = "failed";
try {
  await rm(evidence, { recursive: true, force: true });
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const orreryHost = await orrery();
  await marginNotes(orreryHost);
  await nightjar();
  status = checks.some(entry => entry.verdict === "fail") ? "failed" : "passed";
} catch (error) {
  check("lane", "harness", "the lane ran to the end", error instanceof Error ? error.message.split("\n")[0] : String(error), false);
} finally {
  await stop().catch(() => {});
  await browser?.close().catch(() => {});
  const contract = meter.records().filter(record => !record.refused).map(record => ({ requested: record.requestedModel, served: record.servedModel, thinking: record.thinking, effort: record.effort, fallbacks: record.fallbacks, beta: record.beta, stop: record.stopReason, blocks: record.blocks, hops: record.fallbackHops, status: record.status, error: record.error }));
  await writeResult(sanitize({
    status, checks, transcript,
    contract: { calls: contract.length, servedModels: [...new Set(contract.map(entry => entry.served))], stopReasons: [...new Set(contract.map(entry => entry.stop))], fallbacks: contract.filter(entry => entry.hops.length), errors: contract.filter(entry => entry.error || entry.status >= 400) },
    spend: { usd: Number(meter.spent().toFixed(4)), forwarded: meter.forwarded(), refused: meter.records().filter(record => record.refused).length },
    meter: meter.records().map(withoutSystem),
  }, [...hostDirs, temporary]));
  await meter.close();
  await rm(temporary, { recursive: true, force: true });
  const failed = checks.filter(entry => entry.verdict === "fail").length;
  log(`${status}: ${checks.filter(entry => entry.verdict === "pass").length} pass, ${failed} fail, ${checks.filter(entry => entry.verdict === "deterministic-only").length} deterministic-only; $${meter.spent().toFixed(2)} over ${meter.forwarded()} calls; evidence in ${evidence}`);
  process.exitCode = status === "passed" ? 0 : 1;
}
