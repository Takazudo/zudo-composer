// Host-owned Content-AI wiring for the Article CMS: the durable proposal store, the per-request service and the
// candidate render data. The tool contributes only public exports; actor, site, policy, store and renderer are
// host decisions, and nothing here takes them from a request or a model reply.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { EditorialError, contentAiCandidateDigest, createContentAiService, createHostedContentEditorial } from "zudo-composer/hosted-content";
import { articleSiteId, createArticleService } from "./article-data.mjs";
import { projectArticles } from "./render.mjs";

export const articleRoute = "journal";
export const articleRenderer = "article-site-v1";
export const articleProposalOwner = siteId => `article-cms:site:${siteId}`;

const SCHEMA = `CREATE TABLE IF NOT EXISTS article_content_ai_proposal (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK (json_valid(body))
)`;

/**
 * Create-only proposal records in the site's own SQLite file, beside (never inside) the Content tables. A record
 * holds no editable Content: whether it was applied or undone is read from the Hosted Content receipts.
 */
export function openArticleProposalStore(filename) {
  const using = work => {
    const connection = new DatabaseSync(filename, { timeout: 5_000 });
    try { connection.exec("PRAGMA synchronous = FULL;"); return work(connection); } finally { connection.close(); }
  };
  using(connection => connection.exec(SCHEMA));
  return {
    async create(record) {
      using(connection => {
        try {
          connection.prepare("INSERT INTO article_content_ai_proposal (id, owner, actor_id, created_at, body) VALUES (?, ?, ?, ?, ?)")
            .run(record.proposal.id, record.owner, record.actorId, record.proposal.createdAt, JSON.stringify(record));
        } catch (error) {
          // The primary key refuses a second record with this id; an existing record is never replaced.
          if (error?.code === "ERR_SQLITE_ERROR" && (error.errcode & 0xff) === 19) throw new EditorialError("operation-key-reuse", "A proposal with this id already exists.");
          throw new EditorialError("unavailable", "The proposal could not be stored.");
        }
      });
    },
    async read(id) {
      return using(connection => {
        const row = connection.prepare("SELECT owner, actor_id, body FROM article_content_ai_proposal WHERE id = ?").get(id);
        if (!row) return null;
        const record = JSON.parse(row.body);
        // The indexed columns and the record must agree; a tampered row is preserved and refused.
        if (record?.schemaVersion !== 1 || record.proposal?.id !== id || record.owner !== row.owner || record.actorId !== row.actor_id) throw new EditorialError("unavailable", "A stored proposal has an unexpected shape; it was preserved.");
        return record;
      });
    },
  };
}

/** One request's Content-AI service, bound to the session the host resolved. */
export function createArticleContentAi({ storage, session, provider, store }) {
  return createContentAiService({
    boundary: provenance => createHostedContentEditorial({ service: source => createArticleService(storage, { source, role: session.role }), provenance }),
    actor: { id: session.actorId },
    owner: articleProposalOwner(articleSiteId),
    proposer: provider?.proposer ?? null,
    store,
    createId: () => globalThis.crypto.randomUUID(),
    canApply: session.role === "write",
  });
}

/** What a rendered candidate acknowledges: the proposal, its exact candidate, the route, the renderer and the definition. */
export function candidateRenderIdentity({ proposal, definition }) {
  return createHash("sha256").update(JSON.stringify({ proposalId: proposal.id, candidateDigest: proposal.candidateDigest, route: articleRoute, renderer: articleRenderer, definition })).digest("hex");
}

/**
 * The site as the host renders it, with only this Entry's working values replaced by the validated candidate in
 * memory. Nothing is saved. `stale` reports a precondition that no longer matches the working Content.
 */
export async function articleCandidateRender({ storage, proposal, current }) {
  const digest = await contentAiCandidateDigest({ entry: proposal.entry, expected: proposal.expected, candidate: proposal.candidate });
  if (digest !== proposal.candidateDigest) throw new EditorialError("invalid-request", "The candidate does not match the proposal it came from.");
  const head = await storage.readHead();
  const providers = structuredClone(head.state.providers);
  const entry = providers.find(item => item.providerId === proposal.entry.providerId)?.entries.find(item => item.modelId === proposal.entry.modelId && item.id === proposal.entry.recordId);
  if (!entry) throw new EditorialError("not-found", "The Entry of this proposal is not part of the site.");
  entry.values = structuredClone(proposal.candidate);
  const definition = head.state.definition;
  return { proposalId: proposal.id, candidateDigest: proposal.candidateDigest, route: articleRoute, renderer: articleRenderer, definition,
    identity: candidateRenderIdentity({ proposal, definition }), stale: current.expected !== proposal.expected, renderData: projectArticles(providers) };
}
