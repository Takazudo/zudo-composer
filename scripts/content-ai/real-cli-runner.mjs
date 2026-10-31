// @ts-check
/* global AbortController, AbortSignal, setInterval */
// The bounded part of the Content-AI real-CLI acceptance, run as its own process
// group by verify-real-cli.mjs, which owns the deadline. It receives its whole
// configuration over IPC, reports each phase and step, and on SIGTERM aborts its
// HTTP requests and the provider call (whose CLI group is then killed), closes the
// browser and the host, and exits. Every step runs once; nothing retries.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createScrubber } from "../assistant/real-cli-shared.mjs";

/**
 * @typedef {{ hostDir: string, data: string, provider: "claude-cli" | "codex-cli", executable: string, model: string | null, timeoutMs: number,
 *   deadlineAt: number, instruction: string, budget: number, scrubPaths: string[], fault: string | null }} RunnerConfig
 */
/** @type {RunnerConfig} */
const config = await new Promise(resolve => process.once("message", value => resolve(/** @type {RunnerConfig} */ (value))));
const send = (/** @type {unknown} */ message) => { try { process.send?.(message); } catch { /* the supervisor is gone */ } };
const scrub = createScrubber(config.scrubPaths);
const log = (/** @type {string} */ line) => console.log(`content-ai-real-cli: ${line}`);
const cancel = new AbortController();
// Waits end a little after the deadline, so the supervisor's cancellation, not a local timeout, decides it.
const remaining = () => Math.max(1, config.deadlineAt - Date.now() + 5_000);
process.once("SIGTERM", () => cancel.abort(new Error("The run deadline expired; test-owned work was cancelled.")));

const { startArticleCms } = await import(pathToFileURL(join(config.hostDir, "article-cms/server.mjs")).href);
const { createContentAiProvider } = await import(pathToFileURL(join(config.hostDir, "node_modules/zudo-composer/server/hosted-content/node.mjs")).href);
const base = await createContentAiProvider({ provider: config.provider, executable: config.executable, timeoutMs: config.timeoutMs, ...(config.model ? { model: config.model } : {}) });
const calls = { count: 0 };
// The budget is enforced here, around the provider the host uses; the run's cancellation reaches the CLI.
const counted = { ...base, label: base.label, inference: () => base.inference(), proposer: { label: base.proposer.label, async propose(/** @type {any} */ input) {
  if (++calls.count > config.budget) throw new Error(`Model call budget (${config.budget}) exceeded; a step tried to call the model again.`);
  send({ type: "calls", count: calls.count });
  return base.proposer.propose({ ...input, signal: AbortSignal.any([input.signal, cancel.signal]) });
} } };

/** @typedef {{ name: string, status: "pass" | "fail" | "blocked", durationMs: number, details: Record<string, unknown>, error?: string }} StepResult */
/** @type {StepResult[]} */
const steps = [];
const record = (/** @type {StepResult} */ result) => { steps.push(result); send({ type: "step", step: result }); };
/** @param {string} name @param {(details: Record<string, unknown>) => Promise<void>} body */
async function step(name, body) {
  send({ type: "phase", name });
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const details = {};
  try {
    if (cancel.signal.aborted) throw cancel.signal.reason;
    await body(details);
    record({ name, status: "pass", durationMs: Date.now() - started, details });
    log(`${name}: pass`);
    return true;
  } catch (error) {
    const message = scrub(String(cancel.signal.aborted ? cancel.signal.reason.message : error instanceof Error ? error.message : error)).slice(0, 2000);
    record({ name, status: "fail", durationMs: Date.now() - started, details, error: message });
    log(`${name}: FAIL — ${message.split("\n")[0]}`);
    return false;
  }
}

const welcome = { providerId: "articles", modelId: "article", recordId: "welcome" };
const identities = (/** @type {any} */ state) => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
/** @type {any} */ let host;
/** @type {import('@playwright/test').Browser | undefined} */ let browser;
/** @type {import('@playwright/test').Page | undefined} */ let page;
/** @type {any} */ let inference = null;
/** @type {number} */ let exitCode;
/** @type {string | null} */ let blockedReason = null;
// Every request is cancelled with the run.
const api = async (/** @type {string} */ path, /** @type {unknown} */ payload) => {
  const response = await fetch(`${host.url}${path}`, { signal: cancel.signal, ...(payload === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.message}`);
  return body;
};
const q = (/** @type {unknown} */ value) => encodeURIComponent(JSON.stringify(value));
const working = async () => (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
const published = async () => (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values;
const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
const aiCall = async (/** @type {string} */ operation, /** @type {unknown} */ payload) => api("/api/ai", { operation, payload });
// Browser waits never outlast the run; closing the browser on cancellation ends any that are pending.
const phase = (/** @type {string} */ name, timeout = 60_000) => /** @type {import('@playwright/test').Page} */ (page).locator(`.article-ai-proposal[data-ai-phase="${name}"]`).waitFor({ timeout: Math.min(timeout, remaining()) });
async function openWelcome() {
  const current = /** @type {import('@playwright/test').Page} */ (page);
  await current.locator('[data-entry-id="welcome"]').click({ timeout: remaining() });
  await current.getByRole("textbox", { name: "Title" }).waitFor({ timeout: remaining() });
  await current.locator("section.article-ai").waitFor({ timeout: remaining() });
}
let port = 0;
const start = async () => { host = await startArticleCms({ directory: config.data, port, ai: { provider: counted } }); port = Number(new URL(host.url).port); };
const restart = async () => { await host.close(); await start(); };
cancel.signal.addEventListener("abort", () => { void browser?.close().catch(() => {}); });

try {
  await start();
  send({ type: "phase", name: "provider-status" });
  inference = await counted.inference();
  send({ type: "inference", inference });
  if (inference.state !== "ready") {
    // An undeterminable sign-in is not treated as signed in.
    blockedReason = `${inference.state}${inference.code ? ` (${inference.code})` : ""}: ${scrub(inference.message)}`;
    record({ name: "provider-status", status: "blocked", durationMs: 0, details: { state: inference.state, code: inference.code ?? null }, error: blockedReason });
    log(`provider-status: blocked — ${blockedReason}`);
    exitCode = 3;
  } else {
    record({ name: "provider-status", status: "pass", durationMs: 0, details: { detail: scrub(inference.detail), version: inference.version ?? null } });
    log(`provider-status: pass (${scrub(inference.detail)})`);
    /** @type {any} */ let before = null, proposal = null, applied = null;
    const ok = await step("publish-a-save-b", async details => {
      await api("/api/execute", { kind: "set-fields", operationKey: "real-cli-a", expected: identities(await api("/api/state")), entry: welcome, values: { title: "Article A" }, clear: [] });
      const state = await api("/api/state");
      const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: "real-cli-capture", expected: identities(state) })).snapshot;
      await api("/api/execute", { kind: "begin-publication", operationKey: "real-cli-submit", expected: identities(state), snapshotId: snapshot.id });
      await host.settled();
      await api("/api/execute", { kind: "set-fields", operationKey: "real-cli-b", expected: identities(await api("/api/state")), entry: welcome, values: { title: "Article B" }, clear: [] });
      before = { working: await working(), published: await published(), history: await history() };
      details.published = before.published.title; details.working = before.working.title;
      if (before.published.title !== "Article A" || before.working.title !== "Article B") throw new Error("Setup did not reach published A / working B.");
    }) && await step("prepare-title-only", async details => {
      browser = await chromium.launch({ headless: true, timeout: remaining(), ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
      page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
      await page.goto(`${host.url}/`, { timeout: remaining() });
      await openWelcome();
      // Proof-only stall: the candidate render never completes.
      if (config.fault === "stall-render") await page.evaluate(() => { /** @type {any} */ (globalThis).articleCms.candidateFrame.delayMs = 3_600_000; });
      await page.getByRole("textbox", { name: "Instruction" }).fill(config.instruction);
      await page.getByRole("button", { name: "Prepare proposal" }).click({ timeout: remaining() });
      const wait = Math.min(config.timeoutMs + 30_000, remaining());
      await Promise.race([
        page.locator(".article-ai-proposal").waitFor({ timeout: wait }),
        page.locator(".article-ai [role=alert]").waitFor({ timeout: wait }).then(async () => { throw new Error(`No proposal: ${await page?.locator(".article-ai [role=alert]").first().textContent()}`); }),
      ]);
      const proposalId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
      proposal = (await aiCall("content-ai-read", { proposalId })).value.proposal;
      details.modelCalls = calls.count;
      details.changedFields = proposal.differences.map((/** @type {any} */ item) => item.fieldId);
      details.titleLength = [...proposal.candidate.title].length;
      details.bodyUnchanged = proposal.candidate.body === before.working.body;
      details.otherFieldsUnchanged = proposal.candidate.summary === before.working.summary && proposal.candidate.author === before.working.author;
      details.nothingWritten = JSON.stringify(await history()) === JSON.stringify(before.history) && (await working()).title === "Article B" && (await published()).title === "Article A";
      if (calls.count !== 1 || JSON.stringify(details.changedFields) !== '["title"]' || !proposal.candidate.title.trim() || proposal.candidate.title === "Article B"
        || !details.bodyUnchanged || !details.otherFieldsUnchanged || !details.nothingWritten) throw new Error("The proposal is not exactly one title-only change against unchanged saved Content.");
    }) && await step("render-and-apply", async details => {
      const current = /** @type {import('@playwright/test').Page} */ (page);
      await phase("ready");
      details.renderedTitle = await current.frameLocator("iframe.article-candidate-preview").locator('article[data-article="welcome"] h2').textContent({ timeout: remaining() }) === proposal.candidate.title;
      if (!details.renderedTitle) throw new Error("The rendered candidate does not show the proposed title.");
      await current.getByRole("button", { name: "Apply proposal" }).click({ timeout: remaining() });
      await phase("applied");
      const after = await history();
      applied = after[0];
      details.oneRevision = after.length === before.history.length + 1;
      details.aiProvenance = applied.source === "content-ai" && applied.actor?.id === "article-editor" && applied.operation.key === proposal.operationKey;
      details.savedExactly = JSON.stringify(await working()) === JSON.stringify({ ...before.working, title: proposal.candidate.title });
      details.publishedUnchanged = JSON.stringify(await published()) === JSON.stringify(before.published);
      if (!details.oneRevision || !details.aiProvenance || !details.savedExactly || !details.publishedUnchanged) throw new Error("Apply did not save exactly the reviewed title as one AI revision.");
    }) && await step("restart-recover-apply", async details => {
      const current = /** @type {import('@playwright/test').Page} */ (page);
      await restart();
      await current.reload({ timeout: remaining() }); await openWelcome(); await phase("applied");
      // Proof-only stall: the host accepts the next Content-AI request and never answers it.
      if (config.fault === "stall-http") host.faults.aiDelayMs = 3_600_000;
      const retry = (await aiCall("content-ai-apply", { proposalId: proposal.id })).value;
      details.recovered = retry.recovered === true && retry.receipt.revisionId === applied.id;
      details.noDuplicate = (await history()).length === before.history.length + 1;
      details.modelCalls = calls.count;
      if (!details.recovered || !details.noDuplicate || calls.count !== 1) throw new Error("The committed Apply was not recovered exactly once without a model call.");
    }) && await step("undo-and-recover", async details => {
      const current = /** @type {import('@playwright/test').Page} */ (page);
      await current.getByRole("button", { name: "Undo AI change" }).click({ timeout: remaining() });
      await phase("undone");
      await restart();
      await current.reload({ timeout: remaining() }); await openWelcome(); await phase("undone");
      const retry = (await aiCall("content-ai-undo", { proposalId: proposal.id })).value;
      const after = await history();
      details.recovered = retry.recovered === true;
      details.restoredB = JSON.stringify(await working()) === JSON.stringify(before.working);
      details.twoRevisions = after.length === before.history.length + 2 && after[0].operation.kind === "restore-revision";
      details.publishedUnchanged = JSON.stringify(await published()) === JSON.stringify(before.published);
      details.modelCalls = calls.count;
      if (!details.recovered || !details.restoredB || !details.twoRevisions || !details.publishedUnchanged || calls.count !== 1) throw new Error("Undo did not restore B once, or a model call was made.");
    });
    exitCode = ok && steps.every(entry => entry.status === "pass") ? 0 : 1;
  }
} catch (error) {
  record({ name: "harness", status: "fail", durationMs: 0, details: {}, error: scrub(String(error instanceof Error ? error.stack ?? error.message : error)).slice(0, 4000) });
  log(`harness: FAIL — ${scrub(String(error instanceof Error ? error.message : error))}`);
  if (host) console.error(scrub(host.output()));
  exitCode = blockedReason ? 3 : 1;
}
send({ type: "done", exitCode, blockedReason, inference, modelCalls: calls.count, steps });
send({ type: "phase", name: "cleanup" });
// Proof-only stall: cleanup that never finishes, so the supervisor must end it.
if (config.fault === "stall-cleanup") await new Promise(() => { setInterval(() => {}, 60_000); });
await browser?.close().catch(() => {});
await host?.close().catch(() => {});
process.exit(exitCode);
