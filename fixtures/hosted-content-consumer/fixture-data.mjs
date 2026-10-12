import { createHash, randomUUID } from "node:crypto";
import { createHostedContentService } from "zudo-composer/hosted-content";

const timestamp = "2026-10-12T00:00:00.000Z";
export const fixtureActor = { id: "allowed-editor" };
export const fixtureEntry = { providerId: "content-filesystem", modelId: "page", recordId: "home" };
const faq = { providerId: "content-filesystem", modelId: "faq", recordId: "faq-initial" };
const field = (id, kind, required = true, options = {}) => ({ id, key: id, label: id === "title" ? "講座名" : id, required, kind, ...options });
const model = (id, kind, fields) => ({ id, createdAt: timestamp, updatedAt: timestamp,
  document: { schemaVersion: 1, id, name: id, description: "", kind, fields } });
const entry = (id, modelId, values) => ({ schemaVersion: 1, id, modelId, createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published", values });
export const fixtureAsset = { providerId: "assets-filesystem", assetId: "approved", versionId: "v1", checksum: "fixture-approved-svg-v1", url: "/approved.svg", label: "Approved course image" };
export function createFixtureSeed() {
  const providers = [{ providerId: fixtureEntry.providerId, models: [
    model("page", "single", [field("title", "text"), field("price", "number"), field("image", "asset-use", true, { use: "image" }),
      field("notes", "markdown", false), field("questions", "reference-list", false, { target: { providerId: fixtureEntry.providerId, recordId: "faq" }, ordered: true }), field("slug", "slug")]),
    model("faq", "collection", [field("question", "text"), field("answer", "long-text")]),
  ], entries: [entry("home", "page", { title: "日本語の講座", price: 0, notes: "安心して学べます。", slug: "fixed-home",
    image: { kind: "image", asset: { providerId: fixtureAsset.providerId, assetId: fixtureAsset.assetId }, alt: "講座の写真", decorative: false, caption: "承認済み画像" }, questions: [faq] }),
    entry(faq.recordId, faq.modelId, { question: "初回の質問", answer: "初回の回答" })] }];
  return { state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest: "initial" }, definition: "host-definition-v1", integrationFence: 0, providers },
    baselineProviders: structuredClone(providers), receipts: [], snapshots: [], publications: [] };
}
export function createFixturePolicy() {
  return { models: [
    { providerId: fixtureEntry.providerId, modelId: "page", entryIds: ["home"], fields: [
      { fieldId: "title", replace: true, clear: true }, { fieldId: "price", replace: true }, { fieldId: "notes", replace: true },
      { fieldId: "image", assetSelect: true, assetDescription: ["alt", "caption"] }] },
    { providerId: fixtureEntry.providerId, modelId: "faq", entryIds: [faq.recordId], fields: [{ fieldId: "question", replace: true }, { fieldId: "answer", replace: true }] },
  ], collections: [{ id: "questions", owner: fixtureEntry, fieldId: "questions", target: { providerId: fixtureEntry.providerId, modelId: "faq" }, create: true, add: true, reorder: true, maxItems: 12, initialValues: { question: "新しい質問", answer: "新しい回答" } }], assets: [fixtureAsset] };
}
export function createFixtureService(storage, project) {
  return createHostedContentService({ siteId: "host-fixture", definition: "host-definition-v1", storage, policy: createFixturePolicy(),
    authorize(actor) { if (actor.id !== fixtureActor.id) throw new Error("Unauthorized fixture actor"); },
    digest: async value => createHash("sha256").update(value).digest("hex"), createId: randomUUID, now: () => new Date().toISOString(),
    project, validateSubmission(snapshot) { if (snapshot.renderData.kind !== "host-offer-v1") throw new Error("Wrong host render projection"); } });
}
