import { createHash } from "node:crypto";
import { createContentEntryRecord, createContentModelRecord } from "../../content/library/helpers";
import type { ContentFieldDefinition, ContentValueSchema } from "../../content/model/types";
import { createHostedContentService } from "../service";
import type { HostedCommand, HostedDatabase, HostedPolicy, HostedStorage, HostedTransport, JsonValue } from "../types";
const stamp = "2026-01-01T00:00:00.000Z";
export const page = { providerId: "content", modelId: "page", recordId: "home" };
export const faq = { providerId: "content", modelId: "faq", recordId: "faq-a" };
const field = (id: string, schema: ContentValueSchema, required = false): ContentFieldDefinition => ({ id, key: id, label: id === "title" ? "講座名" : id, required, ...schema });
export function editorFixture(options: { numericResults?: boolean; nestedNumeric?: boolean } = {}) {
  const pageModel = createContentModelRecord({ name: "Page", kind: "single", fields: [
    field("title", { kind: "text" }, true), field("price", { kind: "number" }), field("enabled", { kind: "boolean" }),
    field("summary", { kind: "long-text" }), field("date", { kind: "date" }), field("url", { kind: "url" }), field("color", { kind: "color" }), field("slug", { kind: "slug" }),
    field("choice", { kind: "choice", options: [{ value: "basic", label: "基本" }, { value: "next", label: "次" }] }), field("notes", { kind: "markdown" }),
    field("details", { kind: "object", fields: [field("label", { kind: "text" }), field("secret", { kind: "text" }), ...(options.nestedNumeric ? [field("nested", { kind: "object", fields: [field("number", { kind: "number" })] })] : [])] }),
    field("rows", { kind: "list", item: { kind: "object", fields: [field("label", { kind: "text" }), field("secret", { kind: "text" })] } }),
    field("results", { kind: "list", item: { kind: options.numericResults ? "number" : "text" } }), field("image", { kind: "asset-use", use: "image" }),
    field("questions", { kind: "reference-list", ordered: true, target: { providerId: "content", recordId: "faq" } }),
  ] }, { id: "page", timestamp: stamp });
  const faqModel = createContentModelRecord({ name: "FAQ", kind: "collection", fields: [field("question", { kind: "text" }, true), field("answer", { kind: "long-text" }, true)] }, { id: "faq", timestamp: stamp });
  const homepage = createContentEntryRecord("page", { title: "日本語の講座", price: 9, enabled: true, summary: "概要", date: "2026-01-01", url: "https://example.com", color: "#ffffff", slug: "fixed-route", choice: "basic", notes: "初期の文章", details: { label: "Visible", secret: "Locked", ...(options.nestedNumeric ? { nested: { number: 9 } } : {}) }, rows: [{ label: "A", secret: "protected" }], results: options.numericResults ? [9, 5] : ["short"], image: { kind: "image", asset: { providerId: "assets", assetId: "first" }, alt: "Image", decorative: false, caption: "Caption" }, questions: [faq as unknown as JsonValue] }, { id: "home", timestamp: stamp });
  homepage.lifecycle = "published";
  const providers = [{ providerId: "content", models: [pageModel, faqModel], entries: [homepage,
    createContentEntryRecord("faq", { question: "First question", answer: "First answer" }, { id: "faq-a", timestamp: stamp }),
    createContentEntryRecord("faq", { question: "Detached question", answer: "Detached answer" }, { id: "faq-detached", timestamp: stamp }),
    createContentEntryRecord("faq", { question: "Private question", answer: "Hidden" }, { id: "private", timestamp: stamp })] }];
  let database: HostedDatabase = { state: { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d0", integrationFence: 0, providers }, baselineProviders: structuredClone(providers), snapshots: [], receipts: [], publications: [] };
  const policy: HostedPolicy = {
    models: [{ providerId: "content", modelId: "page", entryIds: ["home"], fields: [
      ...["title", "price", "enabled", "summary", "date", "url", "color", "choice", "notes"].map((fieldId) => ({ fieldId, replace: true, clear: true })),
      { fieldId: "details", children: [{ fieldId: "label", replace: true, clear: true }, ...(options.nestedNumeric ? [{ fieldId: "nested", clear: true, children: [{ fieldId: "number", replace: true, clear: true }] }] : [])] },
      { fieldId: "rows", children: [{ fieldId: "label", replace: true }] },
      { fieldId: "results", replace: true, listAdd: true, listRemove: true, listReorder: true, maxLength: 3 },
      { fieldId: "image", assetSelect: true, assetDescription: ["alt", "caption"] },
    ] }, { providerId: "content", modelId: "faq", entryIds: ["faq-a", "faq-detached"], fields: [{ fieldId: "question", replace: true }, { fieldId: "answer", replace: true }] }],
    collections: [{ id: "questions", owner: page, fieldId: "questions", target: { providerId: "content", modelId: "faq" }, create: true, add: true, reorder: true, maxItems: 5, initialValues: { question: "新しい質問", answer: "新しい回答" } }],
    assets: ["first", "second"].map((assetId) => ({ providerId: "assets", assetId, versionId: "v1", checksum: `sha-${assetId}`, url: `/${assetId}.png`, label: assetId })),
  };
  let queue = Promise.resolve();
  const storage: HostedStorage = { read: async () => structuredClone(database), transaction<T>(work: (database: HostedDatabase) => Promise<T>): Promise<T> {
    const pending = queue.then(async () => { const candidate = structuredClone(database); const result = await work(candidate); database = candidate; return structuredClone(result); });
    queue = pending.then(() => undefined, () => undefined); return pending;
  } };
  let id = 0;
  const service = createHostedContentService({ siteId: "test", definition: "d0", storage, policy, authorize: () => undefined,
    digest: async (value) => createHash("sha256").update(value).digest("hex"), createId: () => `server-${++id}`, now: () => stamp,
    project: (providers) => providers as unknown as JsonValue, validateSubmission: () => undefined });
  const actor = { id: "editor" }; const requests: HostedCommand[] = [];
  const transport: HostedTransport = {
    readState: () => service.readState(actor), readReceipt: (key) => service.readReceipt(actor, key), getPublication: (id) => service.getPublication(actor, id),
    execute: (request) => { requests.push(request); return service.execute(actor, request); },
  };
  return { transport, policy, service, actor, requests, database: () => structuredClone(database), replace: (next: HostedDatabase) => { database = next; } };
}
