import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../content/library/helpers";
import { createHostedContentService } from "../service";
import { canonicalSerialize } from "../canonical";
import type { HostedCommand, HostedDatabase, HostedIdentities, HostedPolicy, HostedServiceOptions, HostedStorage, JsonValue } from "../types";

const actor = { id: "author" }, page = { providerId: "content", modelId: "page", recordId: "home" }, faq = { providerId: "content", modelId: "faq", recordId: "one" };
const timestamp = "2026-01-01T00:00:00.000Z";
const identities = (value: HostedIdentities): HostedIdentities => ({ draftRevision: value.draftRevision, definition: value.definition, baseline: structuredClone(value.baseline) });
const json = (value: unknown): JsonValue => value as JsonValue;
const field = (id: string) => ({ id, key: id, label: id, required: false });

function fixture() {
  const pageModel = createContentModelRecord({ name: "Page", kind: "single", fields: [
    { ...field("title"), kind: "text", required: true }, { ...field("price"), kind: "number" }, { ...field("enabled"), kind: "boolean" },
    { ...field("slug"), kind: "slug" }, { ...field("body"), kind: "markdown" }, { ...field("url"), kind: "url" },
    { ...field("details"), kind: "object", fields: [{ ...field("label"), kind: "text" }, { ...field("secret"), kind: "text" }] },
    { ...field("rows"), kind: "list", item: { kind: "object", fields: [{ ...field("label"), kind: "text" }, { ...field("secret"), kind: "text" }] } },
    { ...field("results"), kind: "list", item: { kind: "text" } },
    { ...field("image"), kind: "asset-use", use: "image" },
    { ...field("faqs"), kind: "reference-list", ordered: true, target: { providerId: "content", recordId: "faq" } },
  ] }, { id: "page", timestamp });
  const faqModel = createContentModelRecord({ name: "FAQs", kind: "collection", fields: [{ ...field("question"), kind: "text", required: true }, { ...field("answer"), kind: "text", required: true }] }, { id: "faq", timestamp });
  const homepage = createContentEntryRecord("page", { title: "初期", price: 10, enabled: true, slug: "home", details: { label: "Visible", secret: "Locked" }, rows: [{ label: "A", secret: "one" }, { label: "B", secret: "two" }], image: { kind: "image", asset: { providerId: "assets", assetId: "first" }, alt: "Image", decorative: false, caption: "" }, faqs: [json(faq)] }, { id: "home", timestamp });
  homepage.lifecycle = "published";
  const providers = [{ providerId: "content", models: [pageModel, faqModel], entries: [homepage, createContentEntryRecord("faq", { question: "Q", answer: "A" }, { id: "one", timestamp }), createContentEntryRecord("faq", { question: "Private", answer: "Never listed" }, { id: "private", timestamp })] }];
  let database: HostedDatabase = { state: { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "definition", providers, integrationFence: 0 }, baselineProviders: structuredClone(providers), snapshots: [], publications: [], receipts: [] };
  let queue = Promise.resolve(), failCommit = false, loseResponse = false;
  const storage: HostedStorage = {
    async read() { return structuredClone(database); },
    transaction<T>(work: (database: HostedDatabase) => Promise<T>): Promise<T> {
      const operation = queue.then(async () => {
        const draft = structuredClone(database), result = await work(draft);
        if (failCommit) { failCommit = false; throw new Error("receipt persistence failed"); }
        database = structuredClone(draft);
        if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
        return result;
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
  const policy: HostedPolicy = {
    models: [{ providerId: "content", modelId: "page", entryIds: ["home"], fields: [
      ...["title", "price", "enabled", "body", "url"].map(fieldId => ({ fieldId, replace: true, clear: true })),
      { fieldId: "details", children: [{ fieldId: "label", replace: true, clear: true }] },
      { fieldId: "rows", children: [{ fieldId: "label", replace: true }] },
      { fieldId: "results", replace: true, listAdd: true, maxLength: 3 },
      { fieldId: "image", assetSelect: true, assetDescription: ["alt", "caption", "decorative"] },
    ] }, { providerId: "content", modelId: "faq", entryIds: ["one"], fields: [{ fieldId: "question", replace: true }, { fieldId: "answer", replace: true }] }],
    collections: [{ id: "faqs", owner: page, fieldId: "faqs", target: { providerId: "content", modelId: "faq" }, create: true, add: true, reorder: true, maxItems: 10, initialValues: {} }],
    assets: ["first", "second"].map(assetId => ({ assetId, providerId: "assets", versionId: "v1", checksum: `sha-${assetId}`, url: `/assets/${assetId}.png`, label: assetId })),
  };
  let id = 0;
  const options: HostedServiceOptions = { siteId: "site", definition: "definition", policy, storage, authorize: () => undefined, digest: async value => createHash("sha256").update(value).digest("hex"), createId: () => `id-${++id}`, now: () => timestamp, project: providers => json(providers.map(provider => provider.entries.filter(entry => entry.id !== "private").map(entry => ({ id: entry.id, values: entry.values, lifecycle: entry.lifecycle })))), validateSubmission: () => undefined };
  const service = createHostedContentService(options);
  const expected = () => identities(database.state);
  const set = (operationKey: string, values: Record<string, JsonValue>, entry = page): HostedCommand => ({ kind: "set-fields", operationKey, expected: expected(), entry, values, clear: [] });
  const capture = (operationKey: string): HostedCommand => ({ kind: "capture-snapshot", operationKey, expected: expected() });
  const begin = (operationKey: string, snapshotId: string): HostedCommand => ({ kind: "begin-publication", operationKey, expected: expected(), snapshotId });
  return { service, storage, options, expected, set, capture, begin, db: () => structuredClone(database), failCommit: () => { failCommit = true; }, loseResponse: () => { loseResponse = true; }, replace: (next: HostedDatabase) => { database = next; } };
}

async function rejectsWithoutWrite(f: ReturnType<typeof fixture>, command: unknown, code: string) {
  const before = f.db();
  await expect(f.service.execute(actor, command)).rejects.toMatchObject({ code });
  expect(f.db()).toEqual(before);
}

describe("hosted Content trusted boundary", () => {
  it("preserves exact Japanese text, zero, false and allows incomplete drafts with submission diagnostics", async () => {
    const f = fixture();
    await f.service.execute(actor, f.set("save", { title: "日本語の文章", price: 0, enabled: false }));
    const saved = (await f.service.readState(actor)).providers[0]!.entries.find(entry => entry.id === "home")!;
    expect(saved.values).toMatchObject({ title: "日本語の文章", price: 0, enabled: false, slug: "home" });
    expect(saved.lifecycle).toBe("published");
    await f.service.execute(actor, f.set("empty", { title: "" }));
    const result = await f.service.execute(actor, f.capture("snapshot"));
    expect(result.snapshot!.diagnostics).toContainEqual(expect.objectContaining({ fieldId: "title", code: "required-value-missing" }));
    await rejectsWithoutWrite(f, f.begin("submit", result.snapshot!.id), "incomplete");
    expect((await f.service.readState(actor)).providers[0]!.entries.map(entry => entry.id)).not.toContain("private");
  });

  it("scopes every public snapshot and receipt while keeping the full internal delivery candidate", async () => {
    const f = fixture(), command = f.capture("capture-private");
    const result = await f.service.execute(actor, command), snapshot = result.snapshot!;
    const stored = f.db().snapshots.find(item => item.id === snapshot.id)!;
    expect(stored.providers[0]!.entries.find(entry => entry.id === "private")?.values.answer).toBe("Never listed");
    expect(stored.digest).toBe(await f.options.digest(canonicalSerialize({ providers: stored.providers, assets: stored.assets, renderData: stored.renderData })));
    expect(snapshot.digest).toBe(stored.digest);
    const publicResults = [result, await f.service.readSnapshot(actor, snapshot.id), await f.service.readReceipt(actor, command.operationKey), await f.service.execute(actor, command)];
    const submit = f.begin("submit-private", snapshot.id);
    publicResults.push(await f.service.execute(actor, submit), await f.service.readReceipt(actor, submit.operationKey), await f.service.execute(actor, submit));
    for (const value of publicResults) {
      expect(JSON.stringify(value)).not.toContain("Never listed");
      expect(JSON.stringify(value)).not.toContain('"id":"private"');
    }
    expect(f.db().snapshots.find(item => item.id === snapshot.id)).toEqual(stored);
  });

  it("recovers the exact scoped receipt across a new definition and changed collection policy", async () => {
    const f = fixture(), command = f.capture("old-definition-snapshot");
    const committed = await f.service.execute(actor, command), receipt = await f.service.readReceipt(actor, command.operationKey);
    const newPolicy = structuredClone(f.options.policy);
    newPolicy.models = [];
    newPolicy.collections = [{ ...newPolicy.collections[0]!, owner: { ...page, recordId: "new-owner" } }];
    const reopened = createHostedContentService({ ...f.options, definition: "new-definition", policy: newPolicy });
    expect(await reopened.execute(actor, command)).toEqual(committed);
    expect(await reopened.readReceipt(actor, command.operationKey)).toEqual(receipt);
    expect(JSON.stringify(await reopened.readReceipt(actor, command.operationKey))).not.toContain("Never listed");
    await expect(reopened.execute(actor, f.set("fresh-after-definition-change", { title: "New" }))).rejects.toMatchObject({ code: "definition-conflict" });
    const changedRequest = { ...command, expected: { ...command.expected, definition: "new-definition" } };
    await expect(reopened.execute(actor, changedRequest)).rejects.toMatchObject({ code: "operation-key-reuse" });
  });

  it.each([false, true])("saves an empty URL with required=%s and defers completeness to submission", async required => {
    const f = fixture(), configured = f.db();
    for (const providers of [configured.state.providers, configured.baselineProviders]) providers[0]!.models[0]!.document.fields.find(item => item.id === "url")!.required = required;
    f.replace(configured);
    const saved = await f.service.execute(actor, f.set("empty-url", { url: "" }));
    expect(saved.state.providers[0]!.entries.find(entry => entry.id === "home")!.values.url).toBe("");
    const { snapshot } = await f.service.execute(actor, f.capture("empty-url-snapshot"));
    if (required) {
      expect(snapshot!.diagnostics).toContainEqual(expect.objectContaining({ fieldId: "url", code: "required-value-missing" }));
      await rejectsWithoutWrite(f, f.begin("empty-url-submit", snapshot!.id), "incomplete");
    } else {
      expect(snapshot!.diagnostics).toHaveLength(0);
      expect((await f.service.execute(actor, f.begin("empty-url-submit", snapshot!.id))).publication!.status).toBe("submitted");
    }
    const policy = structuredClone(f.options.policy); policy.assets[0]!.url = "";
    expect(() => createHostedContentService({ ...f.options, policy })).toThrow(expect.objectContaining({ code: "invalid-value" }));
  });

  it.each(["actor", "policy", "project", "generation", "lifecycle", "timestamp", "source", "file", "raw"])("rejects forged %s metadata atomically", async key => {
    const f = fixture();
    await rejectsWithoutWrite(f, { ...f.set("bad", { title: "bad" }), [key]: "forged" }, "invalid-request");
  });

  it("rejects unknown providers/models/fields, invalid types, huge/cyclic payloads and forbidden verbs", async () => {
    const f = fixture();
    for (const entry of [{ ...page, providerId: "other" }, { ...page, modelId: "other" }, { ...faq, recordId: "private" }]) await rejectsWithoutWrite(f, f.set("bad", { title: "bad" }, entry), "forbidden");
    await rejectsWithoutWrite(f, f.set("bad", { nonexistent: "bad" }), "forbidden");
    await rejectsWithoutWrite(f, f.set("bad", { price: "0" }), "invalid-value");
    await rejectsWithoutWrite(f, f.set("bad", { price: Number.NaN }), "invalid-request");
    await rejectsWithoutWrite(f, { ...f.capture("bad"), kind: "delete-model" }, "invalid-request");
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await rejectsWithoutWrite(f, cyclic, "invalid-request");
  });

  it("uses canonical model definitions and rejects independently changed schemas before a write", async () => {
    const f = fixture(), changed = f.db();
    changed.state.providers[0]!.models[0]!.document.fields.find(item => item.id === "price")!.kind = "text";
    f.replace(changed);
    await rejectsWithoutWrite(f, f.set("stale-definition", { title: "Changed" }), "definition-conflict");
  });

  it("compares nested protected leaves and blocks reference lists and disguised list structure", async () => {
    const f = fixture();
    await f.service.execute(actor, f.set("leaf", { details: { label: "New", secret: "Locked" } }));
    const forbiddenValues: Record<string, JsonValue>[] = [{ slug: "elsewhere" }, { details: { label: "New", secret: "Changed" } }, { details: { label: "New" } }, { faqs: [] }, { rows: [{ label: "B", secret: "two" }, { label: "A", secret: "one" }] }, { rows: [] }];
    for (const values of forbiddenValues) await rejectsWithoutWrite(f, f.set("bad", values), "forbidden");
    await f.service.execute(actor, f.set("list-leaf", { rows: [{ label: "Edited", secret: "one" }, { label: "B", secret: "two" }] }));
  });

  it("limits list cardinality without applying that bound to primitive item text", async () => {
    const f = fixture();
    const result = await f.service.execute(actor, f.set("long-list-item", { results: ["A useful result"] }));
    expect(result.state.providers[0]!.entries.find(entry => entry.id === "home")!.values.results).toEqual(["A useful result"]);
    await f.service.execute(actor, f.set("three-results", { results: ["A useful result", "Another useful result", "日本語の長い結果"] }));
    await rejectsWithoutWrite(f, f.set("four-results", { results: ["A useful result", "Another useful result", "日本語の長い結果", "One too many"] }), "invalid-value");
  });

  it("retains explicit child string bounds inside a cardinality-bounded object list", async () => {
    const f = fixture(), policy = structuredClone(f.options.policy);
    const permission = policy.models[0]!.fields.find(item => item.fieldId === "rows")!;
    permission.maxLength = 2;
    permission.children![0]!.maxLength = 10;
    const service = createHostedContentService({ ...f.options, policy });
    await service.execute(actor, f.set("bounded-list-leaf", { rows: [{ label: "Useful", secret: "one" }, { label: "B", secret: "two" }] }));
    await rejectsWithoutWrite({ ...f, service }, f.set("too-long-leaf", { rows: [{ label: "Longer than ten", secret: "one" }, { label: "B", secret: "two" }] }), "invalid-value");
    await rejectsWithoutWrite({ ...f, service }, f.set("protected-leaf", { rows: [{ label: "Useful", secret: "changed" }, { label: "B", secret: "two" }] }), "forbidden");
  });

  it("allows pinned asset selection and description but rejects outside assets, executable Markdown and unsafe URLs", async () => {
    const f = fixture();
    const image = { kind: "image", asset: { providerId: "assets", assetId: "second" }, alt: "日本語", decorative: false, caption: "Caption" };
    await f.service.execute(actor, f.set("asset", { image }));
    await rejectsWithoutWrite(f, f.set("bad", { image: { ...image, asset: { providerId: "assets", assetId: "outside" } } }), "forbidden");
    for (const body of ["<script>alert(1)</script>", "import x from 'x'", "export const x = 1", "<Thing />", "> <!-- hidden -->", "- <?php echo 1 ?>", "[x](file:///secrets)", "[x](javascript:alert(1))", "[x](java&#x73;cript:alert(1))", "[x](<vbscript:msgbox>)", "<data:text/html,x>", "[r]: //outside/x\n\n[r]", "![x](https://outside/image.png)"]) await rejectsWithoutWrite(f, f.set("bad", { body }), "invalid-value");
    for (const url of ["javascript:alert(1)", "//outside/x", "data:text/html,x", "/\\outside/x"]) await rejectsWithoutWrite(f, f.set("bad", { url }), "invalid-value");
    await f.service.execute(actor, f.set("prose", { body: "# 日本語\n\n**太字** [page](/about)", url: "https://example.com/about" }));
    const { snapshot } = await f.service.execute(actor, f.capture("snapshot"));
    expect(snapshot!.assets[1]).toMatchObject({ assetId: "second", checksum: "sha-second", versionId: "v1" });
  });

  it("preserves approved prose that only resembles source, schemes or MDX", async () => {
    const f = fixture();
    for (const [index, body] of ["Our metadata: refreshed weekly", "Big data: trends", "Use {name} here", "{run()}", "Import duties apply.\n\nExport the report from the menu.", "`<b>` and `import x from 'x'` are code", "1 < 2 and 3 > 2", "<https://example.com/a> and <mailto:hi@example.com>", "[ref]\n\n[ref]: /about#faq \"Title\""].entries()) {
      const saved = await f.service.execute(actor, f.set(`prose-${index}`, { body }));
      expect(saved.state.providers[0]!.entries.find(entry => entry.id === "home")!.values.body).toBe(body);
    }
  });

  it("creates membership atomically, recovers created IDs, then enforces exact reorder membership", async () => {
    const f = fixture();
    const command: HostedCommand = { kind: "create-entry", operationKey: "create", expected: f.expected(), collectionId: "faqs", values: { question: "New", answer: "Answer" }, before: faq };
    const [a, b] = await Promise.all([f.service.execute(actor, command), f.service.execute(actor, command)]);
    expect(a).toEqual(b);
    expect(f.db().receipts).toHaveLength(1);
    expect(f.db().state.providers[0]!.entries).toHaveLength(4);
    const created = a.createdEntry!;
    expect(f.db().state.providers[0]!.entries[0]!.values.faqs).toEqual([created, faq]);
    await f.service.execute(actor, f.set("new-edit", { answer: "Updated" }, created));
    for (const entries of [[faq], [faq, faq], [faq, { ...created, recordId: "foreign" }]]) await rejectsWithoutWrite(f, { kind: "reorder", operationKey: "bad", expected: f.expected(), collectionId: "faqs", entries }, "invalid-value");
    await f.service.execute(actor, { kind: "reorder", operationKey: "reorder", expected: f.expected(), collectionId: "faqs", entries: [faq, created] });
    expect(f.db().state.providers[0]!.entries[0]!.values.faqs).toEqual([faq, created]);
    await rejectsWithoutWrite(f, { kind: "add-entry", operationKey: "bad", expected: f.expected(), collectionId: "faqs", entry: { ...faq, recordId: "private" }, before: null }, "forbidden");
    expect(await f.service.execute(actor, command)).toEqual(a);
  });

  it("rolls back creation, owner and receipt together before commit and recovers after lost acknowledgement", async () => {
    const f = fixture(), original = f.db();
    const command: HostedCommand = { kind: "create-entry", operationKey: "create", expected: f.expected(), collectionId: "faqs", values: { question: "Q2", answer: "A2" }, before: null };
    f.failCommit();
    await expect(f.service.execute(actor, command)).rejects.toThrow("receipt persistence failed");
    expect(f.db()).toEqual(original);
    f.loseResponse();
    await expect(f.service.execute(actor, command)).rejects.toThrow("response lost");
    const restarted = createHostedContentService(f.options), receipt = await restarted.readReceipt(actor, command.operationKey);
    expect(receipt).not.toBeNull();
    expect(await restarted.execute(actor, command)).toEqual(receipt!.result);
    expect(f.db().state.providers[0]!.entries).toHaveLength(4);
  });

  it("serializes independent writes and rejects changed key payload before fresh CAS/policy checks", async () => {
    const f = fixture(), second = createHostedContentService(f.options), a = f.set("a", { title: "A" }), b = f.set("b", { price: 0 });
    const settled = await Promise.allSettled([f.service.execute(actor, a), second.execute(actor, b)]);
    expect(settled.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.find(item => item.status === "rejected")).toMatchObject({ reason: { code: "revision-conflict" } });
    const result = await f.service.execute(actor, a);
    await rejectsWithoutWrite(f, { ...a, values: { title: "Another" } }, "operation-key-reuse");
    const changed = f.db(); changed.state.definition = "new-definition"; f.replace(changed);
    expect(await f.service.execute(actor, a)).toEqual(result);
    expect(await f.service.readReceipt({ id: "other" }, "a")).toBeNull();
  });

  it("captures one complete revision, freezes delivery bytes, and prevents stale preview submission", async () => {
    const f = fixture(), command: HostedCommand = { kind: "create-entry", operationKey: "create", expected: f.expected(), collectionId: "faqs", values: { question: "Q2", answer: "A2" }, before: null };
    const captured = f.capture("capture");
    const [create, capture] = await Promise.allSettled([f.service.execute(actor, command), f.service.execute(actor, captured)]);
    expect(create.status).toBe("fulfilled"); expect(capture).toMatchObject({ status: "rejected", reason: { code: "revision-conflict" } });
    const { snapshot } = await f.service.execute(actor, f.capture("current"));
    const before = structuredClone(snapshot!);
    expect(snapshot!.providers[0]!.entries.find(entry => entry.id === (create as PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.execute>>>).value.createdEntry!.recordId)?.lifecycle).toBe("published");
    snapshot!.providers[0]!.entries[0]!.values.title = "Mutating returned object";
    expect(await f.service.readSnapshot(actor, snapshot!.id)).toEqual(before);
    await f.service.execute(actor, f.set("B", { title: "B" }));
    await rejectsWithoutWrite(f, f.begin("stale-submit", snapshot!.id), "revision-conflict");
  });

  it("advances two baselines while preserving later edits and draft collection members; ignores old callbacks", async () => {
    const f = fixture();
    const created = await f.service.execute(actor, { kind: "create-entry", operationKey: "create", expected: f.expected(), collectionId: "faqs", values: { question: "A", answer: "A" }, before: null });
    const ref = created.createdEntry!;
    const { snapshot: s1 } = await f.service.execute(actor, f.capture("s1"));
    const submit = f.begin("p1", s1!.id);
    const accepted = await f.service.execute(actor, submit), p1 = accepted.publication!;
    await rejectsWithoutWrite(f, f.begin("duplicate-publication", s1!.id), "publication-busy");
    await f.service.execute(actor, f.set("B", { answer: "B" }, ref));
    expect(await f.service.execute(actor, submit)).toEqual(accepted);
    const evidence = { publicationId: p1.id, snapshotId: s1!.id, expectedBaseline: s1!.baseline, gitSha: "g1", contentDigest: s1!.digest };
    await f.service.recordConfirmedIntegration(evidence);
    const draft = f.db().state.providers[0]!.entries.find(entry => entry.id === ref.recordId)!;
    expect(draft).toMatchObject({ lifecycle: "draft", values: { answer: "B" } });
    const { snapshot: s2 } = await f.service.execute(actor, f.capture("s2"));
    expect(s2!.providers[0]!.entries.find(entry => entry.id === ref.recordId)).toMatchObject({ lifecycle: "published", values: { answer: "B" } });
    const { publication: p2 } = await f.service.execute(actor, f.begin("p2", s2!.id));
    await f.service.recordConfirmedIntegration({ publicationId: p2!.id, snapshotId: s2!.id, expectedBaseline: s2!.baseline, gitSha: "g2", contentDigest: s2!.digest });
    const final = f.db();
    expect(final.state.baseline).toEqual({ gitSha: "g2", contentDigest: s2!.digest });
    expect(final.state.providers[0]!.entries.find(entry => entry.id === ref.recordId)?.lifecycle).toBe("published");
    await f.service.recordConfirmedIntegration(evidence);
    await f.service.recordStatus({ publicationId: p1.id, snapshotId: s1!.id, statusVersion: 99, status: "building" });
    expect(f.db()).toEqual(final);
  });

  it("keeps proven publication status monotonic through unavailable responses", async () => {
    const f = fixture(), { snapshot } = await f.service.execute(actor, f.capture("snapshot"));
    const { publication } = await f.service.execute(actor, f.begin("publish", snapshot!.id));
    const evidence = { publicationId: publication!.id, snapshotId: snapshot!.id };
    await f.service.recordStatus({ ...evidence, statusVersion: 2, status: "verified" });
    await f.service.recordStatus({ ...evidence, statusVersion: 3, status: "unavailable", message: "Provider timed out" });
    const current = await f.service.getPublication(actor, publication!.id);
    expect(current).toMatchObject({ status: "unavailable", lastProvenStatus: "verified", statusVersion: 3 });
    expect(await f.service.recordStatus({ ...evidence, statusVersion: 4, status: "building" })).toEqual(current);
    expect(await f.service.recordStatus({ ...evidence, statusVersion: 2, status: "failed" })).toEqual(current);
    expect((await f.service.recordStatus({ ...evidence, statusVersion: 5, status: "verified" })).status).toBe("verified");
  });

  it("fences a save racing integration without overwriting the submitted draft", async () => {
    const f = fixture(), { snapshot } = await f.service.execute(actor, f.capture("snapshot"));
    const { publication } = await f.service.execute(actor, f.begin("publish", snapshot!.id));
    const edit = f.set("racing-edit", { title: "Retain in browser" });
    const results = await Promise.allSettled([
      f.service.recordConfirmedIntegration({ publicationId: publication!.id, snapshotId: snapshot!.id, expectedBaseline: snapshot!.baseline, gitSha: "g1", contentDigest: snapshot!.digest }),
      f.service.execute(actor, edit),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "baseline-conflict" } });
    expect(f.db().state.providers[0]!.entries[0]!.values.title).toBe("初期");
    expect(await f.service.readReceipt(actor, edit.operationKey)).toBeNull();
  });

  it("authorizes exact receipt recovery and rolls back failed host projection/submission validation", async () => {
    const f = fixture(), command = f.set("save", { title: "Saved" });
    await f.service.execute(actor, command);
    const blocked = createHostedContentService({ ...f.options, authorize: () => { throw new Error("expired session"); } });
    const before = f.db();
    await expect(blocked.execute(actor, command)).rejects.toThrow("expired session");
    await expect(blocked.readReceipt(actor, command.operationKey)).rejects.toThrow("expired session");
    const brokenProjection = createHostedContentService({ ...f.options, project: () => { throw new Error("projection unavailable"); } });
    await expect(brokenProjection.execute(actor, f.capture("broken"))).rejects.toThrow("projection unavailable");
    expect(f.db()).toEqual(before);
    const { snapshot } = await f.service.execute(actor, f.capture("capture"));
    const captured = f.db(), brokenSubmission = createHostedContentService({ ...f.options, validateSubmission: () => { throw new Error("fixed route validation failed"); } });
    await expect(brokenSubmission.execute(actor, f.begin("broken-submit", snapshot!.id))).rejects.toThrow("fixed route validation failed");
    expect(f.db()).toEqual(captured);
  });

  it("retains content on failed exports and rejects forged integration, external baseline/definition changes", async () => {
    const f = fixture(), { snapshot } = await f.service.execute(actor, f.capture("snapshot"));
    const { publication } = await f.service.execute(actor, f.begin("publish", snapshot!.id));
    const evidence = { publicationId: publication!.id, snapshotId: snapshot!.id, expectedBaseline: snapshot!.baseline, gitSha: "g1", contentDigest: "forged" };
    const before = f.db();
    await expect(f.service.recordConfirmedIntegration(evidence)).rejects.toMatchObject({ code: "baseline-conflict" });
    expect(f.db()).toEqual(before);
    await expect(f.service.recordStatus({ publicationId: publication!.id, snapshotId: snapshot!.id, statusVersion: 2, status: "deployed" })).rejects.toMatchObject({ code: "invalid-request" });
    const changed = f.db(); changed.state.baseline.gitSha = "external"; f.replace(changed);
    await expect(f.service.recordConfirmedIntegration({ ...evidence, contentDigest: snapshot!.digest })).rejects.toMatchObject({ code: "baseline-conflict" });
    await f.service.recordStatus({ publicationId: publication!.id, snapshotId: snapshot!.id, statusVersion: 2, status: "unavailable" });
    await f.service.recordStatus({ publicationId: publication!.id, snapshotId: snapshot!.id, statusVersion: 3, status: "failed", message: "Export rejected" });
    expect(f.db().state.providers).toEqual(before.state.providers);
    expect(f.db().snapshots).toEqual(before.snapshots);
  });
});

it("canonical serialization binds order-independent object keys and rejects lossy JSON", () => {
  expect(canonicalSerialize({ z: false, a: [0, "日本語"] })).toBe(canonicalSerialize({ a: [0, "日本語"], z: false }));
  for (const value of [undefined, Infinity, new Date(), { missing: undefined }, [undefined]]) expect(() => canonicalSerialize(value)).toThrow();
});
