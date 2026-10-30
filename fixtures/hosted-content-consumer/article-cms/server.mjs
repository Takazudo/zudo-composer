// Local Article CMS host: SQLite storage, the public Hosted Content service, a loopback HTTP transport and a
// local publisher that writes an artifact and activates it as the local baseline. Nothing is deployed.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { initializeSqliteDatabase, openSqliteHandle } from "../sqlite-storage.mjs";
import { articleActor, createArticlePolicy, createArticleSeed, createArticleService } from "./article-data.mjs";
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

/**
 * `faults.stopAfterVerified` is a proof-only interruption: the publisher stops after recording the verified
 * artifact and before activation, as a crash would. A restart resumes it from the persisted facts.
 */
export async function startArticleCms({ directory, port = 0, faults = {} } = {}) {
  directory = resolve(directory);
  const database = join(directory, "articles.sqlite"), artifacts = join(directory, "artifacts");
  await mkdir(directory, { recursive: true });
  await initializeSqliteDatabase(database, createArticleSeed());
  const withService = async work => {
    const handle = openSqliteHandle(database);
    try { return await work(createArticleService(handle.storage), handle.storage); } finally { handle.close(); }
  };
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

  let hosts = new Set();
  const server = createServer(async (request, response) => {
    const send = (status, body, type = "application/json; charset=utf-8") => response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" })
      .end(typeof body === "string" ? body : JSON.stringify(body));
    try {
      if (!hosts.has(request.headers.host ?? "")) { send(421, { code: "invalid-request", message: "Unexpected Host" }); return; }
      if (request.method === "POST" && request.headers.origin && !hosts.has(new URL(request.headers.origin).host)) { send(403, { code: "forbidden", message: "Cross-origin write" }); return; }
      const url = new URL(request.url, "http://localhost"), path = url.pathname;
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
        "/api/state": service => service.readState(articleActor),
        "/api/receipt": service => service.readReceipt(articleActor, url.searchParams.get("key")),
        "/api/publication": service => service.getPublication(articleActor, url.searchParams.get("id")),
        "/api/models": service => service.listModels(articleActor),
        "/api/entries": service => service.listEntries(articleActor, q()),
        "/api/entry": service => service.readEntry(articleActor, q()),
        "/api/revisions": service => service.listRevisions(articleActor, q()),
        "/api/revision": service => service.readRevision(articleActor, url.searchParams.get("id")),
        "/api/compare": service => service.compareRevisions(articleActor, q()),
        "/api/publication-status": service => service.readPublicationStatus(articleActor),
        // Host-owned: the activated baseline projected for the published preview, with its identity.
        "/api/published-site": async (_service, storage) => {
          const head = await storage.readHead();
          return { baseline: head.state.baseline, integrationFence: head.state.integrationFence, renderData: projectArticles(head.baselineProviders) };
        },
      };
      if (request.method === "GET" && reads[path]) { send(200, await withService(reads[path])); return; }
      if (request.method === "POST" && path === "/api/execute") {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        let command;
        try { command = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Request body is not JSON"), { code: "invalid-request" }); }
        const result = await withService(service => service.execute(articleActor, command));
        if (result.publication?.status === "submitted") advance(result.publication.id).catch(() => undefined);
        send(200, result); return;
      }
      send(404, { code: "not-found", message: "Not found" });
    } catch (error) {
      if (!response.headersSent) send(conflicts.has(error.code) ? 409 : error.code === "restore-incompatible" ? 422 : error.code ? 400 : 500,
        { code: error.code ?? "article-host-error", message: error.message, diagnostics: error.diagnostics, restoreDiagnostics: error.restoreDiagnostics });
    }
  });
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", ready); });
  const actual = server.address().port;
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
  return { url: `http://127.0.0.1:${actual}`, database, artifacts, settled: () => Promise.allSettled(publishing.values()),
    async close() { await Promise.allSettled(publishing.values()); await new Promise(ready => { server.close(() => ready()); server.closeAllConnections?.(); }); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? resolve(process.cwd(), ".zudo-local/article-cms");
  const running = await startArticleCms({ directory, port: Number(process.argv[3] ?? 4180) });
  console.log(`Article CMS (local only): ${running.url}/\nData: ${running.database}\nPress Ctrl+C to stop.`);
  process.on("SIGINT", () => { void running.close().then(() => process.exit(0)); });
}
