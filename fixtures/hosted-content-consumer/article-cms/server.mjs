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
import { createContentAiProvider } from "zudo-composer/hosted-content/node";
import { initializeSqliteDatabase, openSqliteHandle } from "../sqlite-storage.mjs";
import { articleErrorResponse, createArticleApi, invalidRequest } from "./api.mjs";
import { readArticleCandidate, runArticleContentAi } from "./article-core.mjs";
import { articleAccounts, articleActor, createArticleSeed, createArticleService } from "./article-data.mjs";
import { candidateRenderIdentity, openArticleProposalStore } from "./content-ai.mjs";
import { renderArticlesHtml } from "./render.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Bundles the host admin from its public imports only; the bytes are what the browser receives. */
export async function buildArticleUi() {
  const result = await build({ entryPoints: { app: join(here, "ui/app.mjs") }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/out", jsx: "automatic", jsxImportSource: "preact", logLevel: "silent", metafile: true });
  const files = new Map(result.outputFiles.map(file => [file.path.replace(/^\/out/, ""), file.text]));
  if (!files.has("/app.js") || !files.has("/app.css")) throw new Error("Article admin bundle is incomplete");
  return { files, metafile: result.metafile };
}

const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));

/**
 * `faults.stopAfterVerified` is a proof-only interruption: the publisher stops after recording the verified
 * artifact and before activation, as a crash would. A restart resumes it from the persisted facts.
 * `faults.aiDelayMs` holds every Content-AI response back; `faults.dropAiResponse` names one Content-AI operation
 * whose next response is lost after it ran, as a dropped connection would lose it, and `faults.haltAfterDrop` then
 * stops serving as a crash would. All are proof-only.
 *
 * `ai` is the host's explicit Content-AI choice: `{ provider }` is one provider from `createContentAiProvider`
 * (or a host's own); `null` or `{ provider: null }` turns new inference off. Off never closes the durable
 * proposal store: saved proposals, candidate renders, guarded Apply/Undo and committed-operation recovery stay. `sessions` maps a bearer token to one host account; a request
 * without one is the local editor who started this loopback host.
 */
export async function startArticleCms({ directory, port = 0, faults = {}, ai = null, sessions = {} } = {}) {
  directory = resolve(directory);
  const database = join(directory, "articles.sqlite"), artifacts = join(directory, "artifacts");
  await mkdir(directory, { recursive: true });
  // Seeds only an empty database; a normal start never resets or reseeds existing data.
  await initializeSqliteDatabase(database, createArticleSeed());
  const proposals = openArticleProposalStore(database), provider = ai?.provider ?? null;
  const localEditor = { actorId: articleActor.id, role: "write" };
  // A session names a host account with its own role or, when the host has narrowed it, propose-only.
  for (const value of Object.values(sessions)) if (!Object.hasOwn(articleAccounts, value.actorId) || ![articleAccounts[value.actorId].role, "propose"].includes(value.role)) throw new Error("A session must name a host account with its own role or propose-only");
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
      if (length > 1_000_000) throw invalidRequest("Request exceeds size limit");
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalidRequest("Request body is not JSON"); }
  };
  // Content-AI runs in this Node process; one SQLite handle per operation. Status and reads never call the model.
  const aiContext = (session, storage) => ({ storage, session, provider, store: proposals, serviceFor: source => createArticleService(storage, { source, role: session.role }),
    identityOf: async input => candidateRenderIdentity(input) });
  const withHandle = async work => { const handle = openSqliteHandle(database); try { return await work(handle.storage); } finally { handle.close(); } };
  const api = createArticleApi({
    files,
    host: { backend: "node-sqlite", label: "Node + SQLite", local: true, deployed: false, ai: provider ? provider.label : "Off" },
    withService: (session, work) => withService(work, session),
    contentAi: (session, operation, payload) => withHandle(storage => runArticleContentAi({ ...aiContext(session, storage), operation, payload })),
    candidate: (session, proposalId) => withHandle(storage => readArticleCandidate({ ...aiContext(session, storage), proposalId })),
    artifact: id => readFile(join(artifacts, id, "index.html"), "utf8").catch(() => null),
    submitted: id => { advance(id).catch(() => undefined); },
  });

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
      const session = bearer ? sessions[bearer] : localEditor;
      if (faults.aiDelayMs && path.startsWith("/api/ai")) await delay(faults.aiDelayMs);
      const result = await api({ method: request.method, path, searchParams: url.searchParams, session, readJson: () => readBody(request) });
      if (result.aiOperation && faults.dropAiResponse === result.aiOperation) {
        // The operation ran and committed whatever it committed; only its response is lost.
        faults.dropAiResponse = null; requestLog.push(`POST /api/ai ${result.aiOperation} response dropped`);
        request.socket.destroy();
        if (faults.haltAfterDrop) { halted = true; server.closeAllConnections?.(); }
        return;
      }
      send(result.status, result.body, result.type);
    } catch (error) {
      const { status, body } = articleErrorResponse(error);
      if (!response.headersSent) send(status, body);
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
    `Content-AI: ${provider ? `${provider.label} — ${inference.state === "ready" ? inference.detail : `${inference.state}: ${inference.message}`}` : "off — no new proposals; saved proposals, their Apply/Undo and recovery stay available"}`,
    "Press Ctrl+C to stop. Data is kept."].join("\n"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void running.close().then(() => process.exit(0)); });
}
