// The Article CMS HTTP contract, shared by the Node/SQLite host and the Worker/D1 host. Runtime-neutral: each host
// resolves the session, opens its own storage and supplies its own artifact reader and publication trigger; this
// module only maps routes to the public services and errors to statuses. Transport concerns (Host/Origin checks,
// sockets, proof faults) stay in each host.
import { EditorialError } from "zudo-composer/hosted-content";
import { createArticlePolicy } from "./article-core.mjs";
import { projectArticles } from "./render.mjs";

export const articleShell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Article CMS</title><link rel="stylesheet" href="/app.css"></head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

const conflicts = new Set(["revision-conflict", "baseline-conflict", "definition-conflict", "operation-key-reuse", "publication-busy"]);
const editorialStatus = { "invalid-request": 400, "invalid-value": 400, forbidden: 403, "not-found": 404, "revision-conflict": 409, "operation-key-reuse": 409,
  "restore-incompatible": 422, "configuration-required": 503, unavailable: 503 };
// Storage outcomes from a host adapter. An unknown outcome is never reported as a conflict or a refusal.
const storageStatus = { "storage-limit": 413, "storage-failed": 503, "storage-outcome-unknown": 503 };

export const invalidRequest = message => Object.assign(new Error(message), { code: "invalid-request" });

export function articleErrorResponse(error) {
  const status = error instanceof EditorialError ? editorialStatus[error.code] ?? 500 : storageStatus[error?.code] ?? (conflicts.has(error?.code) ? 409
    : error?.code === "restore-incompatible" ? 422 : error?.code === "forbidden" ? 403 : error?.code ? 400 : 500);
  return { status, body: { code: error?.code ?? "article-host-error", message: error?.message ?? String(error), diagnostics: error?.diagnostics, restoreDiagnostics: error?.restoreDiagnostics } };
}

/**
 * `withService(session, work)` runs `work(service, storage)` on a fresh storage handle; `contentAi` and `candidate`
 * run one Content-AI operation; `artifact(id)` returns local artifact HTML or null; `submitted(publicationId)` starts
 * (or resumes) the host's local publication. `host` is the public status shown in the admin header.
 */
export function createArticleApi({ files, host, withService, contentAi, candidate, artifact, submitted }) {
  return async function handle({ method, path, searchParams, session, readJson }) {
    const actor = { id: session.actorId };
    const json = (body, status = 200) => ({ status, body, type: "application/json; charset=utf-8" });
    if (path === "/api/ai" || path === "/api/ai/candidate") {
      if (method === "GET" && path === "/api/ai/candidate") return json(await candidate(session, searchParams.get("id")));
      if (method !== "POST") return json({ code: "invalid-request", message: "Use POST" }, 405);
      const body = await readJson();
      if (!body || typeof body !== "object" || typeof body.operation !== "string" || Object.keys(body).some(key => key !== "operation" && key !== "payload")) throw invalidRequest("Malformed Content-AI request");
      return { ...json(await contentAi(session, body.operation, body.payload ?? {})), aiOperation: body.operation };
    }
    const q = () => { try { return JSON.parse(searchParams.get("q") ?? "null"); } catch { throw invalidRequest("Query is not JSON"); } };
    if (method === "GET" && path === "/") return { status: 200, body: articleShell, type: "text/html; charset=utf-8" };
    if (method === "GET" && files.has(path)) return { status: 200, body: files.get(path), type: path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" };
    if (method === "GET" && path.startsWith("/artifacts/")) {
      const id = path.split("/")[2] ?? "";
      const html = /^[A-Za-z0-9-]{1,80}$/.test(id) ? await artifact(id) : null;
      if (html === null) return json({ code: "not-found", message: "No such artifact" }, 404);
      return { status: 200, body: html, type: "text/html; charset=utf-8" };
    }
    const reads = {
      "/api/host": () => host,
      "/api/policy": () => createArticlePolicy(),
      "/api/state": service => service.readState(actor),
      "/api/receipt": service => service.readReceipt(actor, searchParams.get("key")),
      "/api/publication": service => service.getPublication(actor, searchParams.get("id")),
      "/api/models": service => service.listModels(actor),
      "/api/entries": service => service.listEntries(actor, q()),
      "/api/entry": service => service.readEntry(actor, q()),
      "/api/revisions": service => service.listRevisions(actor, q()),
      "/api/revision": service => service.readRevision(actor, searchParams.get("id")),
      "/api/compare": service => service.compareRevisions(actor, q()),
      "/api/publication-status": service => service.readPublicationStatus(actor),
      // Host-owned: the activated baseline projected for the published preview, with its identity.
      "/api/published-site": async (_service, storage) => {
        const head = await storage.readHead();
        return { baseline: head.state.baseline, integrationFence: head.state.integrationFence, renderData: projectArticles(head.baselineProviders) };
      },
    };
    if (method === "GET" && reads[path]) return json(await withService(session, reads[path]));
    if (method === "POST" && path === "/api/execute") {
      const command = await readJson();
      const result = await withService(session, service => service.execute(actor, command));
      if (result.publication?.status === "submitted") await submitted(result.publication.id);
      return json(result);
    }
    return json({ code: "not-found", message: "Not found" }, 404);
  };
}
