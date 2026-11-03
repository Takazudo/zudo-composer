/* global window, document */
// The same observable Article scenario against the Node/SQLite host and the Worker/local-D1 host, in a real
// browser. Lost acknowledgements are real dropped connections after the host committed, followed by a host or
// runtime restart on the same data. The fake provider is a deterministic test provider, never model evidence.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createContentAiProvider } from "zudo-composer/hosted-content/node";
import { localRuntimeVersions } from "../d1-runtime.mjs";
import { articleRef } from "./article-data.mjs";
import { startArticleCms } from "./server.mjs";
import { startWorkerArticleCms } from "./worker-host.mjs";

const welcome = articleRef("welcome");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const tokens = { second: "second-editor-session-token", reviewer: "reviewer-session-token-0001", foreignSite: "foreign-site-session-token-01" };
const sessions = (secondRole = "write") => ({
  [tokens.second]: { actorId: "second-editor", role: secondRole, siteId: "article-cms" },
  [tokens.reviewer]: { actorId: "article-reviewer", role: "propose", siteId: "article-cms" },
  [tokens.foreignSite]: { actorId: "second-editor", role: "write", siteId: "another-site" },
});

/** Each backend: start/restart on one data directory and port, plus a read-only proposal counter for evidence. */
export const backends = {
  "node-sqlite": {
    label: "Node + SQLite",
    async start({ directory, port, ai, secondRole }) {
      const provider = ai === "off" ? null : await createContentAiProvider({ provider: "fake" });
      // The Node host has no per-session site; a foreign-site token is simply not one of its sessions.
      const own = Object.fromEntries(Object.entries(sessions(secondRole)).filter(([token]) => token !== tokens.foreignSite));
      const host = await startArticleCms({ directory, port, ai: provider ? { provider } : null, sessions: own });
      return Object.assign(host, { persistence: host.database, proposals: async () => {
        const connection = new DatabaseSync(host.database, { readOnly: true });
        try { return connection.prepare("SELECT count(*) AS n FROM article_content_ai_proposal").get().n; } finally { connection.close(); }
      } });
    },
  },
  "worker-d1": {
    label: "Worker + local D1",
    async start({ directory, port, ai, secondRole }) {
      const host = await startWorkerArticleCms({ directory, port, ai, sessions: sessions(secondRole) });
      return Object.assign(host, { persistence: host.persist, proposals: async () => (await (await host.database()).prepare("SELECT count(*) AS n FROM content_ai_proposal").first()).n });
    },
  },
};

export async function runArticleJourney({ backend, directory, artifacts }) {
  const definition = backends[backend];
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), `article-journey-${backend}-`));
  const evidence = { backend, label: definition.label, checks: [], observations: {}, restarts: [] };
  const check = (name, condition) => { assert.ok(condition, `${backend}: ${name}`); evidence.checks.push(name); };
  const observe = (step, value) => { evidence.observations[step] = value; };
  let host = await definition.start({ directory: root, port: 0, ai: "fake" });
  const port = Number(new URL(host.url).port);
  evidence.persistence = host.persistence;
  const restart = async ({ ai = "fake", secondRole = "write", reason }) => {
    await host.close();
    host = await definition.start({ directory: root, port, ai, secondRole });
    evidence.restarts.push({ reason, ai, persistence: host.persistence });
  };
  const request = async (path, { body, token, headers = {} } = {}) => {
    const response = await fetch(`${host.url}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const api = async (path, body, token) => {
    const { status, body: value } = await request(path, { body, token });
    if (status !== 200) throw Object.assign(new Error(value.message), { code: value.code, status });
    return value;
  };
  const ai = (operation, payload, token) => request("/api/ai", { body: { operation, payload }, token }).then(({ body }) => body);
  const q = value => encodeURIComponent(JSON.stringify(value));
  const working = async () => (await api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`)).values;
  const published = async () => (await api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`)).values;
  const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
  const shape = revisions => revisions.map(revision => ({ kind: revision.operation.kind, source: revision.source, title: revision.values.title, actor: revision.actor?.id ?? null }));
  const save = async (operationKey, values) => api("/api/execute", { kind: "set-fields", operationKey, expected: identities(await api("/api/state")), entry: welcome, values, clear: [] });
  const publishNow = async key => {
    const state = await api("/api/state");
    const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: `${key}-capture`, expected: identities(state) })).snapshot;
    const submitted = await api("/api/execute", { kind: "begin-publication", operationKey: `${key}-submit`, expected: identities(state), snapshotId: snapshot.id });
    return { snapshot, publication: submitted.publication };
  };
  let browser, context, second, page, failed = false;
  const errors = [];
  try {
    // 1–2. Publish A, then save B: published stays A.
    await save("journey-a", { title: "Article A" });
    const first = await publishNow("journey-publish-a");
    await host.settled();
    await save("journey-b", { title: "Article B" });
    const status = await api("/api/publication-status");
    check("1–2. published A, working B, artifact recorded and nothing deployed", (await published()).title === "Article A" && (await working()).title === "Article B"
      && status.submission.status === "integrated" && status.artifact === first.publication.id && status.deployed === false);
    const artifact = await fetch(`${host.url}/artifacts/${status.artifact}/`).then(response => response.text());
    check("the local artifact renders A", artifact.includes("Article A") && !artifact.includes("Article B"));
    observe("1-2", { working: (await working()).title, published: (await published()).title, deployed: status.deployed, history: shape(await history()) });

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
    const open = async (target = page) => { await target.locator('[data-entry-id="welcome"]').click(); await target.getByRole("textbox", { name: "Title" }).waitFor(); await target.locator("section.article-ai").waitFor(); };
    await page.goto(`${host.url}/`);
    await open();
    check("the admin header names the active backend and local-only status", (await page.locator(`.article-backend[data-backend="${backend}"]`).textContent()).includes(definition.label)
      && (await page.locator(".article-local").textContent()).includes("Local only"));

    // 3–4. Prepare C with the fake provider; it renders through the real Article renderer; nothing is saved.
    const before = await history();
    const proposalsBefore = await host.proposals();
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 1200; });
    await instruction.fill("tighter");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("rendering").waitFor();
    check("a delayed candidate render does not authorize Apply", await page.getByRole("button", { name: "Apply proposal" }).isDisabled());
    await proposalIn("ready").waitFor();
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 0; });
    check("3. one proposal was prepared (one fake-provider call)", (await host.proposals()) === proposalsBefore + 1);
    check("4. the candidate C renders through the Article renderer", await candidateFrame.locator('article[data-article="welcome"] h2', { hasText: "Article B — tighter" }).count() === 1);
    check("4. working B, published A and history are unchanged while reviewing", (await working()).title === "Article B" && (await published()).title === "Article A"
      && JSON.stringify(await history()) === JSON.stringify(before));
    observe("3-4", { candidate: "Article B — tighter", working: (await working()).title, published: (await published()).title, historyUnchanged: true });

    // A failed candidate render does not authorize Apply.
    await page.route("**/api/ai/candidate*", route => route.abort());
    await page.reload(); await open();
    await proposalIn("render-failed").waitFor();
    check("a failed candidate render does not authorize Apply", await page.getByRole("button", { name: "Apply proposal" }).isDisabled());
    await page.unroute("**/api/ai/candidate*");

    // A human edit after Prepare makes Apply stale, in the UI and at the host.
    await page.reload(); await open(); await proposalIn("ready").waitFor();
    await titleInput.fill("Article B2");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await editorPhase("Saved");
    await proposalIn("stale").waitFor();
    const staleId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    const staleRender = await api(`/api/ai/candidate?id=${staleId}`);
    const staleApply = await ai("content-ai-apply", { proposalId: staleId, renderedCandidate: staleRender.identity });
    check("a human edit after Prepare makes Apply stale", await page.getByRole("button", { name: "Apply proposal" }).isDisabled()
      && staleApply.error?.code === "revision-conflict" && (await working()).title === "Article B2");

    // 5–8. Apply C; the acknowledgement is lost after commit and the host stops; restart, reload, recover once.
    await instruction.fill("tighter");
    await page.getByRole("button", { name: "Prepare again" }).click();
    await proposalIn("ready").waitFor();
    const proposalId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    const reviewed = (await history()).length;
    const proposalsAtApply = await host.proposals();
    Object.assign(host.faults, { dropAiResponse: "content-ai-apply", haltAfterDrop: true });
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await page.getByRole("alert").filter({ hasText: "The host is unreachable" }).waitFor();
    check("6. a lost Apply acknowledgement stays pending, not applied or failed", await page.locator('.article-ai-proposal[data-ai-phase="applied"]').count() === 0
      && await page.evaluate(() => Object.entries(window.localStorage).some(([key, value]) => key.startsWith("article-cms:content-ai:") && JSON.parse(value).pending === "apply")));
    await restart({ reason: "after lost Apply acknowledgement" });
    await page.reload(); await open();
    await proposalIn("applied").waitFor();
    const afterApply = await history();
    check("7–8. after restart and reload the original Apply is recovered once", afterApply.length === reviewed + 1
      && afterApply.filter(revision => revision.operation.key === `content-ai:${proposalId}`).length === 1 && afterApply[0].source === "content-ai"
      && (await page.locator(".article-ai-proposal [role=status]").textContent()).includes("recovered"));
    check("8. recovery made no model call", (await host.proposals()) === proposalsAtApply);
    check("5. applied C is one edit and published stays A", (await titleInput.inputValue()) === "Article B2 — tighter" && (await published()).title === "Article A");
    observe("5-8", { working: (await working()).title, published: (await published()).title, history: shape(afterApply) });

    // 9–10. Undo to B2 as a new revision; lose that acknowledgement, restart again and recover.
    Object.assign(host.faults, { dropAiResponse: "content-ai-undo", haltAfterDrop: true });
    await page.getByRole("button", { name: "Undo AI change" }).click();
    await page.getByRole("alert").filter({ hasText: "The host is unreachable" }).waitFor();
    await restart({ reason: "after lost Undo acknowledgement" });
    await page.reload(); await open();
    await proposalIn("undone").waitFor();
    const afterUndo = await history();
    check("9–10. Undo is recovered once and restores B2 as a new revision", afterUndo.length === afterApply.length + 1 && afterUndo[0].operation.kind === "restore-revision"
      && afterUndo[0].values.title === "Article B2" && (await titleInput.inputValue()) === "Article B2");
    observe("9-10", { working: (await working()).title, history: shape(afterUndo) });

    // 11. Inference off: saved operations and history stay; no new proposals.
    await restart({ ai: "off", reason: "inference off" });
    await page.reload(); await open();
    await page.locator('[data-ai-inference="off"]').waitFor();
    await proposalIn("undone").waitFor();
    check("11. with inference off the saved operation and history remain and Prepare is disabled", await page.getByRole("button", { name: "Prepare proposal" }).isDisabled()
      && (await history()).length === afterUndo.length && (await ai("content-ai-read", { proposalId })).value?.undone?.revisionId === afterUndo[0].id);
    observe("11", { inference: "off", history: shape(await history()) });

    // 12. Fake inference again, without resetting data.
    await restart({ reason: "fake inference re-enabled" });
    await page.reload(); await open();
    check("12. re-enabling fake inference keeps every revision", (await history()).length === afterUndo.length && (await working()).title === "Article B2");
    await instruction.fill("again");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("ready").waitFor();

    // A superseded render: switching Articles mid-render leaves no approval behind.
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 1500; });
    await instruction.fill("again");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("rendering").waitFor();
    await page.locator('[data-entry-id="release-notes"]').click();
    await page.waitForFunction(() => window.articleCms.selected?.recordId === "release-notes");
    await page.waitForTimeout(2_000);
    check("a superseded candidate render does not authorize Apply", await page.evaluate(() => document.querySelector("iframe.article-candidate-preview").dataset.previewState) !== "rendered"
      && await page.locator(".article-ai-proposal").count() === 0);
    await page.evaluate(() => { window.articleCms.candidateFrame.delayMs = 0; });
    await open(); await proposalIn("ready").waitFor();

    // Two independent browser contexts: the second sees committed state and its human edit after Apply blocks Undo.
    await page.getByRole("button", { name: "Apply proposal" }).click();
    await proposalIn("applied").waitFor();
    second = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
    const other = await second.newPage();
    other.on("pageerror", error => errors.push(`second context: ${error.message}`));
    await other.goto(`${host.url}/`); await open(other);
    const otherTitle = other.getByRole("textbox", { name: "Title" });
    check("an independent browser context reads the applied value", (await otherTitle.inputValue()) === "Article B2 — again");
    await otherTitle.fill("Human title from the second context");
    await other.getByRole("button", { name: "Save", exact: true }).click();
    await other.locator(".hosted-content-editor > p[role=status]").filter({ hasText: "Saved" }).waitFor();
    await page.getByRole("button", { name: "Undo AI change" }).click();
    await page.getByRole("alert").filter({ hasText: "Not undone" }).waitFor();
    check("a human edit after Apply (another context) prevents destructive Undo", (await working()).title === "Human title from the second context");
    observe("contexts", { history: shape((await history()).slice(0, 3)) });

    // An unknown outcome stays pending: the Apply request never reaches the host, and a read finds no receipt.
    await page.reload(); await open();
    await titleInput.waitFor();
    await instruction.fill("unknown");
    await page.getByRole("button", { name: "Prepare proposal" }).click();
    await proposalIn("ready").waitFor();
    const unknownId = await page.locator(".article-ai-proposal").getAttribute("data-proposal-id");
    await page.route("**/api/ai", async route => { if (JSON.parse(route.request().postData() ?? "{}").operation === "content-ai-apply") await route.abort(); else await route.continue(); });
    await page.getByRole("button", { name: "Apply proposal" }).click();
    // The panel reads back what the host committed; with no receipt it keeps the Apply pending.
    await page.locator('[data-ai-uncertain="apply"]').waitFor();
    await page.unroute("**/api/ai");
    await page.reload(); await open();
    await page.locator('[data-ai-uncertain="apply"]').waitFor();
    check("an unknown outcome remains pending (Check again), not fabricated success or failure", await page.locator('.article-ai-proposal[data-ai-phase="applied"]').count() === 0
      && (await ai("content-ai-read", { proposalId: unknownId })).value?.applied === null);

    // Permission withdrawal: committed results stay readable/recoverable; fresh writes stop.
    const proposedBySecond = (await ai("content-ai-prepare", { entry: welcome, instruction: "before narrowing" }, tokens.second)).value.proposal;
    const secondIdentity = (await api(`/api/ai/candidate?id=${proposedBySecond.id}`, undefined, tokens.second)).identity;
    await ai("content-ai-apply", { proposalId: proposedBySecond.id, renderedCandidate: secondIdentity }, tokens.second);
    const pendingBySecond = (await ai("content-ai-prepare", { entry: welcome, instruction: "never applied" }, tokens.second)).value.proposal;
    const pendingIdentity = (await api(`/api/ai/candidate?id=${pendingBySecond.id}`, undefined, tokens.second)).identity;
    const beforeNarrowing = await history();
    await restart({ secondRole: "propose", reason: "write permission withdrawn" });
    check("after permission withdrawal the account reads and recovers its committed Apply", (await ai("content-ai-read", { proposalId: proposedBySecond.id }, tokens.second)).value?.applied?.revisionId === beforeNarrowing[0].id
      && (await ai("content-ai-apply", { proposalId: proposedBySecond.id }, tokens.second)).value?.recovered === true);
    check("after permission withdrawal fresh Apply, Undo and saves are refused and write nothing", (await ai("content-ai-apply", { proposalId: pendingBySecond.id, renderedCandidate: pendingIdentity }, tokens.second)).error?.code === "forbidden"
      && (await ai("content-ai-undo", { proposalId: proposedBySecond.id }, tokens.second)).error?.code === "forbidden"
      && (await request("/api/execute", { token: tokens.second, body: { kind: "set-fields", operationKey: "narrowed-write", expected: identities(await api("/api/state")), entry: welcome, values: { title: "x" }, clear: [] } })).status === 403
      && JSON.stringify(await history()) === JSON.stringify(beforeNarrowing));
    check("an unknown session is refused", (await request("/api/state", { token: "unknown-session-token-000" })).status === 401);
    check("another actor cannot read this account's proposal", (await ai("content-ai-read", { proposalId: unknownId }, tokens.second)).error?.code === "not-found");
    check("a session for another site is refused", (await request("/api/state", { token: tokens.foreignSite })).status === (backend === "worker-d1" ? 403 : 401));

    // A second explicit publication preserves the newer draft.
    const reviewedTitle = (await working()).title;
    const second2 = await publishNow("journey-publish-2");
    await save("journey-after-capture", { title: "Draft after the second capture" });
    await host.settled();
    const finalStatus = await api("/api/publication-status");
    check("a second publication activates its reviewed snapshot and keeps the newer draft", finalStatus.submission.publicationId === second2.publication.id && finalStatus.submission.status === "integrated"
      && (await published()).title === reviewedTitle && (await working()).title === "Draft after the second capture" && finalStatus.deployed === false);
    observe("publication-2", { published: (await published()).title, working: (await working()).title, deployed: finalStatus.deployed });
    check("no page errors", errors.length === 0);
    evidence.revisions = (await history()).length;
    return evidence;
  } catch (error) {
    failed = true;
    if (artifacts) {
      await mkdir(artifacts, { recursive: true });
      await page?.screenshot({ path: join(artifacts, `journey-${backend}-failure.png`), fullPage: true }).catch(() => {});
      await writeFile(join(artifacts, `journey-${backend}-host.log`), `${host.output()}\n\npage errors:\n${errors.join("\n")}\n`);
    }
    console.error(`host log (${backend}):\n${host.output()}`);
    throw error;
  } finally {
    if (context) await context.tracing.stop(failed && artifacts ? { path: join(artifacts, `journey-${backend}-trace.zip`) } : {}).catch(() => {});
    await second?.close().catch(() => {});
    await browser?.close();
    await host.close();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), "article-journey-")));
  const artifacts = process.argv[3] ? resolve(process.argv[3]) : join(base, "artifacts");
  const results = {};
  // Serial, each backend with its own persistent directory; no data is copied between them.
  for (const backend of Object.keys(backends)) results[backend] = await runArticleJourney({ backend, directory: join(base, backend), artifacts });
  const [node, worker] = [results["node-sqlite"], results["worker-d1"]];
  assert.deepEqual(worker.checks, node.checks, "both backends ran the same checks");
  assert.deepEqual(worker.observations, node.observations, "both backends show the same values, provenance and operation shapes");
  const report = { label: "Browser/HTTP journeys (fake provider; not model evidence)", runtime: await localRuntimeVersions(), node: process.version,
    backends: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, { checks: value.checks.length, revisions: value.revisions, persistence: value.persistence, restarts: value.restarts }])),
    equivalent: { checks: node.checks, observations: node.observations } };
  await writeFile(join(base, "journey-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ proof: "article-journey", backends: report.backends }, null, 2));
  for (const name of node.checks) console.log(`PASS both backends: ${name}`);
}
