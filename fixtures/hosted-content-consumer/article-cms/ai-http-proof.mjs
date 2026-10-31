// Article CMS Content-AI over the real loopback HTTP transport and SQLite, with the offline fake provider.
// Every request goes through the host's server: lost responses, restarts, delays, accounts, sites, restricted
// fields and an unavailable provider are exercised at the transport, not by calling the service in-process.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentAiProvider } from "zudo-composer/hosted-content/node";
import { articleIndex, articleRef } from "./article-data.mjs";
import { articleProposalOwner, openArticleProposalStore } from "./content-ai.mjs";
import { startArticleCms } from "./server.mjs";

const welcome = articleRef("welcome");
const identities = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const tokens = { second: "second-editor-session-0001", reviewer: "article-reviewer-session-01" };
const sessions = { [tokens.second]: { actorId: "second-editor", role: "write" }, [tokens.reviewer]: { actorId: "article-reviewer", role: "propose" } };

/** The fake provider with a call counter, so recovery can prove it never asked the model again. */
async function countingProvider(base) {
  const provider = base ?? await createContentAiProvider({ provider: "fake" });
  const counter = { calls: 0 };
  return { counter, provider: { ...provider, label: provider.label, inference: () => provider.inference(),
    proposer: { label: provider.proposer.label, propose: input => { counter.calls++; return provider.proposer.propose(input); } } } };
}

export async function runArticleAiHttpProof({ directory } = {}) {
  const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), "article-ai-http-"));
  const evidence = { node: process.version, checks: [] };
  const check = (name, condition) => { assert.ok(condition, name); evidence.checks.push(name); };
  const fake = await countingProvider();
  let host = await startArticleCms({ directory: root, ai: { provider: fake.provider }, sessions });
  const restart = async (ai = { provider: fake.provider }) => { await host.close(); host = await startArticleCms({ directory: root, ai, sessions }); };
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
  const value = async (operation, payload, token) => {
    const result = await ai(operation, payload, token);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  };
  const q = item => encodeURIComponent(JSON.stringify(item));
  const working = () => api(`/api/entry?q=${q({ perspective: "working", entry: welcome })}`);
  const published = () => api(`/api/entry?q=${q({ perspective: "published", entry: welcome })}`);
  const history = async () => (await api(`/api/revisions?q=${q({ entry: welcome, limit: 100 })}`)).revisions;
  const save = async (operationKey, values) => api("/api/execute", { kind: "set-fields", operationKey, expected: identities(await api("/api/state")), entry: welcome, values, clear: [] });
  const candidate = async (id, token) => { const { status, body } = await request(`/api/ai/candidate?id=${encodeURIComponent(id)}`, { token }); return { status, ...body }; };
  const rendered = async proposal => (await candidate(proposal.id)).identity;
  const proposed = async (instruction, token) => {
    const result = await value("content-ai-prepare", { entry: welcome, instruction }, token);
    assert.equal(result.status, "proposed");
    return result.proposal;
  };
  const lostResponse = async (operation, payload) => {
    host.faults.dropAiResponse = operation;
    return ai(operation, payload).then(() => "answered", error => error instanceof TypeError ? "lost" : `failed: ${error.message}`);
  };
  try {
    // 1. Publish A, then save B: working is B and published stays A.
    await save("ai-publish-a", { title: "Article A" });
    const state = await api("/api/state");
    const snapshot = (await api("/api/execute", { kind: "capture-snapshot", operationKey: "ai-capture-a", expected: identities(state) })).snapshot;
    await api("/api/execute", { kind: "begin-publication", operationKey: "ai-submit-a", expected: identities(state), snapshotId: snapshot.id });
    await host.settled();
    await save("ai-save-b", { title: "Article B" });
    check("1–2. published A and working B", (await published()).values.title === "Article A" && (await working()).values.title === "Article B");

    const status = await value("content-ai-status", {});
    check("status names the configured provider and whether inference is ready", status.configured && status.provider === fake.provider.label && status.inference.state === "ready" && status.canApply);
    check("status for a propose-only account says it cannot apply", (await value("content-ai-status", {}, tokens.reviewer)).canApply === false);

    // 3–4. Prepare C and review it rendered: nothing is written to Content or history.
    const before = await history();
    const proposal = await proposed("tighter");
    const preview = await candidate(proposal.id);
    check("3. the proposal is limited to title and body differences", proposal.differences.map(item => item.fieldId).join() === "title,body" && proposal.candidate.title === "Article B — tighter");
    check("4. the candidate is rendered by the host renderer from memory", preview.renderData.kind === "article-site-v1"
      && preview.renderData.articles.find(article => article.id === "welcome").title === "Article B — tighter" && preview.stale === false && preview.route === "journal");
    check("4. preparing and rendering leave working B, published A and history unchanged", (await working()).values.title === "Article B" && (await published()).values.title === "Article A"
      && JSON.stringify(await history()) === JSON.stringify(before));
    const rows = () => { const database = new DatabaseSync(host.database); try { return database.prepare("SELECT owner, actor_id FROM article_content_ai_proposal").all(); } finally { database.close(); } };
    check("4. only proposal metadata was stored, scoped to this site and account", rows().length === 1 && rows()[0].owner === articleProposalOwner("article-cms") && rows()[0].actor_id === "article-editor");
    check("a fresh Apply without a render is refused and writes nothing", (await ai("content-ai-apply", { proposalId: proposal.id })).error?.code === "invalid-request"
      && (await ai("content-ai-apply", { proposalId: proposal.id, renderedCandidate: "0".repeat(64) })).error?.code === "invalid-request" && (await history()).length === before.length);

    // 5–7. Apply; its response is lost and the host restarts; the same operation is recovered once.
    const calls = fake.counter.calls;
    check("5. the Apply response is lost after it ran", await lostResponse("content-ai-apply", { proposalId: proposal.id, renderedCandidate: preview.identity }) === "lost");
    await restart();
    const recovered = await value("content-ai-apply", { proposalId: proposal.id });
    const afterApply = await history();
    check("5. Apply stored C as one revision with AI provenance", afterApply.length === before.length + 1 && afterApply[0].source === "content-ai"
      && afterApply[0].actor?.id === "article-editor" && afterApply[0].values.title === "Article B — tighter" && afterApply[0].operation.key === proposal.operationKey);
    check("7. after a restart the retry recovers the same operation without a render", recovered.recovered === true && recovered.receipt.revisionId === afterApply[0].id);
    check("7. a second retry adds nothing", (await value("content-ai-apply", { proposalId: proposal.id })).recovered && (await history()).length === afterApply.length);
    check("8. reading the proposal back reports the committed Apply", (await value("content-ai-read", { proposalId: proposal.id })).applied?.revisionId === afterApply[0].id);
    check("Apply leaves the published A and unrelated fields alone", (await published()).values.title === "Article A" && (await working()).values.summary === before[0].values.summary);

    // 9–10. Undo restores B as a new revision; its lost response and restart do not duplicate it.
    check("9. the Undo response is lost after it ran", await lostResponse("content-ai-undo", { proposalId: proposal.id }) === "lost");
    await restart();
    const undone = await value("content-ai-undo", { proposalId: proposal.id });
    const afterUndo = await history();
    check("9. Undo saved B as a new revision", undone.recovered && afterUndo.length === afterApply.length + 1 && afterUndo[0].values.title === "Article B" && afterUndo[0].operation.kind === "restore-revision");
    check("10. a retried Undo after restart adds nothing", (await value("content-ai-undo", { proposalId: proposal.id })).recovered && (await history()).length === afterUndo.length);
    check("recovery, reads and retries never called the model", fake.counter.calls === calls);

    // A human edit after the proposal makes Apply stale; a human edit after Apply makes Undo refuse.
    const stale = await proposed("stale one");
    const staleIdentity = await rendered(stale);
    await save("human-after-proposal", { summary: "A human changed the summary." });
    check("a human edit after the proposal marks the candidate stale", (await candidate(stale.id)).stale === true);
    check("a stale Apply is refused and keeps the human edit", (await ai("content-ai-apply", { proposalId: stale.id, renderedCandidate: staleIdentity })).error?.code === "revision-conflict"
      && (await working()).values.summary === "A human changed the summary.");
    const applied = await proposed("applied then edited");
    await value("content-ai-apply", { proposalId: applied.id, renderedCandidate: await rendered(applied) });
    await save("human-after-apply", { title: "Human title after AI" });
    check("a fresh Undo never overwrites a later human edit", (await ai("content-ai-undo", { proposalId: applied.id })).error?.code === "revision-conflict" && (await working()).values.title === "Human title after AI");

    // A delayed Apply loses to a human save made while it was in flight.
    const delayed = await proposed("delayed");
    const delayedIdentity = await rendered(delayed);
    host.faults.aiDelayMs = 800;
    const inFlight = ai("content-ai-apply", { proposalId: delayed.id, renderedCandidate: delayedIdentity });
    await save("human-during-apply", { author: "Saved while AI was in flight" });
    const late = await inFlight;
    host.faults.aiDelayMs = 0;
    check("a delayed Apply after a human save is refused and the human save is kept", late.error?.code === "revision-conflict" && (await working()).values.author === "Saved while AI was in flight");

    // Accounts and sites: another account or another site cannot read, apply or undo; propose-only cannot write.
    check("another account cannot read this account's proposal", (await ai("content-ai-read", { proposalId: proposal.id }, tokens.second)).error?.code === "not-found");
    check("another account cannot apply or undo it", (await ai("content-ai-apply", { proposalId: delayed.id, renderedCandidate: delayedIdentity }, tokens.second)).error?.code === "not-found"
      && (await ai("content-ai-undo", { proposalId: applied.id }, tokens.second)).error?.code === "not-found");
    check("another account cannot read this account's receipt", (await api(`/api/receipt?key=${encodeURIComponent(proposal.operationKey)}`, undefined, tokens.second)) === null);
    check("another account cannot render this account's candidate", (await candidate(proposal.id, tokens.second)).status === 404);
    const store = openArticleProposalStore(host.database);
    const foreign = { ...structuredClone(delayed), id: "other-site-proposal-0001", operationKey: "content-ai:other-site-proposal-0001" };
    await store.create({ schemaVersion: 1, owner: articleProposalOwner("other-site"), actorId: "article-editor", proposal: foreign });
    check("another site's proposal is not found here", (await ai("content-ai-read", { proposalId: foreign.id })).error?.code === "not-found");
    check("proposal records are create-only", await store.create({ schemaVersion: 1, owner: articleProposalOwner("article-cms"), actorId: "article-editor", proposal: foreign }).then(() => false, error => error.code === "operation-key-reuse"));
    const reviewer = await proposed("reviewer idea", tokens.reviewer);
    const reviewed = await candidate(reviewer.id, tokens.reviewer);
    const reviewerHistory = (await history()).length;
    check("a propose-only account can prepare and render but not apply", (await ai("content-ai-apply", { proposalId: reviewer.id, renderedCandidate: reviewed.identity }, tokens.reviewer)).error?.code === "forbidden");
    check("a propose-only account cannot write Content directly", (await request("/api/execute", { token: tokens.reviewer, body: { kind: "set-fields", operationKey: "reviewer-write", expected: identities(await api("/api/state")), entry: welcome, values: { title: "x" }, clear: [] } })).status === 403
      && (await history()).length === reviewerHistory);

    // Requests carry only an Entry, an instruction or a proposal id.
    check("a request cannot add fields, an actor or a source", (await ai("content-ai-prepare", { entry: welcome, instruction: "x", values: { author: "x" } })).error?.code === "invalid-request"
      && (await ai("content-ai-prepare", { entry: welcome, instruction: "x", actor: { id: "second-editor" } })).error?.code === "invalid-request"
      && (await request("/api/ai", { body: { operation: "content-ai-read", payload: { proposalId: proposal.id }, source: "anything" } })).status === 400);
    check("an Entry without title or body is outside Content-AI", (await ai("content-ai-prepare", { entry: articleIndex, instruction: "x" })).error?.code === "forbidden");
    check("an unknown session is refused", (await request("/api/ai", { body: { operation: "content-ai-status", payload: {} }, token: "unknown-session-token-000" })).status === 401);
    // fetch cannot set Host, so this one request is written with node:http.
    const foreignHost = await new Promise((done, fail) => httpRequest(`${host.url}/api/ai`, { method: "POST", headers: { host: "attacker.example", "content-type": "application/json" } },
      response => { response.resume(); done(response.statusCode); }).on("error", fail).end(JSON.stringify({ operation: "content-ai-status", payload: {} })));
    check("another Host name is refused", foreignHost === 421);
    check("a cross-origin write is refused", (await request("/api/ai", { body: { operation: "content-ai-status", payload: {} }, headers: { origin: "http://attacker.example" } })).status === 403);

    // A model reply outside title/body is refused by the service, whatever the provider sends.
    const sneaky = { ...fake.provider, proposer: { label: "Restricted-field test proposer", propose: async () => ({ kind: "proposal", values: { author: "Model wrote this" }, summary: "" }) } };
    await restart({ provider: sneaky });
    const beforeSneaky = (await history()).length;
    check("a proposal for a restricted field is refused and writes nothing", (await ai("content-ai-prepare", { entry: welcome, instruction: "x" })).error?.code === "forbidden" && (await history()).length === beforeSneaky);

    // An unavailable provider: no new proposal, but Content, history and committed results stay readable.
    const missing = await createContentAiProvider({ provider: "claude-cli", executable: "/nonexistent/claude-for-content-ai" });
    await restart({ provider: missing });
    const offline = await value("content-ai-status", {});
    check("an unavailable provider is reported with its own reason", offline.configured && offline.inference.state === "unavailable" && offline.inference.code === "not-installed"
      && !offline.inference.message.includes(homedir()));
    const refused = await ai("content-ai-prepare", { entry: welcome, instruction: "x" });
    check("an unavailable provider prepares nothing and leaks no local path", refused.error?.code === "unavailable" && !refused.error.message.includes(homedir()) && (await history()).length === beforeSneaky);
    check("with the provider down, saved Content and committed operations stay readable", (await value("content-ai-read", { proposalId: proposal.id })).undone?.revisionId === afterUndo[0].id
      && (await value("content-ai-apply", { proposalId: applied.id })).recovered && (await working()).values.title === "Human title after AI");

    // A normal restart never reseeds.
    const kept = await history();
    await restart();
    check("a normal restart keeps every revision and proposal", JSON.stringify(await history()) === JSON.stringify(kept) && rows().length === 6);
    evidence.revisions = kept.length;
    evidence.modelCalls = fake.counter.calls;
    return evidence;
  } catch (error) {
    console.error(`host log:\n${host.output()}`);
    throw error;
  } finally {
    await host.close();
    if (!directory) await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await runArticleAiHttpProof({ directory: process.argv[2] });
  console.log(JSON.stringify({ proof: "article-cms-ai-http", checks: evidence.checks.length, revisions: evidence.revisions, modelCalls: evidence.modelCalls, node: evidence.node }, null, 2));
  for (const name of evidence.checks) console.log(`PASS ${name}`);
}
