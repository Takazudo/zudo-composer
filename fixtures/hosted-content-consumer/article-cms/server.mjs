// Local Article CMS host: SQLite storage, the public Hosted Content service, a loopback HTTP transport and a
// local publisher that writes an artifact and activates it as the local baseline. Nothing is deployed.
// Content-AI runs here, in this Node process: the browser only sends instructions and proposal ids.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { EditorialError, createHostedContentEditorial, runContentAiOperation } from "zudo-composer/hosted-content";
import { createContentAiProvider } from "zudo-composer/hosted-content/node";
import { initializeSqliteDatabase, openSqliteHandle } from "../sqlite-storage.mjs";
import { articleAccounts, articleActor, createArticlePolicy, createArticleSeed, createArticleService } from "./article-data.mjs";
import { articleCandidateRender, candidateRenderIdentity, createArticleContentAi, openArticleProposalStore } from "./content-ai.mjs";
import { projectArticles, renderArticlesHtml } from "./render.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const conflicts = new Set(["revision-conflict", "baseline-conflict", "definition-conflict", "operation-key-reuse", "publication-busy"]);
const shell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Article CMS</title><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

/** Bundles the host admin from its public imports only; the bytes are what the browser receives. */
export async function buildArticleUi() {
  const result = await build({ entryPoints: { app: join(here, "ui/app.mjs") }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/out", jsx: "automatic", jsxImportSource: "preact", logLevel: "silent", metafile: true });
  const files = new Map(result.outputFiles.map(file => [file.path.replace(/^\/out/, ""), file.text]));
  if (!files.has("/app.js") || !files.has("/app.css")) throw new Error("Article admin bundle is incomplete");
  return { files, metafile: result.metafile };
}

const editorialStatus = { "invalid-request": 400, "invalid-value": 400, forbidden: 403, "not-found": 404, "revision-conflict": 409, "operation-key-reuse": 409,
  "restore-incompatible": 422, "configuration-required": 503, unavailable: 503 };
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));

/**
 * `faults.stopAfterVerified` is a proof-only interruption: the publisher stops after recording the verified
 * artifact and before activation, as a crash would. A restart resumes it from the persisted facts.
 * `faults.aiDelayMs` holds every Content-AI response back; `faults.dropAiResponse` names one Content-AI operation
 * whose next response is lost after it ran, as a dropped connection would lose it, and `faults.haltAfterDrop` then
 * stops serving as a crash would. All are proof-only.
 *
 * `ai` is the host's explicit Content-AI choice: `null` turns it off; `{ provider }` is one provider from
 * `createContentAiProvider` (or a host's own). `sessions` maps a bearer token to one host account; a request
 * without one is the local editor who started this loopback host.
 */
export async function startArticleCms({ directory, port = 0, faults = {}, ai = null, sessions = {} } = {}) {
  directory = resolve(directory);
  const database = join(directory, "articles.sqlite"), artifacts = join(directory, "artifacts");
  await mkdir(directory, { recursive: true });
  // Seeds only an empty database; a normal start never resets or reseeds existing data.
  await initializeSqliteDatabase(database, createArticleSeed());
  const proposals = ai ? openArticleProposalStore(database) : null;
  const localEditor = { actorId: articleActor.id, role: "write" };
  for (const value of Object.values(sessions)) if (!Object.hasOwn(articleAccounts, value.actorId) || articleAccounts[value.actorId].role !== value.role) throw new Error("A session must name a host account with its own role");
  const withService = async (work, session = localEditor) => {
    const handle = openSqliteHandle(database);
    try { return await work(createArticleService(handle.storage, { role: session.role }), handle.storage); } finally { handle.close(); }
  };
  const requestLog = [];
  const { files } = await buildArticleUi();
  const publishing = new Map();

  const readManifest = id => readFile(join(artifacts, id, "artifact.json"), "utf8").then(JSON.parse, () => null);
  /** Writes the artifact once; an existing one is reused only when it is exactly this snapshot. */
  async function ensureArtifact(publicationId, snapshot) {
    const existing = await readManifest(publicationId);
    if (existing?.snapshotId === snapshot.id && existing.snapshotDigest === snapshot.digest) return;
    const target = join(artifacts, publicationId), staging = `${target}.staging`;
    await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "index.html"), renderArticlesHtml(snapshot.renderData));
    await writeFile(join(staging, "artifact.json"), JSON.stringify({ publicationId, snapshotId: snapshot.id, snapshotDigest: snapshot.digest,
      notice: "Local artifact only. It is not live and not deployed." }, null, 2));
    await rm(target, { recursive: true, force: true }); await rename(staging, target);
  }
  // Local publication: submitted → artifact written (verified) → activated as the local baseline (integrated).
  // Each step resumes from the persisted status, so an interrupted publication completes once after a restart.
  async function publish(publicationId) {
    await withService(async (service, storage) => {
      let publication = await service.getPublication(articleActor, publicationId);
      if (!["submitted", "verified"].includes(publication.status)) return;
      const snapshot = await storage.readSnapshot(publication.snapshotId);
      await ensureArtifact(publicationId, snapshot);
      if (publication.status === "submitted") {
        await service.recordStatus({ publicationId, snapshotId: snapshot.id, statusVersion: publication.statusVersion + 1, status: "verified", facts: { artifact: publicationId } });
        publication = await service.getPublication(articleActor, publicationId);
        if (faults.stopAfterVerified) throw new Error("Interrupted after verification (proof fault)");
      }
      // A deterministic local commit identity for the activated snapshot; no Git repository is involved.
      const gitSha = createHash("sha1").update(snapshot.digest).digest("hex");
      await service.recordConfirmedIntegration({ publicationId, snapshotId: snapshot.id, expectedBaseline: publication.expectedBaseline, gitSha, contentDigest: snapshot.digest });
    });
  }
  const advance = id => {
    if (!publishing.has(id)) publishing.set(id, publish(id).finally(() => publishing.delete(id)));
    return publishing.get(id);
  };
  const pending = (await withService(service => service.readPublicationStatus(articleActor))).submission;
  if (pending && ["submitted", "verified"].includes(pending.status)) advance(pending.publicationId).catch(() => undefined);

  const readBody = async request => {
    const chunks = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 1_000_000) throw Object.assign(new Error("Request exceeds size limit"), { code: "invalid-request" });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Request body is not JSON"), { code: "invalid-request" }); }
  };
  /** One Content-AI operation for the resolved session. Status and reads never call the model. */
  async function contentAi(session, operation, payload) {
    const handle = openSqliteHandle(database);
    try {
      const service = createArticleContentAi({ storage: handle.storage, session, provider: ai.provider, store: proposals });
      // A rendered candidate is acknowledged by its render identity, which this host recomputes for the
      // proposal, route, renderer and definition it serves now; only then does the service see the digest.
      if (operation === "content-ai-apply" && payload && typeof payload === "object" && typeof payload.renderedCandidate === "string") {
        const { proposal } = await service.read({ proposalId: payload.proposalId });
        const identity = candidateRenderIdentity({ proposal, definition: (await handle.storage.readHead()).state.definition });
        payload = { ...payload, renderedCandidate: payload.renderedCandidate === identity ? proposal.candidateDigest : "unrendered" };
      }
      return await runContentAiOperation({
        status: async () => ({ configured: true, provider: ai.provider?.label ?? "None", canApply: session.role === "write",
          inference: ai.provider ? await ai.provider.inference() : { state: "unavailable", code: "not-configured", message: "This host was started without an AI provider." } }),
        service: async () => service,
      }, operation, payload);
    } catch (error) {
      if (error instanceof EditorialError) return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
      throw error;
    } finally { handle.close(); }
  }
  async function candidate(session, proposalId) {
    const handle = openSqliteHandle(database);
    try {
      const service = createArticleContentAi({ storage: handle.storage, session, provider: ai.provider, store: proposals });
      const { proposal } = await service.read({ proposalId });
      const current = await createHostedContentEditorial({ service: source => createArticleService(handle.storage, { source, role: session.role }), provenance: { actor: { id: session.actorId }, source: "article-admin" } })
        .readEntry({ entry: proposal.entry, perspective: "working" });
      return await articleCandidateRender({ storage: handle.storage, proposal, current });
    } finally { handle.close(); }
  }

  let hosts = new Set(), halted = false;
  const server = createServer(async (request, response) => {
    if (halted) { request.socket.destroy(); return; }
    const send = (status, body, type = "application/json; charset=utf-8") => {
      requestLog.push(`${request.method} ${request.url?.split("?")[0]} ${status}`);
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" })
        .end(typeof body === "string" ? body : JSON.stringify(body));
    };
    try {
      if (!hosts.has(request.headers.host ?? "")) { send(421, { code: "invalid-request", message: "Unexpected Host" }); return; }
      if (request.method === "POST" && request.headers.origin && !hosts.has(new URL(request.headers.origin).host)) { send(403, { code: "forbidden", message: "Cross-origin write" }); return; }
      const url = new URL(request.url, "http://localhost"), path = url.pathname;
      // Authentication is the host's: a bearer token names one of its sessions; the request never names an actor.
      const bearer = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(request.headers.authorization ?? "")?.[1];
      if (request.headers.authorization !== undefined && (!bearer || !Object.hasOwn(sessions, bearer))) { send(401, { code: "forbidden", message: "Unknown session" }); return; }
      const session = bearer ? sessions[bearer] : localEditor, actor = { id: session.actorId };
      if (path === "/api/ai" || path === "/api/ai/candidate") {
        if (!ai) { send(404, { code: "not-found", message: "Content-AI is not enabled on this host" }); return; }
        if (faults.aiDelayMs) await delay(faults.aiDelayMs);
        if (request.method === "GET" && path === "/api/ai/candidate") {
          const result = await candidate(session, url.searchParams.get("id"));
          send(200, result); return;
        }
        if (request.method !== "POST") { send(405, { code: "invalid-request", message: "Use POST" }); return; }
        const body = await readBody(request);
        if (!body || typeof body !== "object" || typeof body.operation !== "string" || Object.keys(body).some(key => key !== "operation" && key !== "payload")) throw Object.assign(new Error("Malformed Content-AI request"), { code: "invalid-request" });
        const result = await contentAi(session, body.operation, body.payload ?? {});
        if (faults.dropAiResponse === body.operation) {
          // The operation ran and committed whatever it committed; only its response is lost.
          faults.dropAiResponse = null; requestLog.push(`POST /api/ai ${body.operation} response dropped`);
          request.socket.destroy();
          if (faults.haltAfterDrop) { halted = true; server.closeAllConnections?.(); }
          return;
        }
        send(200, result); return;
      }
      const q = () => { try { return JSON.parse(url.searchParams.get("q") ?? "null"); } catch { throw Object.assign(new Error("Query is not JSON"), { code: "invalid-request" }); } };
      if (request.method === "GET" && path === "/") { send(200, shell, "text/html; charset=utf-8"); return; }
      if (request.method === "GET" && files.has(path)) { send(200, files.get(path), path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"); return; }
      if (request.method === "GET" && path.startsWith("/artifacts/")) {
        const id = path.split("/")[2] ?? "";
        const html = /^[A-Za-z0-9-]{1,80}$/.test(id) ? await readFile(join(artifacts, id, "index.html"), "utf8").catch(() => null) : null;
        if (html === null) { send(404, { code: "not-found", message: "No such artifact" }); return; }
        send(200, html, "text/html; charset=utf-8"); return;
      }
      const reads = {
        "/api/policy": () => createArticlePolicy(),
        "/api/state": service => service.readState(actor),
        "/api/receipt": service => service.readReceipt(actor, url.searchParams.get("key")),
        "/api/publication": service => service.getPublication(actor, url.searchParams.get("id")),
        "/api/models": service => service.listModels(actor),
        "/api/entries": service => service.listEntries(actor, q()),
        "/api/entry": service => service.readEntry(actor, q()),
        "/api/revisions": service => service.listRevisions(actor, q()),
        "/api/revision": service => service.readRevision(actor, url.searchParams.get("id")),
        "/api/compare": service => service.compareRevisions(actor, q()),
        "/api/publication-status": service => service.readPublicationStatus(actor),
        // Host-owned: the activated baseline projected for the published preview, with its identity.
        "/api/published-site": async (_service, storage) => {
          const head = await storage.readHead();
          return { baseline: head.state.baseline, integrationFence: head.state.integrationFence, renderData: projectArticles(head.baselineProviders) };
        },
      };
      if (request.method === "GET" && reads[path]) { send(200, await withService(reads[path], session)); return; }
      if (request.method === "POST" && path === "/api/execute") {
        const command = await readBody(request);
        const result = await withService(service => service.execute(actor, command), session);
        if (result.publication?.status === "submitted") advance(result.publication.id).catch(() => undefined);
        send(200, result); return;
      }
      send(404, { code: "not-found", message: "Not found" });
    } catch (error) {
      const status = error instanceof EditorialError ? editorialStatus[error.code] ?? 500 : conflicts.has(error.code) ? 409 : error.code === "restore-incompatible" ? 422 : error.code === "forbidden" ? 403 : error.code ? 400 : 500;
      if (!response.headersSent) send(status, { code: error.code ?? "article-host-error", message: error.message, diagnostics: error.diagnostics, restoreDiagnostics: error.restoreDiagnostics });
    }
  });
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", ready); });
  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  return { url: `http://127.0.0.1:${actual}`, database, artifacts, faults, output: () => requestLog.join("\n"), settled: () => Promise.allSettled(publishing.values()),
    async close() { await Promise.allSettled(publishing.values()); await new Promise(ready => { server.close(() => ready()); server.closeAllConnections?.(); }); } };
}

const USAGE = `Usage: node article-cms/server.mjs --data <dir> --ai off|fake|claude-cli|codex-cli [--executable <name|/abs/path>] [--model <id>] [--timeout-ms <n>] [--port <n>]
  --data        SQLite data directory (created and seeded with demo articles only when empty; never reset)
  --ai          Content-AI provider, chosen explicitly: off, fake (offline deterministic), claude-cli or codex-cli
                (your locally installed, already signed-in CLI; inference runs in this Node process, never in the browser)
  --port        Loopback port (default 4180; 0 picks a free one)`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { data: { type: "string" }, ai: { type: "string" }, executable: { type: "string" }, model: { type: "string" },
    "timeout-ms": { type: "string" }, port: { type: "string", default: "4180" }, help: { type: "boolean", default: false } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (!values.data || !["off", "fake", "claude-cli", "codex-cli"].includes(values.ai ?? "")) { console.error(`--data and --ai are required.\n${USAGE}`); process.exit(2); }
  const cli = values.ai === "claude-cli" || values.ai === "codex-cli";
  if (!cli && (values.executable || values.model || values["timeout-ms"])) { console.error("--executable, --model and --timeout-ms apply only to a CLI provider."); process.exit(2); }
  const provider = values.ai === "off" ? null : await createContentAiProvider(values.ai === "fake" ? { provider: "fake" } : {
    provider: values.ai, ...(values.executable ? { executable: values.executable } : {}), ...(values.model ? { model: values.model } : {}),
    ...(values["timeout-ms"] ? { timeoutMs: Number(values["timeout-ms"]) } : {}) });
  const running = await startArticleCms({ directory: values.data, port: Number(values.port), ai: provider ? { provider } : null });
  const inference = provider ? await provider.inference() : null;
  console.log([`Article CMS (local only; nothing here is deployed): ${running.url}/`, `Data:       ${running.database}`,
    `Content-AI: ${provider ? `${provider.label} — ${inference.state === "ready" ? inference.detail : `${inference.state}: ${inference.message}`}` : "off"}`,
    "Press Ctrl+C to stop. Data is kept."].join("\n"));
  process.on("SIGINT", () => { void running.close().then(() => process.exit(0)); });
}
