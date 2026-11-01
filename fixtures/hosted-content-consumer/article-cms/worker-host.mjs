/* global Headers */
// Local launcher for the Worker/D1 Article CMS. Node code outside the Worker runtime: it bundles the admin and the
// Worker once during preparation, starts the pinned local workerd with one local D1 binding persisted under
// `--data`, initializes that database explicitly (seeding only when absent) and serves it on loopback.
// No Cloudflare login, remote binding or deployment is involved; remote flags are refused.
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { assertLocalOnly, localRuntimeVersions, startD1Runtime } from "../d1-runtime.mjs";
import { articleActor, createArticleSeed } from "./article-data.mjs";
import { initializeArticleD1 } from "./d1-article.mjs";
import { buildArticleUi } from "./server.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
// Worker runtime inputs must stay portable; anything matching these never enters the Worker bundle.
const FORBIDDEN_WORKER_INPUT = /(^|\/)(node:|sqlite-storage\.mjs|sqlite-worker\.mjs|server\.mjs|content-ai\.mjs|article-data\.mjs|worker-host\.mjs|d1-runtime\.mjs)|hosted-content\/node|node_modules\/zudo-composer\/src\/|child_process|node:sqlite/;

let prepared;
/** Bundles the admin and the Worker once per process; the Worker serves these bytes and compiles nothing per request. */
export async function buildArticleWorker() {
  prepared ??= (async () => {
    const { files } = await buildArticleUi();
    const result = await build({ entryPoints: [join(here, "worker.mjs")], bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false, metafile: true,
      mainFields: ["module", "main"], conditions: ["worker", "browser"], logLevel: "silent",
      plugins: [{ name: "article-ui-files", setup(builder) {
        builder.onResolve({ filter: /^article-cms:ui-files$/ }, () => ({ path: "ui-files", namespace: "article-ui" }));
        builder.onLoad({ filter: /.*/, namespace: "article-ui" }, () => ({ contents: `export default ${JSON.stringify(Object.fromEntries(files))};`, loader: "js" }));
      } }] });
    const inputs = Object.keys(result.metafile.inputs);
    for (const input of inputs) if (FORBIDDEN_WORKER_INPUT.test(input)) throw new Error(`Worker runtime graph leak: ${input}`);
    return { script: result.outputFiles[0].text, metafile: result.metafile, inputs };
  })();
  return prepared;
}

/**
 * Start (or restart) the Worker host on `directory`. `ai` is "fake" or "off". `sessions` maps a bearer token to
 * `{ actorId, role, siteId }`; requests without a token are the local fixture editor. `faults` are proof-only and
 * live in this launcher (dropping a response, halting as a crash would) or in the proof binding (stopAfterVerified);
 * none is reachable over HTTP.
 */
export async function startWorkerArticleCms({ directory, port = 0, ai = "fake", sessions = {}, faults = {}, localEditor = { actorId: articleActor.id, role: "write" } } = {}) {
  if (!["fake", "off"].includes(ai)) throw new Error("The Worker host supports --ai fake or off; real CLIs stay on the Node host.");
  directory = resolve(directory);
  const persist = join(directory, "d1-state");
  const { script } = await buildArticleWorker();
  const requestLog = [];
  let runtime = null, halted = false, hosts = new Set();
  const server = createServer(async (request, response) => {
    if (halted || !runtime) { request.socket.destroy(); return; }
    const send = (status, headers, body) => { requestLog.push(`${request.method} ${request.url?.split("?")[0]} ${status}`); response.writeHead(status, headers).end(body); };
    try {
      if (!hosts.has(request.headers.host ?? "")) { send(421, { "content-type": "application/json" }, JSON.stringify({ code: "invalid-request", message: "Unexpected Host" })); return; }
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 1_000_000) { send(400, { "content-type": "application/json" }, JSON.stringify({ code: "invalid-request", message: "Request exceeds size limit" })); return; } chunks.push(chunk); }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const path = new URL(request.url, "http://localhost").pathname;
      if (faults.aiDelayMs && path.startsWith("/api/ai")) await delay(faults.aiDelayMs);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string" && name !== "connection" && name !== "content-length") headers.set(name, value);
      const answer = await runtime.fetch(`http://${request.headers.host}${request.url}`, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : body });
      const bytes = Buffer.from(await answer.arrayBuffer());
      let operation = null;
      if (request.method === "POST" && path === "/api/ai" && body) { try { operation = JSON.parse(body.toString("utf8")).operation; } catch { operation = null; } }
      if (operation && faults.dropAiResponse === operation) {
        // The Worker ran the operation and committed whatever it committed; only its response is lost in transit.
        faults.dropAiResponse = null; requestLog.push(`POST /api/ai ${operation} response dropped`);
        request.socket.destroy();
        if (faults.haltAfterDrop) { halted = true; server.closeAllConnections?.(); const stopping = runtime; runtime = null; await stopping.dispose().catch(() => undefined); }
        return;
      }
      send(answer.status, Object.fromEntries(answer.headers), bytes);
    } catch (error) {
      if (!response.headersSent) send(502, { "content-type": "application/json" }, JSON.stringify({ code: "article-host-error", message: `Local Worker runtime error: ${error.message}` }));
    }
  });
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", ready); });
  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  const config = { siteId: "article-cms", sessionMode: "local-fixture", ai, localEditor, sessions, allowedHosts: [...hosts] };
  assertLocalOnly(config);
  runtime = await startD1Runtime({ persist, script, name: "article-cms-local", bindings: {
    ARTICLE_HOST: { type: "json", value: config },
    ARTICLE_PROOF_FAULTS: { type: "json", value: { stopAfterVerified: Boolean(faults.stopAfterVerified) } },
  } });
  // Explicit initialization: classifies the database read-only first, creates and seeds only an empty one, reopens a
  // current store unchanged and refuses anything else unchanged; a restart never resets it.
  let initialized;
  try { initialized = await initializeArticleD1(await runtime.database(), createArticleSeed()); }
  catch (error) {
    halted = true;
    await new Promise(ready => { server.close(() => ready()); server.closeAllConnections?.(); });
    const stopping = runtime; runtime = null; await stopping.dispose();
    throw error;
  }
  const url = `http://127.0.0.1:${actual}`;
  const status = async () => { const answer = await fetch(`${url}/api/publication-status`); return answer.json(); };
  // Any request resumes a persisted, unfinished publication; this first read does so after a restart.
  await status().catch(() => undefined);
  return {
    url, persist, faults, seeded: initialized.seeded, backend: "worker-d1",
    database: () => runtime?.database(),
    output: () => requestLog.join("\n"),
    /** Waits until the newest submission is no longer submitted/verified; each poll is an ordinary read that also resumes it. */
    async settled({ timeoutMs = 20_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (!runtime) return;
        const current = await status().catch(() => null);
        if (!current?.submission || !["submitted", "verified"].includes(current.submission.status) || Date.now() > deadline) return;
        await delay(50);
      }
    },
    async close() {
      halted = true;
      await new Promise(ready => { server.close(() => ready()); server.closeAllConnections?.(); });
      if (runtime) { const stopping = runtime; runtime = null; await stopping.dispose(); }
    },
  };
}

const USAGE = `Usage: node article-cms/worker-host.mjs --data <dir> --ai fake|off [--port <n>]
  --data   Host-owned directory; the local D1 state lives in <dir>/d1-state (seeded only when absent; never reset)
  --ai     fake (offline deterministic test provider, not model evidence) or off (saved proposals and recovery stay)
  --port   Loopback port (default 4181; 0 picks a free one)
Local only: no Cloudflare login, remote binding or deployment. Real Claude/Codex CLIs run only on the Node host.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertLocalOnly({});
  const { values } = parseArgs({ strict: true, options: { data: { type: "string" }, ai: { type: "string" }, port: { type: "string", default: "4181" }, help: { type: "boolean", default: false } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  if (!values.data || !["fake", "off"].includes(values.ai ?? "")) { console.error(`--data and --ai fake|off are required.\n${USAGE}`); process.exit(2); }
  const running = await startWorkerArticleCms({ directory: values.data, port: Number(values.port), ai: values.ai });
  const versions = await localRuntimeVersions();
  console.log([`Article CMS on a local Worker (local only; nothing here is deployed): ${running.url}/`,
    `Backend:    Worker + local D1 (workerd ${versions.workerd}, miniflare ${versions.miniflare})`, `D1 state:   ${running.persist}${running.seeded ? " (seeded now)" : " (reopened)"}`,
    `Content-AI: ${values.ai === "fake" ? "fake — offline deterministic test provider, not model evidence" : "off — no new proposals; saved proposals, their Apply/Undo and recovery stay available"}`,
    "Session:    local fixture editor (test/local only; not production login)", "Press Ctrl+C to stop. Data is kept."].join("\n"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void running.close().then(() => process.exit(0)); });
}
