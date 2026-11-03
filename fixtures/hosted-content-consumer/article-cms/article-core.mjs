// The Article CMS host's runtime-neutral core: content definition, policy, accounts, the trusted service factory
// and the Content-AI wiring. It imports only public portable Composer entries and the host renderer, so both the
// Node/SQLite host and the Worker/D1 host compose it. Hashing, ids, storage and providers are injected by each host.
import {
  EditorialError, HostedContentError, canonicalSerialize, contentAiCandidateDigest, createContentAiService, createHostedContentEditorial,
  createHostedContentService, runContentAiOperation,
} from "zudo-composer/hosted-content";
import { projectArticles } from "./render.mjs";

const timestamp = "2026-10-30T00:00:00.000Z";
export const articleProvider = "articles";
export const articleActor = { id: "article-editor" };
// The host's own accounts. `propose` may read and prepare AI proposals but never write Content.
export const articleAccounts = { "article-editor": { role: "write" }, "second-editor": { role: "write" }, "article-reviewer": { role: "propose" } };
export const articleIndex = { providerId: articleProvider, modelId: "front-page", recordId: "front" };
export const articleRef = recordId => ({ providerId: articleProvider, modelId: "article", recordId });
export const titleLimit = 80;
export const articleSiteId = "article-cms";
export const articleRoute = "journal";
export const articleRenderer = "article-site-v1";
export const articleProposalOwner = siteId => `article-cms:site:${siteId}`;

const field = (id, label, kind, required, options = {}) => ({ id, key: id, label, required, kind, ...options });
const model = (id, name, kind, fields, presentation) => ({ id, createdAt: timestamp, updatedAt: timestamp,
  document: { schemaVersion: 1, id, name, description: "", kind, fields, ...(presentation ? { presentation } : {}) } });
const entry = (id, modelId, values) => ({ schemaVersion: 1, id, modelId, createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published", values });

export function articleSeedProviders() {
  return [{ providerId: articleProvider, models: [
    // Presentation metadata is the host's grouping and list columns; the admin reads it from the model.
    model("article", "Article", "collection", [
      field("title", "Title", "text", true), field("summary", "Summary", "long-text", true),
      field("body", "Body", "markdown", false), field("author", "Author", "text", false),
    ], { groups: [{ id: "story", label: "Story", fieldIds: ["title", "summary", "body"] }, { id: "byline", label: "Byline", fieldIds: ["author"] }],
      views: [{ id: "list", label: "Article list", fieldIds: ["title", "summary"] }], inverses: [] }),
    model("front-page", "Front page", "single", [field("articles", "Articles", "reference-list", false, { target: { providerId: articleProvider, recordId: "article" }, ordered: true })]),
  ], entries: [
    entry("front", "front-page", { articles: [articleRef("welcome"), articleRef("release-notes")] }),
    entry("welcome", "article", { title: "Welcome to the journal", summary: "Why we write here.", body: "We publish short notes about our work.", author: "Editorial team" }),
    // Canonical content written before the host's 80-character title limit; history keeps it, restore refuses it.
    entry("release-notes", "article", { title: "Release notes for October: faster pages, clearer errors and a calmer editor for everyone", summary: "What changed this month.", body: "Faster pages and clearer errors.", author: "Product" }),
  ] }];
}

export function createArticlePolicy() {
  return {
    models: [{ providerId: articleProvider, modelId: "article", entryIds: [], fields: [
      { fieldId: "title", replace: true, maxLength: titleLimit }, { fieldId: "summary", replace: true },
      { fieldId: "body", replace: true, clear: true }, { fieldId: "author", replace: true, clear: true },
    ] }],
    collections: [{ id: "front-articles", owner: articleIndex, fieldId: "articles", target: { providerId: articleProvider, modelId: "article" },
      create: true, add: false, reorder: true, maxItems: 50, initialValues: { title: "Untitled article", summary: "" } }],
    assets: [],
  };
}

/** The text each host hashes (SHA-256, hex) into the definition identity and the seed content digest. */
export const articleDefinitionInput = () => canonicalSerialize({ host: "article-cms-v1", models: articleSeedProviders()[0].models.map(item => item.document), policy: createArticlePolicy() });
export const articleContentInput = providers => canonicalSerialize(providers);

export function articleSeed({ definition, contentDigest, providers = articleSeedProviders() }) {
  return { state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest }, definition, integrationFence: 0, providers },
    baselineProviders: structuredClone(providers), receipts: [], snapshots: [], publications: [], revisions: [] };
}

/**
 * The site's service for one trusted source label. A `propose` account gets the same reads and no writes,
 * so a fresh Apply or Undo is refused by the Content owner itself, not only by the AI service.
 */
export function createArticleServiceWith(storage, { definition, digest, source = "article-admin", role = "write", createId = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString() }) {
  const service = createHostedContentService({ siteId: articleSiteId, definition, storage, policy: createArticlePolicy(), source,
    authorize(actor) { if (!Object.hasOwn(articleAccounts, actor.id)) throw new Error("Unauthorized article editor"); },
    digest, createId, now,
    project: providers => projectArticles(providers),
    validateSubmission(snapshot) { if (snapshot.renderData?.kind !== "article-site-v1") throw new Error("Wrong article projection"); } });
  if (role === "write") return service;
  return { ...service, async execute() { throw new HostedContentError("forbidden", "This account may read and prepare AI proposals but not change Content."); } };
}

/** One request's Content-AI service, bound to the session the host resolved. `serviceFor(source)` is the host's site service. */
export function createArticleContentAiWith({ session, provider, store, serviceFor }) {
  return createContentAiService({
    boundary: provenance => createHostedContentEditorial({ service: serviceFor, provenance }),
    actor: { id: session.actorId },
    owner: articleProposalOwner(articleSiteId),
    proposer: provider?.proposer ?? null,
    store,
    createId: () => globalThis.crypto.randomUUID(),
    canApply: session.role === "write",
  });
}

/** What a rendered candidate acknowledges: the proposal, its exact candidate, the route, the renderer and the definition. Hosts hash this text (SHA-256, hex). */
export const candidateRenderIdentityInput = ({ proposal, definition }) => JSON.stringify({ proposalId: proposal.id, candidateDigest: proposal.candidateDigest, route: articleRoute, renderer: articleRenderer, definition });

/**
 * The site as the host renders it, with only this Entry's working values replaced by the validated candidate in
 * memory. Nothing is saved. `stale` reports a precondition that no longer matches the working Content.
 */
export async function articleCandidateRenderWith({ storage, proposal, current, identityOf }) {
  const digest = await contentAiCandidateDigest({ entry: proposal.entry, expected: proposal.expected, candidate: proposal.candidate });
  if (digest !== proposal.candidateDigest) throw new EditorialError("invalid-request", "The candidate does not match the proposal it came from.");
  const head = await storage.readHead();
  const providers = structuredClone(head.state.providers);
  const target = providers.find(item => item.providerId === proposal.entry.providerId)?.entries.find(item => item.modelId === proposal.entry.modelId && item.id === proposal.entry.recordId);
  if (!target) throw new EditorialError("not-found", "The Entry of this proposal is not part of the site.");
  target.values = structuredClone(proposal.candidate);
  const definition = head.state.definition;
  return { proposalId: proposal.id, candidateDigest: proposal.candidateDigest, route: articleRoute, renderer: articleRenderer, definition,
    identity: await identityOf({ proposal, definition }), stale: current.expected !== proposal.expected, renderData: projectArticles(providers) };
}

export const articleAiOffMessage = "New AI proposals are off on this host (started with --ai off). Saved proposals and committed results stay available.";

/**
 * One Content-AI operation for the resolved session over one storage handle. Status and reads never call the model.
 * A rendered candidate is acknowledged by its render identity, which this host recomputes for the proposal, route,
 * renderer and definition it serves now; only then does the service see the candidate digest.
 */
export async function runArticleContentAi({ storage, session, provider, store, serviceFor, identityOf, operation, payload }) {
  try {
    const service = createArticleContentAiWith({ session, provider, store, serviceFor });
    if (operation === "content-ai-apply" && payload && typeof payload === "object" && typeof payload.renderedCandidate === "string") {
      const { proposal } = await service.read({ proposalId: payload.proposalId });
      const identity = await identityOf({ proposal, definition: (await storage.readHead()).state.definition });
      payload = { ...payload, renderedCandidate: payload.renderedCandidate === identity ? proposal.candidateDigest : "unrendered" };
    }
    return await runContentAiOperation({
      status: async () => ({ configured: true, provider: provider?.label ?? "Off", canApply: session.role === "write",
        // Off is reported without probing anything: no provider exists in this host.
        inference: provider ? await provider.inference() : { state: "unavailable", code: "off", message: articleAiOffMessage } }),
      service: async () => service,
    }, operation, payload);
  } catch (error) {
    if (error instanceof EditorialError) return { ok: false, error: { code: error.code, message: error.message, diagnostics: error.diagnostics } };
    throw error;
  }
}

/** The candidate render data for one proposal of the session, never saved. */
export async function readArticleCandidate({ storage, session, provider, store, serviceFor, identityOf, proposalId }) {
  const service = createArticleContentAiWith({ session, provider, store, serviceFor });
  const { proposal } = await service.read({ proposalId });
  const current = await createHostedContentEditorial({ service: serviceFor, provenance: { actor: { id: session.actorId }, source: "article-admin" } })
    .readEntry({ entry: proposal.entry, perspective: "working" });
  return articleCandidateRenderWith({ storage, proposal, current, identityOf });
}
