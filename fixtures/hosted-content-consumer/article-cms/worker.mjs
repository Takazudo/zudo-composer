/* global Response */
// Worker composition root for the Article CMS on local D1. Runtime code: it imports only public portable Composer
// entries, the host's runtime-neutral modules and the admin bytes bundled during preparation. No node:*, SQLite,
// filesystem, child processes, hosted-content/node or private Composer modules; no source compiler per request.
//
// Authentication here is an explicitly local fixture mechanism, not production login: the Worker refuses every
// request unless the trusted host binding declares `sessionMode: "local-fixture"`. There is no anonymous fallback.
import uiFiles from "article-cms:ui-files";
import { createFakeContentAiProposer } from "zudo-composer/hosted-content";
import { createD1HostedStorage, createD1ProposalStore } from "../d1-storage.mjs";
import { articleErrorResponse, createArticleApi, invalidRequest } from "./api.mjs";
import {
  articleAccounts, articleDefinitionInput, articleProposalOwner, articleSiteId, candidateRenderIdentityInput, createArticleServiceWith,
  readArticleCandidate, runArticleContentAi,
} from "./article-core.mjs";
import { advanceArticlePublication, readArticleArtifact, resumeArticlePublication, sha256Hex } from "./d1-article.mjs";

const files = new Map(Object.entries(uiFiles));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
let definition;

/** The trusted host configuration binding. Anything else, including a missing binding, refuses every request. */
function readHostConfig(env) {
  const config = env.ARTICLE_HOST;
  if (!config || config.sessionMode !== "local-fixture") fail("configuration-required", "This Worker has no trusted session configuration; it serves only the explicit local fixture session mode.");
  if (config.siteId !== articleSiteId) fail("configuration-required", "The configured site is not this Article site.");
  if (!["fake", "off"].includes(config.ai)) fail("configuration-required", "The Worker host supports only the fake and off Content-AI modes.");
  const valid = session => session && Object.hasOwn(articleAccounts, session.actorId) && [articleAccounts[session.actorId].role, "propose"].includes(session.role);
  if (!valid(config.localEditor)) fail("configuration-required", "The local fixture editor must be a host account.");
  for (const session of Object.values(config.sessions ?? {})) if (!valid(session) || typeof session.siteId !== "string") fail("configuration-required", "Every fixture session names a host account, its role and its site.");
  if (!Array.isArray(config.allowedHosts) || config.allowedHosts.length === 0) fail("configuration-required", "The local fixture needs its loopback host names.");
  return config;
}

/** Resolve the actor from the trusted configuration; the request never names an actor, site or role. */
function resolveSession(request, config) {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return { actorId: config.localEditor.actorId, role: config.localEditor.role };
  const bearer = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(authorization)?.[1];
  const session = bearer && Object.hasOwn(config.sessions ?? {}, bearer) ? config.sessions[bearer] : null;
  if (!session) throw Object.assign(new Error("Unknown session"), { code: "forbidden", status: 401 });
  if (session.siteId !== config.siteId) throw Object.assign(new Error("This session belongs to another site."), { code: "forbidden", status: 403 });
  return { actorId: session.actorId, role: session.role };
}

const fakeProvider = () => {
  const proposer = createFakeContentAiProposer();
  return { kind: "fake", label: proposer.label, proposer,
    inference: async () => ({ state: "ready", detail: "Offline deterministic fake: it never contacts a model, and its output is not evidence of model behavior." }) };
};

const respond = (status, body, type = "application/json; charset=utf-8") => new Response(typeof body === "string" ? body : JSON.stringify(body),
  { status, headers: { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export default {
  async fetch(request, env, context) {
    try {
      const config = readHostConfig(env);
      const url = new URL(request.url);
      if (!config.allowedHosts.includes(url.host)) return respond(421, { code: "invalid-request", message: "Unexpected Host" });
      const origin = request.headers.get("origin");
      if (request.method === "POST" && origin && !config.allowedHosts.includes(new URL(origin).host)) return respond(403, { code: "forbidden", message: "Cross-origin write" });
      const session = resolveSession(request, config);
      const proofFaults = env.ARTICLE_PROOF_FAULTS ?? {};
      definition ??= await sha256Hex(articleDefinitionInput());
      const db = env.DB;
      // A fresh adapter per request: no state is carried between requests in this isolate.
      const storage = createD1HostedStorage(db);
      const store = createD1ProposalStore(db, { owner: articleProposalOwner(articleSiteId) });
      const provider = config.ai === "fake" ? fakeProvider() : null;
      const serviceFor = role => source => createArticleServiceWith(storage, { definition, digest: sha256Hex, source, role });
      const hostService = () => serviceFor("write")("article-admin");
      const publication = { db, storage, faults: proofFaults };
      // The persisted publication record is the intent: any request resumes an unfinished one after a restart.
      context.waitUntil(resumeArticlePublication({ ...publication, service: hostService() }).catch(() => undefined));
      const aiContext = { storage, session, provider, store, serviceFor: serviceFor(session.role), identityOf: input => sha256Hex(candidateRenderIdentityInput(input)) };
      const api = createArticleApi({
        files,
        host: { backend: "worker-d1", label: "Worker + local D1", local: true, deployed: false, sessionMode: "local-fixture", ai: provider ? provider.label : "Off" },
        withService: async (resolved, work) => work(serviceFor(resolved.role)("article-admin"), storage),
        contentAi: (_session, operation, payload) => runArticleContentAi({ ...aiContext, operation, payload }),
        candidate: (_session, proposalId) => readArticleCandidate({ ...aiContext, proposalId }),
        artifact: id => readArticleArtifact(db, id),
        submitted: id => { context.waitUntil(advanceArticlePublication({ ...publication, service: hostService(), publicationId: id }).catch(() => undefined)); },
      });
      const readJson = async () => {
        const text = await request.text();
        if (text.length > 1_000_000) throw invalidRequest("Request exceeds size limit");
        try { return JSON.parse(text); } catch { throw invalidRequest("Request body is not JSON"); }
      };
      const result = await api({ method: request.method, path: url.pathname, searchParams: url.searchParams, session, readJson });
      return respond(result.status, result.body, result.type);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return respond(error.status, { code: error.code, message: error.message });
      if (error?.code === "configuration-required") return respond(503, { code: error.code, message: error.message });
      const { status, body } = articleErrorResponse(error);
      return respond(status, body);
    }
  },
};
