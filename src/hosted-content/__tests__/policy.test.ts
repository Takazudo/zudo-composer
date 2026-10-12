import { describe, expect, it } from "vitest";
import type { ContentSnapshot } from "../../content/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model/types";
import { authorizeContentMutation, type HostContentPolicy } from "../policy";

const TIMESTAMP = "2026-10-12T00:00:00.000Z";
const LATER = "2026-10-12T01:00:00.000Z";
const providerId = "content-filesystem";
const actor = { subject: "editor@example.test" };

function model(id = "faq", kind: "collection" | "single" = "collection"): ContentModelRecord {
  return {
    id, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    document: {
      schemaVersion: 1, id, name: id, description: "", kind,
      fields: [
        { id: "question", key: "question", label: "Question", required: true, kind: "text" },
        { id: "answer", key: "answer", label: "Answer", required: false, kind: "markdown" },
        { id: "order", key: "order", label: "Order", required: true, kind: "number" },
        { id: "internal", key: "internal", label: "Internal note", required: false, kind: "text" },
        { id: "related", key: "related", label: "Related", required: false, kind: "reference", target: { providerId, recordId: "faq" } },
        { id: "hero", key: "hero", label: "Hero", required: false, kind: "asset-use", use: "image" },
        { id: "steps", key: "steps", label: "Steps", required: false, kind: "list", item: { kind: "markdown" } },
      ],
    },
  };
}

function entry(id: string, order: number, modelId = "faq"): ContentEntryRecord {
  return { schemaVersion: 1, id, modelId, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, values: { question: `Q ${id}`, answer: "", order }, lifecycle: "published", generation: 3 };
}

const policy: HostContentPolicy = {
  projectId: "pinsel",
  providerId,
  models: { faq: { fields: ["question", "answer", "order", "related", "hero", "steps"], operations: ["put-entry-values", "create-entry", "delete-entry", "reorder"] } },
  assets: { providerId: "assets-filesystem", assetIds: ["approved-hero"] },
};

const snapshot = (): ContentSnapshot => ({ providerId, mutationToken: 7, models: [model(), model("secrets")], entries: [entry("a", 0), entry("b", 1), entry("s", 0, "secrets")] });
const base = { projectId: "pinsel", providerId, modelId: "faq", expectedRevision: 7 };
const put = (extra: Record<string, unknown>) => authorizeContentMutation(policy, actor, { kind: "put-entry-values", ...base, entryId: "a", values: { question: "Changed" }, ...extra }, snapshot(), { now: () => LATER });

describe("authorizeContentMutation", () => {
  it("produces an exact put-entry mutation for a permitted field edit", () => {
    const result = put({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mutation.expectedMutationToken).toBe(7);
    expect(result.mutation.operations).toEqual([{ kind: "put-entry", record: { ...entry("a", 0), updatedAt: LATER, values: { question: "Changed", answer: "", order: 0 } } }]);
    expect(result.affectedEntryIds).toEqual(["a"]);
    expect(result.actor).toEqual(actor);
  });

  it.each([
    ["caller-supplied role", { role: "admin" }, "malformed-request"],
    ["caller-supplied policy", { policy: { models: {} } }, "malformed-request"],
    ["caller-supplied actor", { actor: { subject: "other" } }, "malformed-request"],
    ["caller-supplied schema", { schema: {} }, "malformed-request"],
    ["extra key", { extra: 1 }, "malformed-request"],
    ["wrong project", { projectId: "other-site" }, "wrong-project"],
    ["wrong provider", { providerId: "content-other" }, "wrong-project"],
    ["stale revision", { expectedRevision: 6 }, "stale"],
    ["future revision", { expectedRevision: 8 }, "stale"],
    ["negative revision", { expectedRevision: -1 }, "malformed-request"],
    ["unsafe model id", { modelId: "../etc" }, "malformed-request"],
    ["unsafe entry id", { entryId: "A B" }, "malformed-request"],
    ["model outside the policy", { modelId: "secrets" }, "forbidden"],
    ["missing entry", { entryId: "zzz" }, "not-found"],
    ["unknown field", { values: { nope: "x" } }, "unknown-field"],
    ["read-only field", { values: { internal: "x" } }, "forbidden"],
    ["wrong value type", { values: { order: "one" } }, "invalid-value"],
    ["cross-provider reference", { values: { related: { providerId: "content-other", modelId: "faq", recordId: "b" } } }, "invalid-value"],
    ["dangling reference", { values: { related: { providerId, modelId: "faq", recordId: "missing" } } }, "unsafe-reference"],
    ["self reference", { values: { related: { providerId, modelId: "faq", recordId: "a" } } }, "unsafe-reference"],
    ["unapproved asset", { values: { hero: { kind: "image", asset: { providerId: "assets-filesystem", assetId: "random-upload" }, alt: "x", decorative: false, caption: "" } } }, "unsafe-reference"],
    ["asset from another provider", { values: { hero: { kind: "image", asset: { providerId: "assets-other", assetId: "approved-hero" }, alt: "x", decorative: false, caption: "" } } }, "unsafe-reference"],
    ["raw html in markdown", { values: { answer: "Hello <script>alert(1)</script>" } }, "invalid-value"],
    ["javascript link in markdown", { values: { answer: "[x](javascript:alert(1))" } }, "unsafe-reference"],
    ["image in markdown", { values: { answer: "![x](https://example.com/a.png)" } }, "invalid-value"],
    ["unsafe link nested in a markdown list", { values: { steps: ["fine", "<https://ok.example>", "[bad](data:text/html,x)"] } }, "unsafe-reference"],
    ["arbitrary source payload", { values: { question: { code: "export default 1" } } }, "invalid-value"],
  ])("refuses %s", (_label, extra, code) => {
    const result = put(extra);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
  });

  it("accepts an approved asset and safe markdown links", () => {
    const result = put({ values: { hero: { kind: "image", asset: { providerId: "assets-filesystem", assetId: "approved-hero" }, alt: "Hero", decorative: false, caption: "" }, answer: "See [docs](https://example.com) or [here](/about) and <mailto:a@b.c>." } });
    expect(result.ok).toBe(true);
  });

  it("reports a policy-listed model that does not exist as unknown, never leaking models outside the policy", () => {
    const wider: HostContentPolicy = { ...policy, models: { ...policy.models, ghost: { fields: [], operations: ["put-entry-values"] } } };
    expect(authorizeContentMutation(wider, actor, { kind: "put-entry-values", ...base, modelId: "ghost", entryId: "a", values: {} }, snapshot())).toMatchObject({ ok: false, code: "unknown-model" });
    expect(authorizeContentMutation(policy, actor, { kind: "put-entry-values", ...base, modelId: "ghost", entryId: "a", values: {} }, snapshot())).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses requests without a verified actor or with an unknown kind", () => {
    expect(authorizeContentMutation(policy, { subject: "" }, { kind: "put-entry-values", ...base, entryId: "a", values: {} }, snapshot())).toMatchObject({ ok: false, code: "forbidden" });
    expect(authorizeContentMutation(policy, actor, { kind: "put-model", ...base }, snapshot())).toMatchObject({ ok: false, code: "malformed-request" });
    expect(authorizeContentMutation(policy, actor, { kind: "write-file", path: "src/x.ts" }, snapshot())).toMatchObject({ ok: false, code: "malformed-request" });
    expect(authorizeContentMutation(policy, actor, null, snapshot())).toMatchObject({ ok: false, code: "malformed-request" });
  });

  it("refuses operations the model policy does not list even when the field is editable", () => {
    const narrow: HostContentPolicy = { ...policy, models: { faq: { fields: ["question"], operations: ["put-entry-values"] } } };
    expect(authorizeContentMutation(narrow, actor, { kind: "delete-entry", ...base, entryId: "a" }, snapshot())).toMatchObject({ ok: false, code: "forbidden" });
    expect(authorizeContentMutation(narrow, actor, { kind: "create-entry", ...base, entryId: "c", values: { question: "x" } }, snapshot())).toMatchObject({ ok: false, code: "forbidden" });
    expect(authorizeContentMutation(narrow, actor, { kind: "reorder", ...base, fieldId: "order", entryIds: ["b", "a"] }, snapshot())).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("creates a draft entry with the supplied stable id and refuses duplicates and single-model overflow", () => {
    const created = authorizeContentMutation(policy, actor, { kind: "create-entry", ...base, entryId: "c", values: { question: "New", order: 2 } }, snapshot(), { now: () => LATER });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.mutation.operations).toEqual([{ kind: "put-entry", record: { schemaVersion: 1, id: "c", modelId: "faq", createdAt: LATER, updatedAt: LATER, values: { question: "New", order: 2 }, lifecycle: "draft", generation: 0 } }]);
    expect(authorizeContentMutation(policy, actor, { kind: "create-entry", ...base, entryId: "a", values: {} }, snapshot())).toMatchObject({ ok: false, code: "conflict" });
    const single: ContentSnapshot = { ...snapshot(), models: [model("faq", "single")], entries: [entry("only", 0)] };
    expect(authorizeContentMutation(policy, actor, { kind: "create-entry", ...base, entryId: "second", values: {} }, single)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("deletes an unreferenced entry and refuses a referenced one", () => {
    expect(authorizeContentMutation(policy, actor, { kind: "delete-entry", ...base, entryId: "b" }, snapshot())).toMatchObject({ ok: true, mutation: { expectedMutationToken: 7, operations: [{ kind: "delete-entry", id: "b" }] } });
    const referenced = snapshot();
    referenced.entries[0]!.values.related = { providerId, modelId: "faq", recordId: "b" };
    expect(authorizeContentMutation(policy, actor, { kind: "delete-entry", ...base, entryId: "b" }, referenced)).toMatchObject({ ok: false, code: "unsafe-reference" });
  });

  it("reorders by rewriting the permitted number field across every entry of the model", () => {
    const result = authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "order", entryIds: ["b", "a"] }, snapshot(), { now: () => LATER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mutation.operations.map((operation) => operation.kind === "put-entry" ? [operation.record.id, operation.record.values.order] : operation)).toEqual([["b", 0], ["a", 1]]);
    expect(authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "order", entryIds: ["a"] }, snapshot())).toMatchObject({ ok: false, code: "not-found" });
    expect(authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "order", entryIds: ["a", "a", "b"] }, snapshot())).toMatchObject({ ok: false, code: "not-found" });
    expect(authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "question", entryIds: ["b", "a"] }, snapshot())).toMatchObject({ ok: false, code: "invalid-value" });
    expect(authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "nope", entryIds: ["b", "a"] }, snapshot())).toMatchObject({ ok: false, code: "unknown-field" });
  });

  it("never emits an operation that touches a model, field, mapping, template or sitemap record", () => {
    const results = [
      put({}),
      authorizeContentMutation(policy, actor, { kind: "create-entry", ...base, entryId: "c", values: {} }, snapshot()),
      authorizeContentMutation(policy, actor, { kind: "delete-entry", ...base, entryId: "b" }, snapshot()),
      authorizeContentMutation(policy, actor, { kind: "reorder", ...base, fieldId: "order", entryIds: ["b", "a"] }, snapshot()),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.mutation.operations.every((operation) => operation.kind === "put-entry" || operation.kind === "delete-entry")).toBe(true);
    }
  });
});
