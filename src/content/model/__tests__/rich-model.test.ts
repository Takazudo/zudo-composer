import { describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord, diagnoseContentEntryCompleteness } from "../../library";
import { createContentValueSchema, isValueValidForField, loadContentEntryRecord, loadContentModelRecord, projectContentMediaUse, traverseContentValues, validateContentModelRecord } from "..";
import type { ContentFieldDefinition, ContentValueSchema } from "..";

const timestamp = "2026-01-01T00:00:00.000Z";
const target = { providerId: "content-indexeddb", recordId: "items" };
const ref = { providerId: target.providerId, modelId: target.recordId, recordId: "entry" };
const field = (schema: ContentValueSchema, id = "value", required = true): ContentFieldDefinition => ({ id, key: id, label: id, required, ...schema });

describe("Rich Content schema", () => {
  it.each([
    [{ kind: "text" }, "hello"], [{ kind: "long-text" }, "long"], [{ kind: "markdown" }, "# hello"],
    [{ kind: "number" }, 0], [{ kind: "boolean" }, false], [{ kind: "date" }, "2024-02-29"],
    [{ kind: "slug" }, "some-entry"], [{ kind: "color" }, "#123456"], [{ kind: "url" }, "https://example.com/item"],
    [{ kind: "choice", options: [{ value: "a", label: "A" }] }, "a"],
    [{ kind: "reference", target }, ref], [{ kind: "reference-list", target, ordered: true }, [ref]],
    [{ kind: "object", fields: [field({ kind: "boolean" }, "flag")] }, { flag: false }],
    [{ kind: "list", item: { kind: "number" } }, [0, 1]],
    [{ kind: "media-use", use: "image" }, { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "A diagram", decorative: false, caption: "Caption" }],
    [{ kind: "media-use", use: "link" }, { kind: "link", asset: { providerId: "media-files", assetId: "asset" }, label: "Read the PDF" }],
    [{ kind: "media-use", use: "card" }, { kind: "card", asset: { providerId: "media-files", assetId: "asset" }, title: "Card title", description: "Card details" }],
  ] as const)("round trips %j", (schema, value) => {
    const model = createContentModelRecord({ name: "Items", kind: "collection", description: "Rich content", fields: [field(structuredClone(schema) as ContentValueSchema)] }, { id: "items", timestamp });
    const entry = createContentEntryRecord("items", { value }, { id: "entry", timestamp });
    expect(loadContentModelRecord(JSON.parse(JSON.stringify(model)))).toEqual({ status: "loaded", record: model });
    expect(loadContentEntryRecord(JSON.parse(JSON.stringify(entry)))).toEqual({ status: "loaded", record: entry });
    expect(isValueValidForField(model.document.fields[0]!, value)).toBe(true);
    expect(diagnoseContentEntryCompleteness(model, entry)).toEqual([]);
    expect(entry).toMatchObject({ lifecycle: "draft", generation: 0 });
  });

  it("rejects impossible dates, unsafe URLs, unknown choices, wrong ref types, duplicate refs and malformed media", () => {
    expect(isValueValidForField({ kind: "date" }, "2026-02-29")).toBe(false);
    for (const url of ["javascript:alert(1)", "//example.com", "/\\example.com", "https://a b"]) expect(isValueValidForField({ kind: "url" }, url)).toBe(false);
    expect(isValueValidForField({ kind: "choice", options: [{ value: "a", label: "A" }] }, "b")).toBe(false);
    expect(isValueValidForField({ kind: "reference", target }, { ...ref, modelId: "wrong" })).toBe(false);
    expect(isValueValidForField({ kind: "reference-list", target, ordered: true }, [ref, ref])).toBe(false);
    expect(isValueValidForField({ kind: "media-use", use: "image" }, { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, notes: "Not alt" })).toBe(false);
    expect(isValueValidForField({ kind: "media-use", use: "image" }, { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "Wrong", decorative: true, caption: "" })).toBe(false);
  });

  it("keeps empty required lists incomplete and false/zero complete, including nested values", () => {
    const model = createContentModelRecord({ name: "Items", kind: "single", fields: [
      field({ kind: "boolean" }, "flag"), field({ kind: "number" }, "number"),
      field({ kind: "list", item: { kind: "text" } }, "list"),
      field({ kind: "reference-list", target, ordered: true }, "refs"),
      field({ kind: "object", fields: [field({ kind: "text" }, "title")] }, "object"),
      field({ kind: "media-use", use: "image" }, "image"),
    ] }, { id: "items", timestamp });
    const entry = createContentEntryRecord("items", { flag: false, number: 0, list: [], refs: [], object: {}, image: { kind: "image", asset: { providerId: "media-files", assetId: "asset" }, alt: "", decorative: false, caption: "" } }, { id: "entry", timestamp });
    expect(diagnoseContentEntryCompleteness(model, entry).map((issue) => issue.path)).toEqual([["list"], ["refs"], ["object", "title"], ["image"]]);
    expect(isValueValidForField(model.document.fields[5]!, entry.values.image)).toBe(true);
  });

  it("validates rich schema configuration and presentation dependencies", () => {
    const model = createContentModelRecord({ name: "Items", kind: "collection", fields: [field({ kind: "text" })], presentation: { groups: [{ id: "main", label: "Main", fieldIds: ["value"] }], views: [], inverses: [] } }, { id: "items", timestamp });
    expect(validateContentModelRecord(model).ok).toBe(true);
    model.document.presentation!.groups[0]!.fieldIds = ["missing"];
    expect(validateContentModelRecord(model).ok).toBe(false);
    const invalids = [{ kind: "choice", options: [] }, { kind: "reference" }, { kind: "reference-list", target }, { kind: "list", item: {} }, { kind: "object", fields: [field({ kind: "text" }), field({ kind: "number" })] }];
    for (const schema of invalids) {
      const invalid = createContentModelRecord({ name: "Invalid", kind: "collection", fields: [field(schema as ContentValueSchema)] }, { id: "invalid", timestamp });
      expect(validateContentModelRecord(invalid).ok).toBe(false);
    }
    expect(() => createContentValueSchema("reference")).toThrow("explicit target");
  });

  it("projects only per-use media text and traverses ordered nested leaves", () => {
    const use = { kind: "image" as const, asset: { providerId: "media-files", assetId: "asset" }, alt: "Per-use alt", decorative: false, caption: "Caption" };
    expect(projectContentMediaUse(use, "/immutable.png")).toEqual({ src: "/immutable.png", alt: "Per-use alt", decorative: false, caption: "Caption" });
    const model = createContentModelRecord({ name: "Items", kind: "collection", fields: [field({ kind: "list", item: { kind: "object", fields: [field({ kind: "media-use", use: "image" }, "image")] } })] }, { id: "items", timestamp });
    const entry = createContentEntryRecord("items", { value: [{ image: use }, { image: use }] }, { id: "entry", timestamp });
    expect(traverseContentValues(model, entry).filter((item) => item.schema.kind === "media-use").map((item) => item.path)).toEqual([["value", 0, "image"], ["value", 1, "image"]]);
  });
});
