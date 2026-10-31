// @ts-check
// Opt-in real-CLI acceptance for Content-AI, ONE provider at a time, through the
// independently installed Article CMS: the host's Node process runs the CLI with
// the person's normal sign-in, and a real browser drives the host admin. It
// never runs in CI and makes no model call until --yes.
//
// The scratch host is a fresh copy of this checkout's article-cms fixture over an
// installed consumer's node_modules (pnpm hosted:install <sha> <dir>), with its
// own SQLite data in a temp dir: no existing workspace or data is opened.
// Exactly one model call is planned (one title-only proposal) and a hard cap
// refuses a second; render, Apply, restart, recovery and Undo never call the
// model. Every step runs once and is judged by targets, structure, saved values,
// unchanged fields and receipt/history invariants — never by model wording.
//
// --allow-fake-executable permits ONLY the repository's fake CLI fixtures, for a
// dry run of this script itself; its result is labelled and never written under
// verification/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { DRY_LABEL, REAL_LABEL, ciRefusal, createScrubber, repo, selectCliExecutable, writeNumberedResult, writesUnderVerification } from "../assistant/real-cli-shared.mjs";

const MODEL_CALL_BUDGET = 1;
const USAGE = `Usage: node scripts/content-ai/verify-real-cli.mjs --provider claude-cli|codex-cli --consumer <installed consumer dir> [--executable <name|/abs/path>] [--model <id>] [--timeout-ms <n>] [--max-minutes <n>] [--plan] [--yes] [--keep]
  --consumer               an installed hosted consumer (pnpm hosted:install <sha> <dir>) whose zudo-composer hosted-content payload equals this checkout
  --plan                   print the target data, provider and planned calls, then exit without running anything
  --yes                    required to start (the one real CLI call spends your normal CLI plan/quota)
  --timeout-ms             bound for the one model reply (default 180000, at most 600000)
  --max-minutes            bound for the whole run (default 10, at most 30)
  --keep                   keep the disposable host directory afterwards
  --out-dir <dir>          where the JSON result goes (default verification/content-ai/real-cli)
  --allow-fake-executable  dry run of this script with scripts/fixtures/assistant/fake-*-cli.mjs only
Exit codes: 0 all steps passed, 1 a step failed, 2 refused/usage, 3 provider blocked.`;

const { values: options } = parseArgs({
  strict: true,
  options: {
    provider: { type: "string" }, consumer: { type: "string" }, executable: { type: "string" }, model: { type: "string" },
    "timeout-ms": { type: "string", default: "180000" }, "max-minutes": { type: "string", default: "10" },
    plan: { type: "boolean", default: false }, yes: { type: "boolean", default: false }, keep: { type: "boolean", default: false },
    "out-dir": { type: "string" }, "allow-fake-executable": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  },
});
/** @param {string} message @returns {never} */
const refuse = message => { console.error(`${message}\n${USAGE}`); process.exit(2); };
if (options.help) { console.log(USAGE); process.exit(0); }
const provider = /** @type {"claude-cli" | "codex-cli"} */ (options.provider);
if (provider !== "claude-cli" && provider !== "codex-cli") refuse("--provider must be claude-cli or codex-cli.");
const inCi = ciRefusal();
if (inCi) refuse(inCi);
const timeoutMs = Number(options["timeout-ms"]), maxMinutes = Number(options["max-minutes"]);
if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) refuse("--timeout-ms must be an integer between 5000 and 600000.");
if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 30) refuse("--max-minutes must be between 0 and 30.");
if (!options.consumer) refuse("--consumer is required: install one with pnpm hosted:install <pushed sha> <dir>.");
const consumer = resolve(/** @type {string} */ (options.consumer));
const selected = await selectCliExecutable({ provider, requested: options.executable, allowFake: options["allow-fake-executable"] });
if ("refusal" in selected) refuse(selected.refusal);
const { executable, dryRun } = /** @type {{ executable: string, dryRun: boolean }} */ (selected);
const label = dryRun ? DRY_LABEL : REAL_LABEL;
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const outDir = options["out-dir"] ? resolve(options["out-dir"]) : dryRun ? join(repo, "test-results/content-ai-real-cli-dry-run") : join(repo, "verification/content-ai/real-cli");
if (dryRun && writesUnderVerification(outDir)) refuse("A dry run never writes under verification/.");

// The installed tool must be this checkout's hosted-content payload, or the run would test other code.
/** @param {string} directory */
async function digestTree(directory) {
  const hash = createHash("sha256");
  for (const name of (await readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => relative(directory, join(entry.parentPath, entry.name))).sort())
    hash.update(`${name}\0${createHash("sha256").update(await readFile(join(directory, name))).digest("hex")}\n`);
  return hash.digest("hex");
}
const installed = join(consumer, "node_modules/zudo-composer/server/hosted-content");
if (!existsSync(installed)) refuse(`${consumer} is not an installed hosted consumer (no node_modules/zudo-composer).`);
if (await digestTree(installed) !== await digestTree(join(repo, "server/hosted-content"))) refuse("The consumer's installed zudo-composer hosted-content payload differs from this checkout; install the pushed commit of this checkout.");

const INSTRUCTION = dryRun ? "shorter title" : "Rewrite only the title of this article so it is shorter and clearer. Do not change the body.";
console.log([
  `Content-AI ${dryRun ? "DRY RUN" : "real CLI check"}: ${provider} (${basename(executable)}${options.model ? `, model ${options.model}` : ""})`,
  `  Label:    ${label}`,
  "  Data:     a fresh disposable Article CMS (SQLite with the demo articles only) in a temp dir, built from this checkout's",
  "            article-cms fixture over the installed consumer. No existing workspace or data is opened or changed.",
  `  Provider: ${provider} with ${dryRun ? "the repository fake executable" : "your normal CLI sign-in"}; it is never replaced by another provider.`,
  `  Calls:    exactly ${MODEL_CALL_BUDGET} model call (one title-only proposal for the "welcome" article); a second call is refused.`,
  "            Rendering, Apply, restart, recovery and Undo read saved state and never call the model.",
  `  Limits:   ${timeoutMs} ms for the model reply; ${maxMinutes} min for the whole run; the proposal is bounded by the service (50000 characters a field, 80 for the title).`,
  "  Steps:    provider status → publish A, save B → prepare (title only) → rendered candidate → Apply →",
  "            restart, reload and recover the Apply → Undo → restart and recover the Undo.",
  `  Instruction: ${JSON.stringify(INSTRUCTION)}`,
  `  Result:   ${relative(repo, outDir) || "."}/${provider}-<cliVersion>-${sha.slice(0, 8)}.json`,
].join("\n"));
if (options.plan) process.exit(0);
if (!dryRun && !options.yes) { console.log("Nothing was run. Re-run with --yes to start."); process.exit(2); }

const temporary = await mkdtemp(join(tmpdir(), "content-ai-real-cli-"));
const hostDir = join(temporary, "host"), data = join(temporary, "data");
await cp(join(repo, "fixtures/hosted-content-consumer/article-cms"), join(hostDir, "article-cms"), { recursive: true });
await cp(join(repo, "fixtures/hosted-content-consumer/sqlite-storage.mjs"), join(hostDir, "sqlite-storage.mjs"));
await cp(join(consumer, "package.json"), join(hostDir, "package.json"));
await symlink(join(consumer, "node_modules"), join(hostDir, "node_modules"), "dir");
const scrub = createScrubber([temporary, consumer, repo]);
const log = (/** @type {string} */ line) => console.log(`content-ai-real-cli: ${line}`);
const deadline = Date.now() + maxMinutes * 60_000;

/** @type {{ startArticleCms: Function }} */
const { startArticleCms } = await import(pathToFileURL(join(hostDir, "article-cms/server.mjs")).href);
/** @type {{ createContentAiProvider: Function }} */
const { createContentAiProvider } = await import(pathToFileURL(join(hostDir, "node_modules/zudo-composer/server/hosted-content/node.mjs")).href);
const base = await createContentAiProvider({ provider, executable, timeoutMs, ...(options.model ? { model: options.model } : {}) });
const calls = { count: 0 };
// The budget is enforced here, around the provider the host uses; nothing retries a call.
const counted = { ...base, label: base.label, inference: () => base.inference(), proposer: { label: base.proposer.label, async propose(/** @type {any} */ input) {
  if (++calls.count > MODEL_CALL_BUDGET) throw new Error(`Model call budget (${MODEL_CALL_BUDGET}) exceeded; a step tried to call the model again.`);
  return base.proposer.propose(input);
} } };

/** @typedef {{ name: string, status: "pass" | "fail" | "blocked", durationMs: number, details: Record<string, unknown>, error?: string }} StepResult */
/** @type {StepResult[]} */
const steps = [];
/** @param {string} name @param {(details: Record<string, unknown>) => Promise<void>} body */
async function step(name, body) {
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const details = {};
  try {
    if (Date.now() > deadline) throw new Error(`The ${maxMinutes}-minute run limit was reached before this step.`);
    await body(details);
    steps.push({ name, status: "pass", durationMs: Date.now() - started, details });
    log(`${name}: pass`);
    return true;
  } catch (error) {
    const message = scrub(String(error instanceof Error ? error.message : error)).slice(0, 2000);
    steps.push({ name, status: "fail", durationMs: Date.now() - started, details, error: message });
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
let blockedReason = null;
const api = async (/** @type {string} */ path, /** @type {unknown} */ payload) => {
  const response = await fetch(`${host.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body.message}`);
  return body;
};
const q = (/** @type {unknown} */ value) => encodeURIComponent(JSON.stringify(value));
const working = async () => (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
const published = async () => (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values;
const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
const aiCall = async (/** @type {string} */ operation, /** @type {unknown} */ payload) => api("/api/ai", { operation, payload });
const phase = (/** @type {string} */ name, timeout = 60_000) => /** @type {import('@playwright/test').Page} */ (page).locator(`.article-ai-proposal[data-ai-phase="${name}"]`).waitFor({ timeout });
async function openWelcome() {
  const current = /** @type {import('@playwright/test').Page} */ (page);
  await current.locator('[data-entry-id="welcome"]').click();
  await current.getByRole("textbox", { name: "Title" }).waitFor();
  await current.locator("section.article-ai").waitFor();
}
let port = 0;
const start = async () => { host = await startArticleCms({ directory: data, port, ai: { provider: counted } }); port = Number(new URL(host.url).port); };
const restart = async () => { await host.close(); await start(); };

try {
  await start();
  inference = await counted.inference();
  if (inference.state !== "ready") {
    // An undeterminable sign-in is not treated as signed in.
    blockedReason = `${inference.state}${inference.code ? ` (${inference.code})` : ""}: ${scrub(inference.message)}`;
    steps.push({ name: "provider-status", status: "blocked", durationMs: 0, details: { state: inference.state, code: inference.code ?? null }, error: blockedReason });
    log(`provider-status: blocked — ${blockedReason}`);
    exitCode = 3;
  } else {
    steps.push({ name: "provider-status", status: "pass", durationMs: 0, details: { detail: scrub(inference.detail), version: inference.version ?? null } });
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
      browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
      page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
      await page.goto(`${host.url}/`);
      await openWelcome();
      await page.getByRole("textbox", { name: "Instruction" }).fill(INSTRUCTION);
      await page.getByRole("button", { name: "Prepare proposal" }).click();
      await Promise.race([
        page.locator(".article-ai-proposal").waitFor({ timeout: timeoutMs + 30_000 }),
        page.locator(".article-ai [role=alert]").waitFor({ timeout: timeoutMs + 30_000 }).then(async () => { throw new Error(`No proposal: ${await page?.locator(".article-ai [role=alert]").first().textContent()}`); }),
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
      details.renderedTitle = await current.frameLocator("iframe.article-candidate-preview").locator('article[data-article="welcome"] h2').textContent() === proposal.candidate.title;
      if (!details.renderedTitle) throw new Error("The rendered candidate does not show the proposed title.");
      await current.getByRole("button", { name: "Apply proposal" }).click();
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
      await current.reload(); await openWelcome(); await phase("applied");
      const retry = (await aiCall("content-ai-apply", { proposalId: proposal.id })).value;
      details.recovered = retry.recovered === true && retry.receipt.revisionId === applied.id;
      details.noDuplicate = (await history()).length === before.history.length + 1;
      details.modelCalls = calls.count;
      if (!details.recovered || !details.noDuplicate || calls.count !== 1) throw new Error("The committed Apply was not recovered exactly once without a model call.");
    }) && await step("undo-and-recover", async details => {
      const current = /** @type {import('@playwright/test').Page} */ (page);
      await current.getByRole("button", { name: "Undo AI change" }).click();
      await phase("undone");
      await restart();
      await current.reload(); await openWelcome(); await phase("undone");
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
  steps.push({ name: "harness", status: "fail", durationMs: 0, details: {}, error: scrub(String(error instanceof Error ? error.stack ?? error.message : error)).slice(0, 4000) });
  log(`harness: FAIL — ${scrub(String(error instanceof Error ? error.message : error))}`);
  if (host) console.error(scrub(host.output()));
  exitCode = blockedReason ? 3 : 1;
} finally {
  await browser?.close().catch(() => {});
  await host?.close().catch(() => {});
}
const version = String(inference?.version ?? "unknown").replace(/[^A-Za-z0-9._-]+/g, "_");
const result = {
  label,
  evidence: dryRun ? "none: the CLI was a repository fake; its reply comes from fake-decide.mjs" : exitCode === 3 ? "none: the provider was unavailable, so no model call was made" : "real CLI inference through the person's normal sign-in, via the independently installed Article CMS",
  outcome: exitCode === 0 ? "pass" : exitCode === 3 ? "blocked" : "fail",
  ...(blockedReason ? { blockedReason } : {}),
  provider: { kind: provider, executable: basename(executable), model: options.model ?? null, version: inference?.version ?? null },
  composer: { sha, installedHostedContentMatchesCheckout: true },
  modelCalls: calls.count,
  ranAt: new Date().toISOString(),
  steps,
};
const file = await writeNumberedResult(outDir, `${provider}-${version}-${sha.slice(0, 8)}`, result);
if (options.keep) log(`kept disposable host at ${temporary}`);
else await rm(temporary, { recursive: true, force: true });
log(`${result.outcome} (${label}); result: ${relative(repo, file)}`);
process.exitCode = exitCode;
