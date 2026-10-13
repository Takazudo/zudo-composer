import { createHash, randomUUID } from "node:crypto";
import { createHostedContentService, canonicalSerialize } from "zudo-composer/hosted-content";
import { CONTRACT_VERSION } from "@zudo-composer/component-contract";
import { fixedHostDefinition } from "./renderer/src/project.ts";
import { hostPack, hostRenderer } from "./renderer/src/identity.ts";

const timestamp = "2026-10-12T00:00:00.000Z";
export const fixtureActor = { id: "allowed-editor" };
export const fixtureEntry = { providerId: "content-filesystem", modelId: "page", recordId: "home" };
const faq = { providerId: "content-filesystem", modelId: "faq", recordId: "faq-initial" };
export const fixtureDetachedFaq = { ...faq, recordId: "faq-detached" };
const field = (id, kind, required = true, options = {}) => ({ id, key: id, label: id === "title" ? "講座名" : id, required, kind, ...options });
const model = (id, kind, fields) => ({ id, createdAt: timestamp, updatedAt: timestamp,
  document: { schemaVersion: 1, id, name: id, description: "", kind, fields } });
const entry = (id, modelId, values) => ({ schemaVersion: 1, id, modelId, createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published", values });
export const fixtureAsset = { providerId: "assets-filesystem", assetId: "approved", versionId: "v1", checksum: "98341f749915a496670a188d1f6ae9d75a6401bf9ecfbb9a203e84519c4af692", url: "/approved.svg", label: "Approved course image" };
export const fixtureAlternateAsset = { ...fixtureAsset, assetId: "approved-alternate", checksum: "75e43e09733ec6c580840e22e0a2368fc4e7098e863f1b5e755f7fe428b5154f", url: "/approved-alternate.svg", label: "Approved blue course image" };
export function createFixtureSeed() {
  const providers = [{ providerId: fixtureEntry.providerId, models: [
    model("page", "single", [field("title", "text"), field("price", "number"), field("image", "asset-use", true, { use: "image" }),
      field("notes", "markdown", false), field("questions", "reference-list", false, { target: { providerId: fixtureEntry.providerId, recordId: "faq" }, ordered: true }), field("slug", "slug")]),
    model("faq", "collection", [field("question", "text"), field("answer", "long-text")]),
  ], entries: [entry("home", "page", { title: "日本語の講座", price: 0, notes: "## 安心して学べます\n\n**日本語の説明**を読み、[詳しい案内](https://example.com/course)をご確認ください。", slug: "fixed-home",
    image: { kind: "image", asset: { providerId: fixtureAsset.providerId, assetId: fixtureAsset.assetId }, alt: "講座の写真", decorative: false, caption: "承認済み画像" }, questions: [faq] }),
    entry(faq.recordId, faq.modelId, { question: "初回の質問", answer: "初回の回答" }),
    entry(fixtureDetachedFaq.recordId, faq.modelId, { question: "追加できる既存の質問", answer: "許可された独立した回答" })] }];
  const definition = createHash("sha256").update(canonicalSerialize({ project: fixedHostDefinition,
    models: providers.flatMap(provider => provider.models.map(model => ({ providerId: provider.providerId, document: model.document }))),
    policy: createFixturePolicy(), pack: hostPack, renderer: hostRenderer, contractVersion: CONTRACT_VERSION })).digest("hex");
  const contentDigest = createHash("sha256").update(canonicalSerialize(providers)).digest("hex");
  return { state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest }, definition, integrationFence: 0, providers },
    baselineProviders: structuredClone(providers), receipts: [], snapshots: [], publications: [] };
}
export function createFixturePolicy() {
  return { models: [
    { providerId: fixtureEntry.providerId, modelId: "page", entryIds: ["home"], fields: [
      { fieldId: "title", replace: true, clear: true }, { fieldId: "price", replace: true }, { fieldId: "notes", replace: true },
      { fieldId: "image", assetSelect: true, assetDescription: ["alt", "caption"] }] },
    { providerId: fixtureEntry.providerId, modelId: "faq", entryIds: [faq.recordId, fixtureDetachedFaq.recordId], fields: [{ fieldId: "question", replace: true }, { fieldId: "answer", replace: true }] },
  ], collections: [{ id: "questions", owner: fixtureEntry, fieldId: "questions", target: { providerId: fixtureEntry.providerId, modelId: "faq" }, create: true, add: true, reorder: true, maxItems: 12, initialValues: { question: "新しい質問", answer: "新しい回答" } }], assets: [fixtureAsset, fixtureAlternateAsset] };
}
export function createFixtureService(storage, project) {
  return createHostedContentService({ siteId: "host-fixture", definition: createFixtureSeed().state.definition, storage, policy: createFixturePolicy(),
    authorize(actor) { if (actor.id !== fixtureActor.id) throw new Error("Unauthorized fixture actor"); },
    digest: async value => createHash("sha256").update(value).digest("hex"), createId: randomUUID, now: () => new Date().toISOString(),
    project, validateSubmission(snapshot) { if (snapshot.renderData.kind !== "host-offer-v1") throw new Error("Wrong host render projection"); } });
}
