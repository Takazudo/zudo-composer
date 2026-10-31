/* global window */
// Content-AI across provider switches through the documented launcher: each phase starts
// `node article-cms/server.mjs --data <dir> --ai <mode>` as its own process on one data directory and one
// browser origin. Off disables new inference only; saved proposals, guarded Apply/Undo and recovery remain.
// Fake `claude`/`codex` executables first on PATH record any provider process the host might start.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { articleRef } from "./article-data.mjs";

const consumer = dirname(import.meta.dirname);
const welcome = articleRef("welcome");
const freePort = () => new Promise((ready, reject) => {
  const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => ready(port)); });
});

export async function runArticleAiLauncherProof({ directory, artifacts } = {}) {
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "article-ai-launcher-"));
  const data = join(root, "data"), fakeBin = join(root, "bin"), spawnLog = join(root, "provider-spawns.log");
  await rm(data, { recursive: true, force: true });
  await mkdir(fakeBin, { recursive: true });
  for (const name of ["claude", "codex"]) {
    await writeFile(join(fakeBin, name), `#!/bin/sh\necho "${name} $*" >> "${spawnLog}"\nexit 1\n`);
    await chmod(join(fakeBin, name), 0o755);
  }
  await writeFile(spawnLog, "");
  const evidence = { node: process.version, checks: [], phases: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  /** @type {import("node:child_process").ChildProcess | null} */ let child = null;
  let output = "";

  async function launch(mode) {
    const started = spawn(process.execPath, [join(consumer, "article-cms/server.mjs"), "--data", data, "--ai", mode, "--port", String(port)],
      { cwd: consumer, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] });
    child = started;
    let banner = "";
    await new Promise((ready, reject) => {
      const timer = setTimeout(() => reject(new Error(`--ai ${mode} did not start:\n${banner}`)), 30_000);
      const read = chunk => { banner += chunk; output += chunk; if (banner.includes("Press Ctrl+C")) { clearTimeout(timer); ready(); } };
      started.stdout.on("data", read); started.stderr.on("data", read);
      started.once("exit", code => { clearTimeout(timer); reject(new Error(`--ai ${mode} exited with ${code}:\n${banner}`)); });
    });
    evidence.phases.push({ mode, banner: banner.split("\n").filter(line => line.startsWith("Content-AI:")).join("") });
    return banner;
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(done => child.once("exit", done));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise(done => setTimeout(done, 10_000))]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
    child = null;
  }
  const api = async (path, payload) => {
    const response = await fetch(`${origin}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message), { code: body.code, status: response.status });
    return body;
  };
  const q = value => encodeURIComponent(JSON.stringify(value));
  const working = async () => (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
  const published = async () => (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values;
  const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
  const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
  /** Durable rows, read directly from the stopped host's database. */
  const rows = () => {
    const database = new DatabaseSync(join(data, "articles.sqlite"), { readOnly: true });
    try {
      const count = table => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      return { proposals: count("article_content_ai_proposal"), receipts: count("hosted_receipt"), revisions: count("hosted_revision") };
    } finally { database.close(); }
  };

  let browser, context, page, failed = false;
  const errors = [];
  try {
    // 1. A fresh dedicated directory with the offline fake provider; publish A, then save B.
    await launch("fake");
    await api("/api/execute", { kind: "set-fields", operationKey: "launcher-a", expected: identities(await api("/api/state")), entry: welcome, values: { title: "Article A" }, clear: [] });
    const state = await api("/api/state");
    const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: "launcher-capture", expected: identities(state) })).snapshot;
    await api("/api/execute", { kind: "begin-publication", operationKey: "launcher-submit", expected: identities(state), snapshotId: snapshot.id });
    for (let i = 0; i < 100 && (await published()).title !== "Article A"; i++) await new Promise(done => setTimeout(done, 100));
    await api("/api/execute", { kind: "set-fields", operationKey: "launcher-b", expected: identities(await api("/api/state")), entry: welcome, values: { title: "Article B" }, clear: [] });

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const titleInput = page.getByRole("textbox", { name: "Title" });
    const proposalIn = phase => page.locator(`.article-ai-proposal[data-ai-phase="${phase}"]`);
    const prepareButton = page.getByRole("button", { name: /^Prepare/ });
    const open = async () => { await page.locator('[data-entry-id="welcome"]').click(); await titleInput.waitFor(); await page.locator("section.article-ai").waitFor(); };
    const reload = async () => { await page.goto(`${origin}/`); await open(); };
    await reload();

    // 2. Prepare a proposal and explicitly Apply it after the candidate has rendered.
    await page.getByRole("textbox", { name: "Instruction" }).fill("tighter");
    await prepareButton.click();
    await proposalIn("ready").waitFor();
    const proposalId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await proposalIn("applied").waitFor();
    const applied = { working: await working(), published: await published(), history: await history() };
    check("2. with --ai fake a proposal is prepared, rendered and explicitly applied as one revision", applied.working.title === "Article B — tighter"
      && applied.history[0].operation.key === `content-ai:${proposalId}` && applied.published.title === "Article A");

    // 3–4. Stop that process; restart the same directory and origin with --ai off.
    await stop();
    const afterFake = rows();
    const offBanner = await launch("off");
    check("4. --ai off starts on the same directory and says what stays available", /Content-AI: off — no new proposals; saved proposals, their Apply\/Undo and recovery stay available/.test(offBanner));
    const offStatus = await api("/api/ai", { operation: "content-ai-status", payload: {} });
    check("off reports explicit inference-off status, not a missing endpoint", offStatus.ok && offStatus.value.configured === true
      && offStatus.value.inference.state === "unavailable" && offStatus.value.inference.code === "off" && offStatus.value.canApply === true);

    // 5–6. The saved proposal and its Apply result are read back; nothing was reset or duplicated.
    const read = await api("/api/ai", { operation: "content-ai-read", payload: { proposalId } });
    const recoveredApply = await api("/api/ai", { operation: "content-ai-apply", payload: { proposalId } });
    check("5. off mode reads the saved proposal and recovers the original Apply receipt", read.ok && read.value.proposal.id === proposalId
      && read.value.applied?.revisionId === applied.history[0].id && recoveredApply.ok && recoveredApply.value.recovered === true
      && recoveredApply.value.receipt.revisionId === applied.history[0].id);
    const offHistory = await history();
    check("6. Content, published values and history are not reset or duplicated by the provider change", JSON.stringify(offHistory) === JSON.stringify(applied.history)
      && (await working()).title === applied.working.title && (await published()).title === "Article A");
    await reload();
    await proposalIn("applied").waitFor();
    await page.locator('[data-ai-inference="off"]').waitFor();
    check("the browser shows the applied result and an off notice, not an endpoint error", await page.locator(".article-ai-error").count() === 0
      && await prepareButton.isDisabled() && await page.locator(`.article-history li[data-revision="${applied.history[0].id}"]`).count() === 1);

    // 8. New Prepare is refused without a provider; no provider process, probe or model call happens.
    const offPrepare = await api("/api/ai", { operation: "content-ai-prepare", payload: { entry: welcome, instruction: "anything" } });
    check("8. new Prepare is unavailable in off mode", offPrepare.ok === false && offPrepare.error.code === "unavailable" && (await history()).length === offHistory.length);

    // 7. Guarded Undo without inference; its answer is lost after the host commits it.
    await page.route("**/api/ai", async route => {
      if (JSON.parse(route.request().postData() ?? "{}").operation !== "content-ai-undo") { await route.continue(); return; }
      await route.fetch(); await route.abort("connectionreset");
    });
    await page.getByRole("button", { name: "Undo AI change" }).click();
    await proposalIn("undone").waitFor();
    await page.unroute("**/api/ai");
    const afterUndo = await history();
    check("7. off mode performs the explicit guarded Undo and recovers its lost answer by reading", afterUndo.length === offHistory.length + 1
      && afterUndo[0].operation.kind === "restore-revision" && (await working()).title === "Article B"
      && (await page.locator(".article-ai-proposal [role=status]").textContent()).includes("recovered"));
    await stop();
    await launch("off");
    await reload();
    await proposalIn("undone").waitFor();
    const undoAgain = await api("/api/ai", { operation: "content-ai-undo", payload: { proposalId } });
    check("7. after a restart the Undo result is recovered without a duplicate revision", undoAgain.ok && undoAgain.value.recovered === true
      && (await history()).length === afterUndo.length);

    // A stale pending pointer for an operation that committed long ago settles on read.
    await page.evaluate(([key, id]) => window.localStorage.setItem(key, JSON.stringify({ proposalId: id, pending: "apply" })), ["article-cms:content-ai:articles/article/welcome", proposalId]);
    await reload();
    await proposalIn("undone").waitFor();
    check("a settled pointer whose operation committed long ago is reconciled, not left uncertain", await page.locator("[data-ai-uncertain]").count() === 0);

    check("8. no provider process ran in any off phase", (await readFile(spawnLog, "utf8")) === "");
    await stop();
    const afterOff = rows();
    check("off mode added no proposal and exactly one revision and receipt (the Undo)", afterOff.proposals === afterFake.proposals
      && afterOff.revisions === afterFake.revisions + 1 && afterOff.receipts === afterFake.receipts + 1);

    // 9. Back to --ai fake: normal operation continues on the same data.
    await launch("fake");
    await reload();
    await proposalIn("undone").waitFor();
    await page.getByRole("textbox", { name: "Instruction" }).fill("again");
    await prepareButton.click();
    await proposalIn("ready").waitFor();
    const secondId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");

    // An Apply whose request never reaches the host stays uncertain after a successful read without a receipt.
    await page.route("**/api/ai", async route => {
      if (JSON.parse(route.request().postData() ?? "{}").operation === "content-ai-apply") { await route.abort("connectionreset"); return; }
      await route.continue();
    });
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await page.locator('[data-ai-uncertain="apply"]').waitFor();
    check("a lost Apply with no receipt on read stays pending and is not reported as applied or failed", await proposalIn("applied").count() === 0
      && await page.evaluate(id => Object.values(window.localStorage).some(value => { const pointer = JSON.parse(value); return pointer.proposalId === id && pointer.pending === "apply"; }), secondId));
    await page.unroute("**/api/ai");
    await reload();
    await page.locator('[data-ai-uncertain="apply"]').waitFor();
    check("the pending pointer survives a reload without resending", (await history()).length === afterUndo.length);
    await proposalIn("ready").waitFor();
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await proposalIn("applied").waitFor();
    const final = await history();
    check("9. after returning to --ai fake a new proposal applies once as a new revision", final.length === afterUndo.length + 1
      && final[0].operation.key === `content-ai:${secondId}` && await page.locator("[data-ai-uncertain]").count() === 0);
    check("no page errors", errors.length === 0);
    await stop();
    evidence.revisions = final.length;
    return evidence;
  } catch (error) {
    failed = true;
    if (artifacts) {
      await mkdir(artifacts, { recursive: true });
      await page?.screenshot({ path: join(artifacts, "article-ai-launcher-failure.png"), fullPage: true }).catch(() => {});
      await writeFile(join(artifacts, "article-ai-launcher-host.log"), `${output}\n\npage errors:\n${errors.join("\n")}\n`);
    }
    console.error(`host output:\n${output}`);
    throw error;
  } finally {
    if (context) await context.tracing.stop(failed && artifacts ? { path: join(artifacts, "article-ai-launcher-trace.zip") } : {}).catch(() => {});
    await browser?.close();
    await stop();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runArticleAiLauncherProof({ directory: process.argv[2], artifacts: process.argv[3] });
  console.log(JSON.stringify({ proof: "article-cms-ai-launcher", checks: evidence.checks.length, revisions: evidence.revisions, phases: evidence.phases, node: evidence.node }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
