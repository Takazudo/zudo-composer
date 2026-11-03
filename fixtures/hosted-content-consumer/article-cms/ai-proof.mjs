/* global window, document */
// Article CMS Content-AI acceptance in a real browser: the host admin, the loopback HTTP host, SQLite and the
// offline fake provider. Lost responses are real dropped connections followed by a host restart on the same port.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createContentAiProvider } from "zudo-composer/hosted-content/node";
import { articleRef } from "./article-data.mjs";
import { startArticleCms } from "./server.mjs";

const welcome = articleRef("welcome");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });

export async function runArticleAiBrowserProof({ directory, artifacts } = {}) {
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "article-ai-browser-"));
  const evidence = { node: process.version, checks: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  const fake = await createContentAiProvider({ provider: "fake" });
  let host = await startArticleCms({ directory: root, ai: { provider: fake } });
  const port = Number(new URL(host.url).port);
  const restart = async (provider = fake) => { await host.close(); host = await startArticleCms({ directory: root, port, ai: { provider } }); };
  const api = async (path, payload) => {
    const response = await fetch(`${host.url}${path}`, payload === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.message), { code: body.code, status: response.status });
    return body;
  };
  const q = value => encodeURIComponent(JSON.stringify(value));
  const working = async () => (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
  const published = async () => (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values;
  const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
  const save = async (operationKey, values) => api("/api/execute", { kind: "set-fields", operationKey, expected: identities(await api("/api/state")), entry: welcome, values, clear: [] });
  let browser, context, page, failed = false;
  const errors = [];
  try {
    // 1–2. Publish A, then save B.
    await save("browser-ai-a", { title: "Article A" });
    const state = await api("/api/state");
    const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: "browser-ai-capture", expected: identities(state) })).snapshot;
    await api("/api/execute", { kind: "begin-publication", operationKey: "browser-ai-submit", expected: identities(state), snapshotId: snapshot.id });
    await host.settled();
    await save("browser-ai-b", { title: "Article B" });

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const titleInput = page.getByRole("textbox", { name: "Title" });
    const instruction = page.getByRole("textbox", { name: "Instruction" });
    const proposalIn = phase => page.locator(`.article-ai-proposal[data-ai-phase="${phase}"]`);
    const candidateFrame = page.frameLocator("iframe.article-candidate-preview");
    const editorPhase = text => page.locator(".hosted-content-editor > p[role=status]").filter({ hasText: text }).waitFor();
    const open = async () => { await page.locator('[data-entry-id="welcome"]').click(); await titleInput.waitFor(); await page.locator("section.article-ai").waitFor(); };
    await page.goto(`${host.url}/`);
    await open();
    check("the admin shows the AI panel with the configured provider", (await page.locator("section.article-ai").textContent()).includes(fake.label)
      && await page.locator("[data-ai-inference]").count() === 0);

    // 3–4. Prepare C; the candidate renders as the real article page; Apply waits for that render.
    const before = await history();
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 1200; });
    await instruction.fill("tighter");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("rendering").waitFor();
    check("Apply stays unavailable while the candidate is rendering", await page.getByRole("button", { name: "Apply proposal" }).isDisabled());
    await proposalIn("ready").waitFor();
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 0; });
    check("the candidate is rendered with the article renderer", await candidateFrame.locator('article[data-article="welcome"] h2', { hasText: "Article B — tighter" }).count() === 1);
    check("the proposal shows title and body differences", (await page.locator('.article-ai-proposal tr[data-field]').evaluateAll(rows => rows.map(row => row.dataset.field))).join() === "title,body");
    check("4. working B, published A and history are unchanged while reviewing", (await working()).title === "Article B" && (await published()).title === "Article A"
      && JSON.stringify(await history()) === JSON.stringify(before));

    // An unsaved edit blocks AI actions without losing the edit or the instruction; saving makes the proposal stale.
    await titleInput.fill("Article B2");
    await page.locator('[data-ai-blocked="editor"]').waitFor();
    check("unsaved edits block Apply and keep both the edit and the instruction", await page.getByRole("button", { name: "Apply proposal" }).isDisabled()
      && (await titleInput.inputValue()) === "Article B2" && (await instruction.inputValue()) === "tighter");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await editorPhase("Saved");
    await proposalIn("stale").waitFor();
    const staleId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    const staleRender = await api(`/api/ai/candidate?id=${staleId}`);
    const staleApply = await api("/api/ai", { operation: "content-ai-apply", payload: { proposalId: staleId, renderedCandidate: staleRender.identity } });
    check("a human save after the proposal makes Apply stale, in the UI and at the host", await page.getByRole("button", { name: "Apply proposal" }).isDisabled()
      && staleApply.error?.code === "revision-conflict" && (await working()).title === "Article B2");

    // 5–8. Apply C; the response is lost and the host stops; after a restart and reload the operation is recovered.
    await page.getByRole("button", { name: "Prepare again" }).click();
    await proposalIn("ready").waitFor();
    const proposalId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    const reviewed = (await history()).length;
    Object.assign(host.faults, { dropAiResponse: "content-ai-apply", haltAfterDrop: true });
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await page.getByRole("alert").filter({ hasText: "The host is unreachable" }).waitFor();
    check("6. a lost Apply response is kept as pending, not reported as applied or failed", await page.locator('.article-ai-proposal[data-ai-phase="applied"]').count() === 0
      && await page.evaluate(() => Object.entries(window.localStorage).some(([key, value]) => key.startsWith("article-cms:content-ai:") && JSON.parse(value).pending === "apply")));
    await restart();
    await page.reload();
    await open();
    await proposalIn("applied").waitFor();
    const afterApply = await history();
    check("7. after the restart and reload the same Apply is recovered once", afterApply.length === reviewed + 1 && afterApply.filter(revision => revision.operation.key === `content-ai:${proposalId}`).length === 1
      && afterApply[0].source === "content-ai" && (await page.locator(".article-ai-proposal [role=status]").textContent()).includes("recovered"));
    check("5. the applied C is one edit in the shared history and the editor shows it", (await titleInput.inputValue()) === "Article B2 — tighter"
      && await page.locator(`.article-history li[data-revision="${afterApply[0].id}"]`).count() === 1 && (await published()).title === "Article A");
    await page.reload(); await open(); await proposalIn("applied").waitFor();
    check("8. a later reload shows the applied result from the host", (await history()).length === afterApply.length);

    // 9–10. Undo, with the same lost response and restart: B is back as one new revision.
    Object.assign(host.faults, { dropAiResponse: "content-ai-undo", haltAfterDrop: true });
    await page.getByRole("button", { name: "Undo AI change" }).click();
    await page.getByRole("alert").filter({ hasText: "The host is unreachable" }).waitFor();
    await restart();
    await page.reload(); await open();
    await proposalIn("undone").waitFor();
    const afterUndo = await history();
    check("9–10. Undo is recovered once and restores B2 as a new revision", afterUndo.length === afterApply.length + 1 && afterUndo[0].operation.kind === "restore-revision"
      && afterUndo[0].values.title === "Article B2" && (await titleInput.inputValue()) === "Article B2");

    // Switching Articles during a slow render leaves no approval behind; returning renders again.
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 1500; });
    await instruction.fill("switch");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("rendering").waitFor();
    await page.locator('[data-entry-id="release-notes"]').click();
    await page.waitForFunction(() => window.articleCms.selected?.recordId === "release-notes");
    await page.waitForTimeout(2_000);
    check("an Article switch supersedes the slow candidate render", await page.evaluate(() => document.querySelector("iframe.article-candidate-preview").dataset.previewState) !== "rendered"
      && await page.locator(".article-ai-proposal").count() === 0);
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 0; });
    await open();
    await proposalIn("ready").waitFor();

    // A reload never restores an earlier approval: Apply waits for a new render, delayed here at the transport.
    await page.route("**/api/ai/candidate*", async route => { await new Promise(done => setTimeout(done, 1500)); await route.continue(); });
    await page.reload(); await open();
    await proposalIn("rendering").waitFor();
    check("after a reload Apply needs a new render", await page.getByRole("button", { name: "Apply proposal" }).isDisabled());
    await proposalIn("ready").waitFor();
    await page.unroute("**/api/ai/candidate*");

    // A human edit after Apply is never overwritten by a fresh Undo.
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await proposalIn("applied").waitFor();
    await titleInput.fill("Human title after AI");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await editorPhase("Saved");
    await page.getByRole("button", { name: "Undo AI change" }).click();
    await page.getByRole("alert").filter({ hasText: "Not undone" }).waitFor();
    check("Undo after a human edit is refused and the human edit is kept", (await working()).title === "Human title after AI" && (await titleInput.inputValue()) === "Human title after AI");
    check("manual and AI edits share one history", (await history()).slice(0, 3).map(revision => revision.source).join() === "article-admin,content-ai,content-ai");

    // The provider stops being usable: no new proposals, but saved results and history remain visible.
    await restart(await createContentAiProvider({ provider: "claude-cli", executable: "/nonexistent/claude-for-content-ai" }));
    await page.reload(); await open();
    await page.locator('[data-ai-inference="not-installed"]').waitFor();
    await proposalIn("applied").waitFor();
    check("an unavailable provider disables Prepare and keeps the applied result and history visible", await page.getByRole("button", { name: "Prepare proposal" }).isDisabled()
      && await page.locator(".article-history li").count() === (await history()).length);
    check("no page errors", errors.length === 0);
    evidence.revisions = (await history()).length;
    return evidence;
  } catch (error) {
    failed = true;
    if (artifacts) {
      await mkdir(artifacts, { recursive: true });
      await page?.screenshot({ path: join(artifacts, "article-ai-failure.png"), fullPage: true }).catch(() => {});
      await writeFile(join(artifacts, "article-ai-host.log"), `${host.output()}\n\npage errors:\n${errors.join("\n")}\n`);
    }
    console.error(`host log:\n${host.output()}`);
    throw error;
  } finally {
    if (context) await context.tracing.stop(failed && artifacts ? { path: join(artifacts, "article-ai-trace.zip") } : {}).catch(() => {});
    await browser?.close();
    await host.close();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runArticleAiBrowserProof({ directory: process.argv[2], artifacts: process.argv[3] ?? process.env.ARTICLE_AI_PROOF_ARTIFACTS });
  console.log(JSON.stringify({ proof: "article-cms-ai-browser", checks: evidence.checks.length, revisions: evidence.revisions, node: evidence.node }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
