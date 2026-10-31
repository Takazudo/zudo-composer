// @ts-check
// Opt-in real-CLI usage check for ONE provider at a time. It uses the person's
// normal CLI sign-in, so it never runs in CI and spends nothing until --yes.
// It seeds a fresh disposable edit-host in a temp dir (never the person's
// persistent local host), starts the real server through local-host.mjs on a
// free loopback port and drives the real Assistant UI. Every step runs once;
// results are judged by target, structure, saved bytes and unchanged ranges,
// never by model wording.
//
// --allow-fake-executable permits ONLY the repository's fake CLI fixtures as
// --executable, for a dry run of this script itself. Dry-run output is
// labelled as such and is never written under verification/.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { frame, lastReply, send } from "./browser-helpers.mjs";
import { freePort, launchLocalHost } from "./launch-local-host.mjs";
import { LOCAL_DEMOS } from "./local-demo-journeys.mjs";
import { DRY_LABEL, REAL_LABEL, ciRefusal, createScrubber, repo, selectCliExecutable, writeNumberedResult, writesUnderVerification } from "./real-cli-shared.mjs";

const USAGE = `Usage: node scripts/assistant/verify-real-cli.mjs --provider claude-cli|codex-cli [--executable <name|/abs/path>] [--model <id>] [--demo sample|landing|blog|webshop] [--keep] [--yes]
  --demo                   the real demo for the bounded smoke journey (default sample)
  --yes                    required to start (real CLI calls spend your normal CLI plan/quota)
  --keep                   keep the disposable host directory afterwards
  --out-dir <dir>          where the JSON result goes (default verification/assistant/real-cli)
  --allow-fake-executable  dry run of this script with scripts/fixtures/assistant/fake-*-cli.mjs only
Exit codes: 0 all steps passed, 1 a step failed, 2 refused/usage, 3 provider blocked.`;

const { values: options } = parseArgs({
  strict: true,
  options: {
    provider: { type: "string" }, executable: { type: "string" }, model: { type: "string" },
    demo: { type: "string", default: "sample" }, keep: { type: "boolean", default: false }, yes: { type: "boolean", default: false },
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
const demo = LOCAL_DEMOS.find(candidate => candidate.host === options.demo);
if (!demo) refuse(`--demo must be one of ${LOCAL_DEMOS.map(candidate => candidate.host).join(", ")}.`);
const selected = await selectCliExecutable({ provider, requested: options.executable, allowFake: options["allow-fake-executable"] });
if ("refusal" in selected) refuse(selected.refusal);
const { executable, dryRun } = /** @type {{ executable: string, dryRun: boolean }} */ (selected);
const label = dryRun ? DRY_LABEL : REAL_LABEL;
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const outDir = options["out-dir"] ? join(process.cwd(), options["out-dir"]) : dryRun ? join(repo, "test-results/assistant-real-cli-dry-run") : join(repo, "verification/assistant/real-cli");
if (dryRun && writesUnderVerification(outDir)) refuse("A dry run never writes under verification/.");

// Natural phrasing for a real model; the fake policy only understands its own fixed forms.
const TARGET = "Verified through the Assistant";
const PROMPTS = dryRun ? {
  edit: `replace "Before replacement" with "${TARGET}"`,
  remember: "remember: Our audience is first-time gardeners.",
  recall: "Who is our audience?",
  slow: "wait",
  outOfScope: "Write custom CSS and HTML for a new component called RedBanner.",
  demo: `replace "${demo.find}" with "${demo.replace}"`,
} : {
  edit: `On this page, change the first paragraph so it reads "${TARGET}" instead of "Before replacement". Change nothing else.`,
  remember: "Please remember this for future conversations: our audience is first-time gardeners.",
  recall: "In one sentence, who is our audience?",
  slow: "Without proposing any page changes, write a very long, detailed essay (at least 3000 words) about the history of typography.",
  outOfScope: "Write custom CSS and HTML to add a brand-new RedBanner component with a red background to this page.",
  demo: `On this page, change the text "${demo.find}" so it reads "${demo.replace}" instead. Change nothing else.`,
};

console.log([
  `AI Assistant ${dryRun ? "DRY RUN" : "real CLI check"}: ${provider} (${basename(executable)}${options.model ? `, model ${options.model}` : ""})`,
  `  Label:  ${label}`,
  "  Plan:   fresh disposable native-edit host in a temp dir, free loopback port, real dev server + Playwright UI.",
  "          Steps (each once): provider status → wording edit, Draft, Apply, reload, Undo → Memory Auto + recall in a",
  "          new conversation → Stop a long reply → restart and check persistence → out-of-scope request →",
  `          real-demo smoke on ${demo.name} (its own disposable host): proposal, Draft preview, Apply, restart, Undo.`,
  `  Cost:   about 9–13 ${dryRun ? "fake (free, offline)" : "real model replies on your normal CLI sign-in"}.`,
  `  Result: ${relative(repo, outDir) || "."}/${provider}-<cliVersion>-${sha.slice(0, 8)}.json`,
].join("\n"));
if (!dryRun && !options.yes) { console.log("Nothing was run. Re-run with --yes to start."); process.exit(2); }

const temporary = await mkdtemp(join(tmpdir(), "assistant-real-cli-"));
const dir = join(temporary, "host");
const port = await freePort();
const data = join(dir, "cms");
const composition = join(data, "compositions/workspace-v1-native-proof/composition-home.composition.json");
const scrub = createScrubber([temporary, repo]);
const log = (/** @type {string} */ line) => console.log(`real-cli: ${line}`);

/** @typedef {{ name: string, status: "pass" | "fail" | "blocked", durationMs: number, details: Record<string, unknown>, error?: string }} StepResult */
/** @type {StepResult[]} */
const steps = [];
/** @type {{ provider: string, label: string, model: string | null, version: string | null } | null} */
let identity = null;
let blockedReason = null;

/** Every file under a directory, as path → sha256. @param {string} root */
async function snapshot(root) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!existsSync(root)) return out;
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(root, path)] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return out;
}
const hostSource = async () => ({ ...(await snapshot(join(dir, "components"))), ...(await snapshot(join(dir, "styles"))), config: (await snapshot(dir))["zudo-composer.config.ts"] });
const json = async (/** @type {string} */ path) => JSON.parse(await readFile(path, "utf8"));
/** Assistant records written by the server. */
async function records() {
  const root = join(data, "assistant");
  const files = existsSync(root) ? (await readdir(root)).filter(name => name.endsWith(".json")) : [];
  /** @type {any[]} */ const runs = []; /** @type {any} */ let site = null;
  for (const name of files) {
    const value = await json(join(root, name)).catch(() => null);
    if (!value) continue;
    if (name.includes(".run-")) runs.push(value);
    else if (name.endsWith(".site.json")) site = value;
  }
  runs.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return { runs, site };
}
/** The home page with the edited paragraph's text and timestamps factored out, as comparable bytes. @param {any} document */
const unchangedRanges = document => JSON.stringify(document, (key, value) => {
  if (key === "updatedAt") return undefined;
  if (value && typeof value === "object" && value.id === "paragraph" && value.props) return { ...value, props: { ...value.props, text: "<edited>" } };
  return value;
});
const paragraphText = (/** @type {any} */ document) => {
  /** @type {any} */ let found;
  JSON.stringify(document, (_key, value) => { if (value && typeof value === "object" && value.id === "paragraph") found = value; return value; });
  return found?.props?.text;
};
/** PIDs of processes running this CLI. @param {string} needle */
function cliProcesses(needle) {
  const lines = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).split("\n");
  return new Set(lines.filter(line => line.includes(needle) && !line.includes("verify-real-cli") && !line.includes("local-host.mjs")).map(line => Number(line.trim().split(/\s+/)[0])));
}

/** @param {string} name @param {(details: Record<string, unknown>) => Promise<void>} body */
async function step(name, body) {
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const details = {};
  try {
    await body(details);
    steps.push({ name, status: "pass", durationMs: Date.now() - started, details });
    log(`${name}: pass`);
  } catch (error) {
    const message = scrub(String(error instanceof Error ? error.message : error)).slice(0, 2000);
    steps.push({ name, status: "fail", durationMs: Date.now() - started, details, error: message });
    log(`${name}: FAIL — ${message.split("\n")[0]}`);
  }
}

const replyTimeout = dryRun ? 60_000 : 360_000;
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
/** @type {Awaited<ReturnType<typeof launchLocalHost>> | undefined} */
let server;
/** @type {import('@playwright/test').Page | undefined} */
let page;
/** @type {any} */
let providerStatus = null;
const launchArgs = ["--host", "edit-host", "--dir", dir, "--port", String(port), "--provider", provider, "--executable", executable, ...(options.model ? ["--model", options.model] : [])];

async function openPage() {
  page = await /** @type {import('@playwright/test').Browser} */ (browser).newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("response", async response => {
    if (!response.url().endsWith("/__zudo-assistant")) return;
    const body = response.request().postData() ?? "";
    if (!body.includes('"operation":"status"')) return;
    const value = await response.json().catch(() => null);
    if (value?.ok) providerStatus = value.result.provider;
  });
  providerStatus = null;
  await page.goto(/** @type {NonNullable<typeof server>} */ (server).url);
  await expect(frame(page, "Current").locator("body")).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => providerStatus, { timeout: 60_000 }).not.toBeNull();
  return page;
}

/** @type {number} */
let exitCode;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  server = await launchLocalHost(launchArgs);
  // 1. Provider status from the server's own probe, as the UI receives it.
  const started = Date.now();
  let p = await openPage();
  if (!providerStatus.ok) {
    blockedReason = `${providerStatus.code}: ${scrub(String(providerStatus.message))}`;
    await expect(p.getByText("AI replies are unavailable.")).toBeVisible();
    steps.push({ name: "provider-status", status: "blocked", durationMs: Date.now() - started, details: { code: providerStatus.code, version: providerStatus.version ?? null, uiShowsUnavailable: true }, error: blockedReason });
    log(`provider-status: blocked — ${blockedReason}`);
    exitCode = 3;
  } else {
    steps.push({ name: "provider-status", status: "pass", durationMs: Date.now() - started, details: { label: providerStatus.label, version: providerStatus.version, model: providerStatus.model ?? null } });
    log(`provider-status: pass (${providerStatus.label} ${providerStatus.version})`);

    // 2. Natural-language wording edit → candidate → Draft render → Apply → reload → Undo.
    await step("edit-apply-undo", async details => {
      const before = await json(composition);
      await expect(frame(p, "Current").getByText("Before replacement", { exact: true })).toBeVisible();
      await send(p, PROMPTS.edit, replyTimeout);
      const pending = p.locator(".cms-assistant-review .cms-assistant-count").first();
      await expect(pending).toBeVisible({ timeout: 10_000 });
      details.pendingChanges = Number(await pending.textContent());
      await p.getByRole("button", { name: /^Draft/ }).click();
      await expect(frame(p, "Draft").getByText(TARGET, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(p.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 60_000 });
      await p.getByRole("button", { name: "Apply to Composer" }).click();
      await expect(p.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
      const applied = await json(composition);
      details.appliedTarget = paragraphText(applied) === TARGET;
      details.otherRangesUnchanged = unchangedRanges(applied) === unchangedRanges(before);
      if (!details.appliedTarget || !details.otherRangesUnchanged) throw new Error("Saved page does not hold exactly the requested paragraph change.");
      await p.reload();
      await expect(frame(p, "Current").getByText(TARGET, { exact: true })).toBeVisible({ timeout: 120_000 });
      details.reloadShowsSaved = true;
      // A just-reloaded tab's previous socket may still be registered; the server refuses safely once (see verify-assistant-browser.mjs).
      let attempts = 0;
      for (;;) {
        attempts++;
        await p.getByRole("button", { name: "Undo apply" }).click();
        const outcome = await Promise.race([
          p.getByRole("heading", { name: "Undo committed" }).waitFor({ timeout: 60_000 }).then(() => "done"),
          p.locator(".cms-assistant-review [role=alert]").filter({ hasText: "Finish saving in every authoring tab" }).waitFor({ timeout: 60_000 }).then(() => "refused"),
        ]);
        if (outcome === "done" || attempts >= 2) break;
      }
      details.undoAttempts = attempts;
      await expect(p.getByRole("heading", { name: "Undo committed" })).toBeVisible();
      details.undoRestored = paragraphText(await json(composition)) === "Before replacement" && unchangedRanges(await json(composition)) === unchangedRanges(before);
      if (!details.undoRestored) throw new Error("Undo did not restore the saved page.");
      await expect(frame(p, "Current").getByText("Before replacement", { exact: true })).toBeVisible({ timeout: 30_000 });
    });

    // 3. Memory in Auto mode, then a new conversation reads it (by the run's recorded revision).
    await step("memory-auto-recall", async details => {
      await p.getByRole("button", { name: /^Memory/ }).click();
      const dialog = p.getByRole("dialog", { name: /Site Memory/ });
      // Controlled radio: it becomes checked once the server confirms the mode change.
      await dialog.getByRole("radio", { name: /Auto remember/ }).click();
      await expect(dialog.getByRole("radio", { name: /Auto remember/ })).toBeChecked({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Close" }).click();
      const before = (await records()).site?.memory?.revision ?? 0;
      await send(p, PROMPTS.remember, replyTimeout);
      const after = (await records()).site?.memory;
      details.mode = after?.mode;
      details.revisionBefore = before;
      details.revisionAfter = after?.revision;
      details.savedFact = /gardener/i.test(after?.body ?? "");
      if (after?.mode !== "auto" || !(after.revision > before) || !details.savedFact) throw new Error("Auto mode did not save the stated fact to Memory.");
      await expect(lastReply(p).getByText(`Remembered · Memory r${after.revision}`)).toBeVisible();
      await p.getByRole("button", { name: "New", exact: true }).click();
      await expect(p.locator(".cms-assistant-message")).toHaveCount(0);
      await send(p, PROMPTS.recall, replyTimeout);
      const run = (await records()).runs.at(-1);
      details.recallRunMemory = run?.memory ?? null;
      if (run?.memory?.status !== "used" || run.memory.revision !== after.revision) throw new Error(`The new conversation's run did not record Memory r${after.revision}.`);
      await expect(lastReply(p).getByText(`Used Memory r${after.revision}`)).toBeVisible();
    });

    // 4. Stop a long reply: run stopped, draft untouched, no CLI process left.
    await step("stop", async details => {
      const needle = dryRun ? basename(executable) : (await realpath(executable).catch(() => executable));
      const baseline = cliProcesses(needle);
      const drafts = await snapshot(join(data, "edit-drafts"));
      const pages = await snapshot(join(data, "compositions"));
      await p.locator("#assistant-input").fill(PROMPTS.slow);
      await p.getByRole("button", { name: "Send" }).click();
      await expect(p.locator('.cms-assistant-message[aria-busy="true"]')).toBeVisible({ timeout: 30_000 });
      let observed = false;
      for (let index = 0; index < 40 && !observed; index++) {
        observed = [...cliProcesses(needle)].some(pid => !baseline.has(pid));
        if (!observed) await p.waitForTimeout(250);
      }
      details.cliProcessObservedDuringRun = observed;
      await p.getByRole("button", { name: "Stop" }).click();
      await expect(p.locator('.cms-assistant-message[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
      await expect(lastReply(p).getByText("Stopped")).toBeVisible();
      const run = (await records()).runs.at(-1);
      details.runStatus = run?.status;
      let leftovers = [];
      for (let index = 0; index < 40; index++) {
        leftovers = [...cliProcesses(needle)].filter(pid => !baseline.has(pid));
        if (!leftovers.length) break;
        await p.waitForTimeout(250);
      }
      details.leftoverCliProcesses = leftovers.length;
      details.draftUnchanged = JSON.stringify(await snapshot(join(data, "edit-drafts"))) === JSON.stringify(drafts);
      details.pagesUnchanged = JSON.stringify(await snapshot(join(data, "compositions"))) === JSON.stringify(pages);
      if (run?.status !== "stopped" || leftovers.length || !details.draftUnchanged || !details.pagesUnchanged) throw new Error("Stop left a non-stopped run, a CLI process or a changed draft/page.");
    });

    // 5. Restart the server: conversations, Memory and applied/undone page state persist.
    await step("restart-persistence", async details => {
      const before = await records();
      const pages = await snapshot(join(data, "compositions"));
      await p.close();
      await server?.stop();
      server = await launchLocalHost(launchArgs);
      details.launcherReused = /"edit-host" reused/.test(server.output());
      p = await openPage();
      const after = await records();
      details.conversations = after.site?.conversations?.length;
      details.conversationsKept = JSON.stringify(after.site?.conversations) === JSON.stringify(before.site?.conversations);
      details.memoryKept = after.site?.memory?.revision === before.site?.memory?.revision && after.site?.memory?.body === before.site?.memory?.body;
      details.pagesKept = JSON.stringify(await snapshot(join(data, "compositions"))) === JSON.stringify(pages);
      details.stoppedRunKept = after.runs.at(-1)?.status === "stopped";
      await expect(p.locator('.cms-assistant-message[data-role="user"]').first()).toBeVisible({ timeout: 30_000 });
      await p.getByRole("button", { name: /^Memory/ }).click();
      await expect(p.getByRole("dialog", { name: /Site Memory/ }).getByRole("textbox")).toHaveValue(/gardener/i);
      await p.getByRole("dialog", { name: /Site Memory/ }).getByRole("button", { name: "Close" }).click();
      if (!details.launcherReused || !details.conversationsKept || !details.memoryKept || !details.pagesKept || !details.stoppedRunKept) throw new Error("State did not survive the restart.");
    });

    // 6. Out-of-scope request: no draft change, no page change, host source untouched.
    await step("out-of-scope", async details => {
      const drafts = await snapshot(join(data, "edit-drafts"));
      const pages = await snapshot(join(data, "compositions"));
      const source = await hostSource();
      await send(p, PROMPTS.outOfScope, replyTimeout);
      const run = (await records()).runs.at(-1);
      details.runStatus = run?.status;
      details.proposalEvents = run?.events?.filter((/** @type {any} */ event) => event.type === "proposal").length ?? null;
      details.draftUnchanged = JSON.stringify(await snapshot(join(data, "edit-drafts"))) === JSON.stringify(drafts);
      details.pagesUnchanged = JSON.stringify(await snapshot(join(data, "compositions"))) === JSON.stringify(pages);
      details.hostSourceUnchanged = JSON.stringify(await hostSource()) === JSON.stringify(source);
      if (!details.draftUnchanged || !details.pagesUnchanged || !details.hostSourceUnchanged) throw new Error("An out-of-scope request changed the draft, a page or host source.");
    });
    // 7. Bounded real-demo smoke journey in its own disposable host: one proposal,
    // Draft preview, Apply, restart, Undo. Judged by saved bytes, never wording.
    await step(`demo-smoke-${demo.host}`, async details => {
      await p.close();
      await server?.stop();
      server = undefined;
      const demoDir = join(temporary, `demo-${demo.host}`);
      const demoArgs = ["--host", demo.host, "--dir", demoDir, "--port", String(port), "--provider", provider, "--executable", executable, ...(options.model ? ["--model", options.model] : [])];
      const workspace = join(demoDir, `cms/compositions/workspace-v1-${demo.host}-assistant`);
      /** Saved Composition JSON and derived JSX, timestamps factored out. */
      const saved = async () => Object.fromEntries(await Promise.all((await readdir(workspace)).filter(name => name.endsWith(".composition.json") || name.endsWith(".tsx")).sort().map(async name => [name, (await readFile(join(workspace, name), "utf8")).replace(/"updatedAt": "[^"]+"/g, "")])));
      const owned = async () => JSON.stringify([await snapshot(join(demoDir, "cms/content")), await snapshot(join(demoDir, "cms/mappings"))]);
      server = await launchLocalHost(demoArgs);
      details.created = new RegExp(`"${demo.host}" created`).test(server.output());
      p = await openPage();
      await expect(frame(p, "Current").getByText(demo.find).first()).toBeVisible({ timeout: 120_000 });
      const before = await saved();
      const ownedBefore = await owned();
      await send(p, PROMPTS.demo, replyTimeout);
      const pending = p.locator(".cms-assistant-review .cms-assistant-count").first();
      await expect(pending).toBeVisible({ timeout: 10_000 });
      details.pendingChanges = Number(await pending.textContent());
      details.proposalLeftSavedFilesUntouched = JSON.stringify(await saved()) === JSON.stringify(before);
      await p.getByRole("button", { name: /^Draft/ }).click();
      await expect(frame(p, "Draft").getByText(demo.replace).first()).toBeVisible({ timeout: 60_000 });
      await expect(p.locator("#assistant-apply-state")).toContainText("rendered successfully", { timeout: 60_000 });
      details.previewRendered = true;
      await p.getByRole("button", { name: "Apply to Composer" }).click();
      await expect(p.getByRole("heading", { name: "Applied to Composer" })).toBeVisible({ timeout: 60_000 });
      const applied = await saved();
      const changed = Object.keys(applied).filter(name => applied[name] !== before[name]);
      details.appliedFiles = changed;
      details.appliedCarriesTarget = changed.length > 0 && changed.every(name => applied[name]?.includes(demo.replace));
      details.contentAndMappingUntouched = await owned() === ownedBefore;
      if (!details.created || !details.proposalLeftSavedFilesUntouched || !details.appliedCarriesTarget || !details.contentAndMappingUntouched) throw new Error("The demo proposal/Apply did not write exactly the requested change to saved JSON/JSX.");
      await p.close();
      await server.stop();
      server = await launchLocalHost(demoArgs);
      details.restartReused = new RegExp(`"${demo.host}" reused`).test(server.output());
      p = await openPage();
      await expect(frame(p, "Current").getByText(demo.replace).first()).toBeVisible({ timeout: 120_000 });
      details.restartKeptApplied = JSON.stringify(await saved()) === JSON.stringify(applied);
      let attempts = 0;
      for (;;) {
        attempts++;
        await p.getByRole("button", { name: "Undo apply" }).click();
        const outcome = await Promise.race([
          p.getByRole("heading", { name: "Undo committed" }).waitFor({ timeout: 60_000 }).then(() => "done"),
          p.locator(".cms-assistant-review [role=alert]").filter({ hasText: "Finish saving in every authoring tab" }).waitFor({ timeout: 60_000 }).then(() => "refused"),
        ]);
        if (outcome === "done" || attempts >= 2) break;
      }
      details.undoAttempts = attempts;
      await expect(p.getByRole("heading", { name: "Undo committed" })).toBeVisible();
      details.undoRestored = JSON.stringify(await saved()) === JSON.stringify(before);
      if (!details.restartReused || !details.restartKeptApplied || !details.undoRestored) throw new Error("The demo restart or Undo did not keep or restore the saved files.");
    });
    exitCode = steps.every(entry => entry.status === "pass") ? 0 : 1;
  }
  const runs = (await records()).runs;
  const run = runs.find(entry => entry.provider?.version) ?? runs.at(-1);
  identity = run?.provider ?? (providerStatus ? { provider, label: providerStatus.label, model: providerStatus.model ?? null, version: providerStatus.version ?? null } : null);
} catch (error) {
  steps.push({ name: "harness", status: "fail", durationMs: 0, details: {}, error: scrub(String(error instanceof Error ? error.stack ?? error.message : error)).slice(0, 4000) });
  log(`harness: FAIL — ${scrub(String(error instanceof Error ? error.message : error))}`);
  if (server) console.error(scrub(server.output()));
  exitCode = blockedReason ? 3 : 1;
} finally {
  await page?.close().catch(() => {});
  await server?.stop().catch(() => {});
  await browser?.close();
}

const version = String(identity?.version ?? providerStatus?.version ?? "unknown").replace(/[^A-Za-z0-9._-]+/g, "_");
const result = {
  label,
  evidence: dryRun ? "none: the CLI was a repository fake; replies come from fake-decide.mjs" : exitCode === 3 ? "none: the provider was unavailable, so no model call was made" : "real CLI inference through the person's normal sign-in",
  outcome: exitCode === 0 ? "pass" : exitCode === 3 ? "blocked" : "fail",
  ...(blockedReason ? { blockedReason } : {}),
  provider: { kind: provider, executable: basename(executable), identity },
  composer: { sha },
  ranAt: new Date().toISOString(),
  steps,
};
const file = await writeNumberedResult(outDir, `${provider}-${version}-${sha.slice(0, 8)}`, result);
if (options.keep) log(`kept disposable host at ${dir}`);
else await rm(temporary, { recursive: true, force: true });
log(`${result.outcome} (${label}); result: ${relative(repo, file)}`);
process.exitCode = exitCode;
