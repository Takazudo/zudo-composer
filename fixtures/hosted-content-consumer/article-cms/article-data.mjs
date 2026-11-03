// The Article CMS host's own content definition, policy and trusted service, for the Node host. Host code,
// never tool code. The runtime-neutral definition lives in article-core.mjs; this module adds Node hashing.
import { createHash } from "node:crypto";
import { articleContentInput, articleDefinitionInput, articleSeed, articleSeedProviders, createArticleServiceWith } from "./article-core.mjs";

export { articleAccounts, articleActor, articleIndex, articleProvider, articleRef, articleSiteId, createArticlePolicy, titleLimit } from "./article-core.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");

export function createArticleSeed() {
  const providers = articleSeedProviders();
  return articleSeed({ definition: sha256(articleDefinitionInput()), contentDigest: sha256(articleContentInput(providers)), providers });
}

/**
 * The site's service for one trusted source label. A `propose` account gets the same reads and no writes,
 * so a fresh Apply or Undo is refused by the Content owner itself, not only by the AI service.
 */
export function createArticleService(storage, { source = "article-admin", role = "write" } = {}) {
  return createArticleServiceWith(storage, { definition: createArticleSeed().state.definition, digest: async value => sha256(value), source, role });
}
