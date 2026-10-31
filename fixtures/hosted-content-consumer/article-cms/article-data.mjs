// The Article CMS host's own content definition, policy and trusted service. Host code, never tool code:
// the tool contributes only createHostedContentService and its public types.
import { createHash, randomUUID } from "node:crypto";
import { canonicalSerialize, createHostedContentService } from "zudo-composer/hosted-content";
import { projectArticles } from "./render.mjs";

const timestamp = "2026-10-30T00:00:00.000Z";
export const articleProvider = "articles";
export const articleActor = { id: "article-editor" };
export const articleIndex = { providerId: articleProvider, modelId: "front-page", recordId: "front" };
export const articleRef = recordId => ({ providerId: articleProvider, modelId: "article", recordId });
export const titleLimit = 80;

const field = (id, label, kind, required, options = {}) => ({ id, key: id, label, required, kind, ...options });
const model = (id, name, kind, fields, presentation) => ({ id, createdAt: timestamp, updatedAt: timestamp,
  document: { schemaVersion: 1, id, name, description: "", kind, fields, ...(presentation ? { presentation } : {}) } });
const entry = (id, modelId, values) => ({ schemaVersion: 1, id, modelId, createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published", values });

export function createArticleSeed() {
  const providers = [{ providerId: articleProvider, models: [
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
  const definition = createHash("sha256").update(canonicalSerialize({ host: "article-cms-v1", models: providers[0].models.map(item => item.document), policy: createArticlePolicy() })).digest("hex");
  const contentDigest = createHash("sha256").update(canonicalSerialize(providers)).digest("hex");
  return { state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest }, definition, integrationFence: 0, providers },
    baselineProviders: structuredClone(providers), receipts: [], snapshots: [], publications: [], revisions: [] };
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

export function createArticleService(storage) {
  return createHostedContentService({ siteId: "article-cms", definition: createArticleSeed().state.definition, storage, policy: createArticlePolicy(),
    source: "article-admin",
    authorize(actor) { if (actor.id !== articleActor.id) throw new Error("Unauthorized article editor"); },
    digest: async value => createHash("sha256").update(value).digest("hex"), createId: randomUUID, now: () => new Date().toISOString(),
    project: providers => projectArticles(providers),
    validateSubmission(snapshot) { if (snapshot.renderData?.kind !== "article-site-v1") throw new Error("Wrong article projection"); } });
}
