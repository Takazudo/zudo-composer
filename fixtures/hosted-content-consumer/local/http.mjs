// Loopback HTTP surface of the local host. It serves the shell, the preview frame, the browser transport
// endpoints of the public service, local artifact listings and the immutable artifact files.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const conflictCodes = ["revision-conflict", "baseline-conflict", "definition-conflict", "operation-key-reuse", "publication-busy"];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };

const shellDocument = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local Hosted Content</title><link rel="stylesheet" href="/shell.css"><style>
body{margin:0;font-family:system-ui,sans-serif;color:#1c2730;background:#f6f7f8}
.local-banner{padding:.75rem 1rem;background:#fff4d6;border-bottom:2px solid #c99a1a}
.local-banner code,.local-note code{word-break:break-all}
.local-layout{display:grid;gap:1rem;padding:1rem;grid-template-columns:minmax(0,1fr)}
@media (min-width:64rem){.local-layout{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.local-artifacts{grid-column:1/-1}}
.local-layout>section{background:#fff;border:1px solid #d5dbe0;border-radius:.5rem;padding:1rem;min-width:0}
#preview{width:100%;height:32rem;border:1px solid #d5dbe0;background:#fff}
#artifact-list li{margin-block:.5rem}
</style></head><body>
<header class="local-banner" role="note"><strong>Local only.</strong> This host runs on your machine. Nothing here is live, deployed or in production.
<span class="local-note">Data: <code id="data-location"></code></span></header>
<p id="local-status" role="status" hidden></p>
<main class="local-layout">
<section aria-labelledby="editor-heading"><h2 id="editor-heading">Edit</h2><div id="editor"></div></section>
<section aria-labelledby="preview-heading"><h2 id="preview-heading">Preview of the saved snapshot</h2><p id="preview-identity"></p>
<iframe id="preview" title="Saved snapshot preview"></iframe></section>
<section class="local-artifacts" aria-labelledby="artifacts-heading"><h2 id="artifacts-heading">Local artifacts</h2>
<p class="local-note">Generated on this machine under <code id="artifact-location"></code>. A local artifact is a file you can open; it is not a live or production site.</p>
<ul id="artifact-list"></ul></section>
</main><script type="module" src="/shell.js"></script></body></html>`;
async function readJson(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw Object.assign(new Error("Request exceeds size limit"), { code: "invalid-request" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); }
  catch { throw Object.assign(new Error("Request body is not JSON"), { code: "invalid-request" }); }
}

/**
 * `withService` opens an independent SQLite handle per request and passes the service built by the
 * composition root; the actor is the root's fixed local identity, never a request value.
 */
export function createLocalHttpServer({ withService, actor, policy, presentation, publisher, ui, renderer, log }) {
  let allowedHosts = new Set();
  const origins = new Map();
  const artifactOrigin = id => {
    if (!origins.has(id)) origins.set(id, (async () => {
      let hosts = new Set();
      const site = createServer(async (request, response) => {
        const fail = status => response.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(status === 404 ? "Not found in this local artifact" : "Rejected");
        try {
          if (!hosts.has(request.headers.host ?? "") || request.method !== "GET") { fail(421); return; }
          const filename = await publisher.artifacts.resolveSiteFile(id, decodeURIComponent(new URL(request.url, "http://localhost").pathname));
          if (!filename) { fail(404); return; }
          response.writeHead(200, { "content-type": types[extname(filename)] ?? "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" })
            .end(await readFile(filename));
        } catch { if (!response.headersSent) fail(404); }
      });
      await new Promise((ready, reject) => { site.once("error", reject); site.listen(0, "127.0.0.1", ready); });
      const port = site.address().port;
      hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      return { site, origin: `http://127.0.0.1:${port}` };
    })());
    return origins.get(id).then(entry => entry.origin);
  };
  const server = createServer(async (request, response) => {
    const send = (status, body, type = types[".json"]) => response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" })
      .end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    try {
      // Loopback only: reject other Host names (DNS rebinding) and cross-site writes.
      if (!allowedHosts.has(request.headers.host ?? "")) { send(421, { code: "invalid-request", message: "Unexpected Host" }); return; }
      if (request.method === "POST" && request.headers.origin && !allowedHosts.has(new URL(request.headers.origin).host)) { send(403, { code: "forbidden", message: "Cross-origin write" }); return; }
      const url = new URL(request.url, "http://localhost");
      const path = url.pathname;
      if (request.method === "GET" && (path === "/" || path === "/index.html")) { send(200, shellDocument, types[".html"]); return; }
      if (request.method === "GET" && ui.has(path)) { send(200, ui.get(path), types[extname(path)]); return; }
      if (path.startsWith("/local-artifacts/")) {
        // Each artifact is the renderer's unmodified root-relative site, so it opens on its own loopback origin.
        const [, , id, ...rest] = path.split("/");
        const manifest = request.method === "GET" && id ? await publisher.artifacts.readManifest(decodeURIComponent(id)).catch(() => null) : null;
        if (!manifest) { send(404, { code: "not-found", message: "No such local artifact" }); return; }
        const origin = await artifactOrigin(manifest.publicationId);
        response.writeHead(302, { location: `${origin}/${rest.join("/")}${url.search}`, "cache-control": "no-store" }).end();
        return;
      }
      if (path.startsWith("/api/")) {
        let result;
        if (request.method === "GET" && path === "/api/policy") result = policy;
        else if (request.method === "GET" && path === "/api/presentation") result = presentation;
        else if (request.method === "GET" && path === "/api/local/publications") result = await publisher.list();
        else if (request.method === "GET" && path === "/api/local/artifact") {
          const id = url.searchParams.get("id") ?? "";
          const manifest = await publisher.artifacts.readManifest(id);
          if (!manifest) throw Object.assign(new Error("No such local artifact"), { code: "not-found" });
          result = { manifest, snapshot: await publisher.artifacts.readSnapshot(id) };
        }
        else if (request.method === "POST" && path === "/api/local/publications/retry") {
          const body = await readJson(request);
          publisher.advance(body?.publicationId).catch(() => undefined);
          result = { accepted: true };
        } else if (request.method === "GET" && path === "/api/state") result = await withService(service => service.readState(actor));
        else if (request.method === "GET" && path === "/api/receipt") result = await withService(service => service.readReceipt(actor, url.searchParams.get("key")));
        else if (request.method === "GET" && path === "/api/publication") result = await withService(service => service.getPublication(actor, url.searchParams.get("id")));
        else if (request.method === "POST" && path === "/api/execute") {
          const command = await readJson(request);
          result = await withService(service => service.execute(actor, command));
          // The accepted operation and receipt are committed; local publication follows it and its
          // failures are reported as publication status, never as a failure of this response.
          if (command?.kind === "begin-publication" && result.publication) publisher.advance(result.publication.id).catch(() => undefined);
        } else { send(404, { code: "not-found", message: "Unknown local endpoint" }); return; }
        send(200, result);
        return;
      }
      const file = request.method === "GET" ? await renderer.previewFile(path) : null;
      if (file) { send(200, file, types[extname(path)] ?? "application/octet-stream"); return; }
      send(404, { code: "not-found", message: "Not found" });
    } catch (error) {
      if (!error.code) log(`request ${request.method} ${request.url}: ${error.stack ?? error}`);
      if (!response.headersSent) send(conflictCodes.includes(error.code) ? 409 : error.code ? 400 : 500,
        { code: error.code ?? "local-host-error", message: error.message, diagnostics: error.diagnostics });
    }
  });
  return {
    server,
    async listen(port) {
      await new Promise((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); ready(); }); });
      const actual = server.address().port;
      allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
      return actual;
    },
    async close() {
      for (const pending of origins.values()) {
        const { site } = await pending;
        await new Promise(ready => { site.close(() => ready()); site.closeAllConnections?.(); });
      }
      await new Promise((ready, reject) => { server.close(error => error ? reject(error) : ready()); server.closeAllConnections?.(); });
    },
  };
}
