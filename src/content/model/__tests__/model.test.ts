import { describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord, diagnoseContentEntryCompleteness } from "../../library";
import { loadContentEntryRecord, loadContentModelRecord, validateContentEntryRecord, validateContentModelRecord } from "../index";

const timestamp = "2026-01-01T00:00:00.000Z";

describe("Content records", () => {
  it("validates canonical envelopes, lower-camel unique keys, and JSON-safe typed records", () => {
    const model = createContentModelRecord({ name: "Posts", kind: "collection", fields: [
      { id: "title", key: "postTitle", label: "Title", required: true, kind: "text" },
      { id: "published", key: "published", label: "Published", required: false, kind: "boolean" },
    ] }, { id: "posts", timestamp });
    expect(validateContentModelRecord(model)).toEqual({ ok: true, value: model });
    expect(validateContentEntryRecord(createContentEntryRecord("posts", { title: "Hi", published: true }, { id: "post-1", timestamp }))).toMatchObject({ ok: true });
    expect(validateContentModelRecord({ ...model, document: { ...model.document, fields: [...model.document.fields, { ...model.document.fields[0]!, id: "other" }] } })).toMatchObject({ ok: false, issue: { code: "duplicate-field-key" } });
    expect(validateContentEntryRecord({ ...createContentEntryRecord("posts", {}, { id: "bad", timestamp }), values: { title: Number.NaN } })).toMatchObject({ ok: false, issue: { code: "not-json-safe" } });
  });

  it("separates structural draft validity from completeness", () => {
    const model = createContentModelRecord({ name: "Posts", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }] }, { id: "posts", timestamp });
    const draft = createContentEntryRecord("posts", {}, { id: "draft", timestamp });
    expect(validateContentEntryRecord(draft).ok).toBe(true);
    expect(diagnoseContentEntryCompleteness(model, draft)).toEqual([expect.objectContaining({ code: "required-value-missing", fieldId: "title" })]);
  });

  it("classifies malformed and future records while retaining the raw value", () => {
    const model = createContentModelRecord({ name: "Posts", kind: "single" }, { id: "posts", timestamp });
    const future = { ...model, document: { ...model.document, schemaVersion: 2 } };
    expect(loadContentModelRecord(future)).toEqual({ status: "future-schema", foundSchemaVersion: 2, raw: future });
    const malformed = { schemaVersion: 1, id: "entry", modelId: "posts", createdAt: "bad", updatedAt: timestamp, values: {} };
    expect(loadContentEntryRecord(malformed)).toEqual({ status: "invalid", issue: expect.objectContaining({ code: "invalid-timestamp" }), raw: malformed });
  });
});
