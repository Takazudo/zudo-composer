// @ts-check
/* global Response, URL */
// A Worker-style module: `export default { fetch }` over the portable public
// entries only. It owns the trusted policy and actor; the request body is
// untrusted JSON naming stable ids and the revision it was prepared against.
import { compileSiteProjectPlan, validateSiteProject } from "zudo-composer/content";
import { applyHostContentRequest, createMemoryContentDraftStorage, projectWithContentSnapshot, readHostContentReceipt } from "zudo-composer/host-storage";
import { ACTOR, BASELINE_REVISION, componentPack, policy, project } from "./site.mjs";

/** @typedef {import("zudo-composer/host-storage").ContentDraftStorageAdapter} ContentDraftStorageAdapter */

const validated = validateSiteProject(project, { componentPack: componentPack.manifest });
if (!validated.ok) throw new Error(`Fixture project is invalid: ${JSON.stringify(validated.diagnostics)}`);
const siteProject = validated.project;

// Authoring routes and structural writes the client role never reaches.
const REFUSED = /^\/(?:composer|mapping|sitemapper|assets|content\/schema|api\/(?:models|schema|upload|assets))(?:\/|$)/;

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/** @param {Request} request */
async function body(request) {
  try { return /** @type {Record<string, unknown>} */ (await request.json()); }
  catch { return null; }
}

/** @param {{ actor?: { subject: string }, storage?: ContentDraftStorageAdapter }} [options] */
export function createHostedContentService(options = {}) {
  const actor = options.actor ?? ACTOR;
  /** @type {Promise<ContentDraftStorageAdapter> | null} */
  let adapter = options.storage ? Promise.resolve(options.storage) : null;
  const storage = () => (adapter ??= createMemoryContentDraftStorage({ project: siteProject, baselineRevision: BASELINE_REVISION }));

  return {
    /** @param {Request} request */
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (REFUSED.test(path)) return json({ status: "forbidden", message: `${path} is not available to the content editor.` }, 403);
      const store = await storage();
      if (request.method === "GET" && path === "/api/draft") return json(await store.readDraft());
      if (request.method === "POST" && path === "/api/apply") {
        const input = await body(request);
        if (!input || typeof input.operationId !== "string" || typeof input.expectedBaselineRevision !== "string") return json({ status: "refused", refusal: { ok: false, code: "malformed-request", message: "Malformed apply body." } }, 400);
        return json(await applyHostContentRequest(store, { operationId: input.operationId, request: input.request, expectedBaselineRevision: input.expectedBaselineRevision }, { policy, actor }));
      }
      const receipt = /^\/api\/receipts\/([^/]+)$/.exec(path);
      if (request.method === "GET" && receipt) return json(await readHostContentReceipt(store, decodeURIComponent(receipt[1] ?? ""), actor));
      if (request.method === "POST" && path === "/api/snapshot") {
        const input = await body(request);
        if (!input || !Number.isSafeInteger(input.expectedDraftRevision)) return json({ status: "rejected", code: "validation", message: "expectedDraftRevision is required." }, 400);
        return json(await store.snapshot({ expectedDraftRevision: /** @type {number} */ (input.expectedDraftRevision) }));
      }
      if (request.method === "GET" && path === "/api/routes") {
        const draft = await store.readDraft();
        if (draft.status !== "ok") return json(draft, 503);
        const plan = await compileSiteProjectPlan(projectWithContentSnapshot(siteProject, draft.value.snapshot), componentPack.manifest);
        return json(plan.status === "ready" ? { status: "ok", routes: plan.plan.routes.map((route) => route.pathname) } : plan);
      }
      return json({ status: "not-found" }, 404);
    },
  };
}

const service = createHostedContentService();

export default {
  /** @param {Request} request */
  fetch(request) { return service.fetch(request); },
};
