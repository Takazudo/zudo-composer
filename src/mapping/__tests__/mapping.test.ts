import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createComponentCatalog } from "../../composer/model/types";
import type { CompositionRecord } from "../../composer/library";
import { createContentCatalog } from "../../content/catalog";
import type { ContentEntryRecord, ContentFieldKind, ContentModelRecord } from "../../content/model";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_FIELD_KINDS, CONTENT_MODEL_SCHEMA_VERSION } from "../../content/model";
import { MAPPING_PROVIDERS, createCompositionCatalog, createMappingCatalog, createMappingRecord, discoverMappingTargets, evaluateCollectionQuery, evaluateMapping, evaluateResolvedMapping, isMappingCompatible, projectContentValue, resolveMappingDefinition, validateMappingRecord, validateMappingSourceProjection } from "..";
import type { MappingSeedOptions, MappingTransform, ScalarMappingTargetField } from "..";
import { createFilesystemMappingStore } from "../storage/filesystem";

const stamp = "2026-08-29T00:00:00.000Z";
const fields = [
  { id: "title", key: "title", label: "Title", required: true, kind: "text" },
  { id: "date", key: "date", label: "Date", required: false, kind: "date" },
  { id: "tone", key: "tone", label: "Tone", required: false, kind: "slug" },
] as const;
const model: ContentModelRecord = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { description: "", schemaVersion: CONTENT_MODEL_SCHEMA_VERSION, id: "articles", name: "Articles", kind: "collection", fields: [...fields] } };
const composition: CompositionRecord = { id: "landing", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 2, id: "landing", name: "Landing", root: [{ id: "hero", componentId: "hero", componentVersion: 1, props: { title: "Static", subtitle: "Keep", tone: "quiet" }, slots: { body: [{ id: "nested", componentId: "copy", componentVersion: 1, props: { text: "Nested" }, slots: {} }] } }] } };
const manifest = createComponentCatalog({ kind: "zudo-composer/component-pack", contractVersion: 2, packId: "test", packVersion: "1", components: [
  { id: "hero", schemaVersion: 1, title: "Hero", category: "Test", description: "", source: { module: "x", exportKind: "named", exportName: "Hero" }, defaults: {}, fields: [{ schema: { type: "string" }, editor: { kind: "text" }, prop: "title", label: "Title" }, { schema: { type: "string" }, editor: { kind: "text" }, prop: "subtitle", label: "Subtitle" }, { schema: { type: "string", enum: ["quiet", "loud"] }, editor: { kind: "select" }, prop: "tone", label: "Tone" }, { schema: { type: "array", items: { schema: { type: "string" }, editor: { kind: "text" } } }, editor: { kind: "list" }, prop: "tags", label: "Tags" }], slots: [{ id: "body", prop: "body", label: "Body", cardinality: "many" }] },
  { id: "copy", schemaVersion: 1, title: "Copy", category: "Test", description: "", source: { module: "x", exportKind: "named", exportName: "Copy" }, defaults: {}, fields: [{ schema: { type: "string" }, editor: { kind: "text" }, prop: "text", label: "Text" }], slots: [] },
] });

function mapping(bindings: NonNullable<MappingSeedOptions["bindings"]> = [{ id: "bind-title", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }]) { return createMappingRecord({ id: "article-landing", name: "Article landing", contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "files", recordId: "landing" }, bindings, createdAt: stamp }); }
function catalogs(contentRecord = model, compositionRecord = composition) { return { content: createContentCatalog([{ descriptor: { id: "content", label: "Content" }, store: { listModels: async () => [], getModel: async () => ({ status: "loaded" as const, record: contentRecord }) } }]), compositions: createCompositionCatalog([{ descriptor: { id: "files", label: "Compositions" }, store: { list: async () => [], get: async () => ({ status: "loaded" as const, record: compositionRecord }) } }]) }; }
function entry(values: ContentEntryRecord["values"]): ContentEntryRecord { return { lifecycle: "draft" as const, generation: 0, schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION, id: "entry-one", modelId: "articles", createdAt: stamp, updatedAt: stamp, values }; }

describe("normative compatibility matrix", () => {
  const sources: readonly ContentFieldKind[] = CONTENT_FIELD_KINDS;
  const scalarTargetFields = [
    { prop: "text", label: "Text", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "choice", label: "Choice", schema: { type: "string", enum: ["one"] }, editor: { kind: "select" } },
    { prop: "toggle", label: "Toggle", schema: { type: "boolean" }, editor: { kind: "boolean" } },
    { prop: "quantity", label: "Quantity", schema: { type: "number" }, editor: { kind: "number" } },
    { prop: "swatch", label: "Swatch", schema: { type: "string" }, editor: { kind: "color" } },
  ] as const satisfies readonly ScalarMappingTargetField[];
  const targets = scalarTargetFields.map((field) => field.editor.kind);
  const transforms: MappingTransform[] = [{ kind: "identity" }, { kind: "date-medium" }, { kind: "truncate-160" }, { kind: "prefix", prefix: "P" }];
  function expected(source: ContentFieldKind, target: (typeof targets)[number], transform: MappingTransform): boolean {
    const string = ["text", "long-text", "markdown", "date", "slug", "color", "url"].includes(source);
    if (transform.kind === "date-medium") return source === "date" && target === "text";
    if (transform.kind === "truncate-160" || transform.kind === "prefix") return string && target === "text";
    if (target === "text") return string;
    if (target === "select") return source === "text" || source === "slug";
    if (target === "color") return source === "color";
    if (target === "number") return source === "number";
    return source === "boolean";
  }
  for (const source of sources) for (const target of targets) for (const transform of transforms) it(`${source} -> ${target} via ${transform.kind}`, () => expect(isMappingCompatible(source, target, transform)).toBe(expected(source, target, transform)));
});

describe("Mapping model and resolver", () => {
  it("requires the clean-break mode field and validates collection query bounds", () => {
    const current = mapping();
    const withoutMode = structuredClone(current.document) as Partial<typeof current.document>;
    delete withoutMode.mode;
    expect(validateMappingRecord({ ...current, document: withoutMode }).ok).toBe(false);
    expect(current.document.bindings[0]?.projection).toEqual({ kind: "value" });
    const legacyBinding = structuredClone(current.document.bindings[0]!) as Partial<typeof current.document.bindings[number]>;
    delete legacyBinding.projection;
    expect(validateMappingRecord({ ...current, document: { ...current.document, bindings: [legacyBinding] } }).ok).toBe(false);
    expect(() => createMappingRecord({ ...current.document, id: "collection", createdAt: stamp, mode: { kind: "collection", query: { publication: "published-only", conditions: [], sort: [], pins: [], limit: 0 } } })).toThrow();
  });

  it("evaluates collection publication, conditions, stable sort, ordered deduplicated pins, and combined limit", () => {
    const entries = [
      { ...entry({ title: "Beta", tone: "quiet" }), id: "b", lifecycle: "published" as const },
      { ...entry({ title: "Alpha", tone: "quiet" }), id: "a", lifecycle: "published" as const },
      { ...entry({ title: "Alpha", tone: "quiet" }), id: "a2", lifecycle: "published" as const },
      { ...entry({ title: "Draft", tone: "quiet" }), id: "draft", lifecycle: "draft" as const },
    ];
    const result = evaluateCollectionQuery({ model, providerId: "content", entries, query: {
      publication: "published-only",
      conditions: [{ fieldId: "tone", operator: "equals", value: "quiet" }],
      sort: [{ fieldId: "title", direction: "asc" }],
      pins: [{ providerId: "content", modelId: "articles", recordId: "b" }, { providerId: "content", modelId: "articles", recordId: "b" }, { providerId: "content", modelId: "articles", recordId: "draft" }],
      limit: 3,
    } });
    expect(result.status).toBe("ready");
    expect(result.entries.map((item) => item.id)).toEqual(["b", "a", "a2"]);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["pin-ineligible"]);
  });

  it("blocks stale or unsupported query fields and validates list membership values", () => {
    const richModel: ContentModelRecord = { ...model, document: { ...model.document, fields: [...model.document.fields, { id: "meta", key: "meta", label: "Meta", required: false, kind: "object", fields: [] }, { id: "tags", key: "tags", label: "Tags", required: false, kind: "list", item: { kind: "text" } }] } };
    const blocked = evaluateCollectionQuery({ model: richModel, providerId: "content", entries: [], query: { publication: "include-drafts", conditions: [], sort: [{ fieldId: "meta", direction: "asc" }, { fieldId: "gone", direction: "asc" }], pins: [], limit: 5 } });
    expect(blocked.diagnostics.map((item) => item.code)).toEqual(["stale-query-field", "unsupported-query-field"]);
    const contained = evaluateCollectionQuery({ model: richModel, providerId: "content", entries: [{ ...entry({ tags: ["news"] }), id: "tagged" }], query: { publication: "include-drafts", conditions: [{ fieldId: "tags", operator: "contains", value: "news" }], sort: [], pins: [], limit: 5 } });
    expect(contained).toMatchObject({ status: "ready", entries: [{ id: "tagged" }], diagnostics: [] });
  });

  it("uses canonical structural equality and rejects reference sorting", () => {
    const objectFields = [{ id: "left", key: "left", label: "Left", required: true, kind: "text" as const }, { id: "right", key: "right", label: "Right", required: true, kind: "text" as const }];
    const richModel: ContentModelRecord = { ...model, document: { ...model.document, fields: [
      ...model.document.fields,
      { id: "payload", key: "payload", label: "Payload", required: false, kind: "object", fields: objectFields },
      { id: "items", key: "items", label: "Items", required: false, kind: "list", item: { kind: "object", fields: objectFields } },
      { id: "related", key: "related", label: "Related", required: false, kind: "reference", target: { providerId: "content", recordId: "articles" } },
    ] } };
    const candidate = { ...entry({ payload: { left: "a", right: "b" }, items: [{ left: "a", right: "b" }] }), id: "candidate" };
    const canonical = evaluateCollectionQuery({ model: richModel, providerId: "content", entries: [candidate], query: { publication: "include-drafts", conditions: [
      { fieldId: "payload", operator: "equals", value: { right: "b", left: "a" } },
      { fieldId: "items", operator: "contains", value: { right: "b", left: "a" } },
    ], sort: [], pins: [], limit: 5 } });
    expect(canonical.entries.map((item) => item.id)).toEqual(["candidate"]);
    const referenceSort = evaluateCollectionQuery({ model: richModel, providerId: "content", entries: [candidate], query: { publication: "include-drafts", conditions: [], sort: [{ fieldId: "related", direction: "asc" }], pins: [], limit: 5 } });
    expect(referenceSort).toMatchObject({ status: "blocked", diagnostics: [{ code: "unsupported-query-field", fieldId: "related" }] });
  });

  it("projects structured, asset, reference, and explicit route-link values without object coercion", () => {
    const richField = { id: "meta", key: "meta", label: "Meta", required: false, kind: "object" as const, fields: [{ id: "label", key: "label", label: "Label", required: false, kind: "text" as const }] };
    const richEntry = { ...entry({}), values: { meta: { label: "Exact" } } };
    expect(projectContentValue({ field: richField, entry: richEntry, projection: { kind: "object-field", fieldIds: ["label"] }, providerId: "content" })).toEqual({ status: "projected", value: "Exact" });
    expect(projectContentValue({ field: richField, entry: richEntry, projection: { kind: "value" }, providerId: "content" })).toEqual({ status: "projected", value: { label: "Exact" } });
    const assetField = { id: "image", key: "image", label: "Image", required: false, kind: "asset-use" as const, use: "image" as const };
    const assetEntry = { ...entry({}), values: { image: { kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "Hero", decorative: false, caption: "Caption" } } };
    expect(projectContentValue({ field: assetField, entry: assetEntry, projection: { kind: "asset-ref" }, providerId: "content" })).toEqual({ status: "projected", value: { providerId: "asset-files", assetId: "hero" } });
    expect(projectContentValue({ field: assetField, entry: assetEntry, projection: { kind: "asset-text", field: "alt" }, providerId: "content" })).toEqual({ status: "projected", value: "Hero" });
    const referenceField = { id: "related", key: "related", label: "Related", required: false, kind: "reference" as const, target: { providerId: "content", recordId: "articles" } };
    const referenceEntry = { ...entry({}), values: { related: { providerId: "content", modelId: "articles", recordId: "next" } } };
    expect(projectContentValue({ field: referenceField, entry: referenceEntry, projection: { kind: "route-link" }, providerId: "content" }).status).toBe("route-context-unavailable");
    expect(projectContentValue({ field: referenceField, entry: referenceEntry, projection: { kind: "route-link" }, providerId: "content", routeResolver: { resolve: () => ({ status: "resolved", href: "/next" }) } })).toEqual({ status: "projected", value: "/next" });
    expect(projectContentValue({ field: referenceField, entry: referenceEntry, projection: { kind: "reference-list-ids" }, providerId: "content" }).status).toBe("invalid");
    expect(validateMappingSourceProjection({ kind: "object-field", fieldIds: [] })).toBe(false);
    expect(validateMappingSourceProjection({ kind: "route-link", fallback: "/fake" })).toBe(false);
  });
  it("resolves and evaluates persisted structured, asset, reference, and route-link projections", async () => {
    const cases = [
      {
        field: { id: "source", key: "source", label: "Source", required: true, kind: "object" as const, fields: [{ id: "label", key: "label", label: "Label", required: true, kind: "text" as const }] },
        projection: { kind: "object-field" as const, fieldIds: ["label"] }, value: { label: "Structured" }, expected: "Structured",
      },
      {
        field: { id: "source", key: "source", label: "Source", required: true, kind: "asset-use" as const, use: "image" as const },
        projection: { kind: "asset-text" as const, field: "alt" as const }, value: { kind: "image", asset: { providerId: "asset-files", assetId: "hero" }, alt: "Asset", decorative: false, caption: "" }, expected: "Asset",
      },
      {
        field: { id: "source", key: "source", label: "Source", required: true, kind: "reference" as const, target: { providerId: "content", recordId: "articles" } },
        projection: { kind: "reference-id" as const }, value: { providerId: "content", modelId: "articles", recordId: "related" }, expected: "related",
      },
    ];
    for (const item of cases) {
      const projectedModel: ContentModelRecord = { ...model, document: { ...model.document, fields: [item.field] } };
      const record = mapping([{ id: "projected", sourceFieldId: "source", projection: item.projection, target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }]);
      const result = await evaluateMapping(record, entry({ source: item.value as unknown as ContentEntryRecord["values"][string] }), catalogs(projectedModel), manifest);
      expect(result.status).toBe("ready");
      expect(result.document?.root[0]?.props.title).toBe(item.expected);
    }
    const referenceModel: ContentModelRecord = { ...model, document: { ...model.document, fields: [{ id: "source", key: "source", label: "Source", required: true, kind: "reference", target: { providerId: "content", recordId: "articles" } }] } };
    const routeMapping = mapping([{ id: "route", sourceFieldId: "source", projection: { kind: "route-link" }, target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }]);
    const source = entry({ source: { providerId: "content", modelId: "articles", recordId: "related" } });
    expect((await evaluateMapping(routeMapping, source, catalogs(referenceModel), manifest)).entryDiagnostics[0]?.code).toBe("route-context-unavailable");
    const routed = await evaluateMapping(routeMapping, source, catalogs(referenceModel), manifest, { routeResolver: { resolve: () => ({ status: "resolved", href: "/related" }) } });
    expect(routed.document?.root[0]?.props.title).toBe("/related");
  });
  it("preserves broken references structurally and reports them semantically", async () => { const record = mapping([{ id: "stale", sourceFieldId: "gone", target: { nodeId: "missing", prop: "old" }, transform: { kind: "identity" } }]); expect(validateMappingRecord(record).ok).toBe(true); const result = await resolveMappingDefinition(record, catalogs(), manifest); expect(result.status).toBe("blocked"); expect(result.diagnostics.map((item) => item.code)).toEqual(["source-field-missing", "target-node-missing"]); });
  it("discovers only recursively manifest-declared scalar targets", () => { const result = discoverMappingTargets(composition.document, manifest); expect(result.targets.map((item) => `${item.target.nodeId}.${item.target.prop}`)).toEqual(["hero.title", "hero.subtitle", "hero.tone", "nested.text"]); expect(result.targets.some((item) => item.target.prop === "undeclared")).toBe(false); });
  it("rejects a structured component field with an explicit diagnostic", async () => { const result = await resolveMappingDefinition(mapping([{ id: "tags", sourceFieldId: "title", target: { nodeId: "hero", prop: "tags" }, transform: { kind: "identity" } }]), catalogs(), manifest); expect(result.status).toBe("blocked"); expect(result.diagnostics).toMatchObject([{ code: "structured-target-unsupported", target: { nodeId: "hero", prop: "tags" } }]); expect(result.diagnostics[0]?.message).toContain("cannot be used as a scalar mapping target"); expect(result.bindings).toEqual([]); });
  it("allows one source to many targets but blocks a duplicate target", async () => { const result = await resolveMappingDefinition(mapping([{ id: "one", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }, { id: "two", sourceFieldId: "title", target: { nodeId: "nested", prop: "text" }, transform: { kind: "truncate-160" } }]), catalogs(), manifest); expect(result.status).toBe("ready"); const duplicate = await resolveMappingDefinition(mapping([{ id: "one", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }, { id: "two", sourceFieldId: "tone", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }]), catalogs(), manifest); expect(duplicate.diagnostics.map((item) => item.code)).toContain("duplicate-target"); });
  it("reports component version and stale field failures", async () => { const changed = structuredClone(composition); changed.document.root[0]!.componentVersion = 2; const mismatch = await resolveMappingDefinition(mapping(), catalogs(model, changed), manifest); expect(mismatch.diagnostics.map((item) => item.code)).toContain("component-version-mismatch"); const stale = await resolveMappingDefinition(mapping([{ id: "x", sourceFieldId: "title", target: { nodeId: "hero", prop: "gone" }, transform: { kind: "identity" } }]), catalogs(), manifest); expect(stale.diagnostics.map((item) => item.code)).toContain("target-field-missing"); });
  it("evaluates into a detached transient document and keeps static values", async () => { const record = mapping([{ id: "one", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }, { id: "two", sourceFieldId: "date", target: { nodeId: "hero", prop: "subtitle" }, transform: { kind: "date-medium" } }]); const source = entry({ title: "Mapped", date: "2026-08-29" }); const beforeEntry = JSON.stringify(source); const beforeComposition = JSON.stringify(composition); const result = await evaluateMapping(record, source, catalogs(), manifest); expect(result.status).toBe("ready"); expect(result.document?.root[0]?.props).toMatchObject({ title: "Mapped", subtitle: "Aug 29, 2026", tone: "quiet" }); expect(JSON.stringify(source)).toBe(beforeEntry); expect(JSON.stringify(composition)).toBe(beforeComposition); expect(result).toMatchObject({ appliedBindingCount: 2, unchangedStaticCount: 0 }); });
  it("synchronously reevaluates a resolved definition with exact Markdown identity and no mutation", async () => { const markdownModel: ContentModelRecord = { ...model, document: { ...model.document, fields: [{ id: "body", key: "body", label: "Body", required: true, kind: "markdown" }] } }; const record = mapping([{ id: "markdown", sourceFieldId: "body", target: { nodeId: "nested", prop: "text" }, transform: { kind: "identity" } }]); const definition = await resolveMappingDefinition(record, catalogs(markdownModel), manifest); const draft = entry({ body: "## Unsaved\n\n**exact** markdown" }); const beforeDefinition = structuredClone(definition); const beforeDraft = structuredClone(draft); const result = evaluateResolvedMapping(definition, draft); expect(result.document?.root[0]?.slots.body?.[0]?.props.text).toBe("## Unsaved\n\n**exact** markdown"); expect(definition).toEqual(beforeDefinition); expect(draft).toEqual(beforeDraft); expect(result.document).not.toBe(definition.composition?.document); });
  it("reports optional and required missing independently", async () => { const record = mapping([{ id: "required", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "identity" } }, { id: "optional", sourceFieldId: "date", target: { nodeId: "hero", prop: "subtitle" }, transform: { kind: "date-medium" } }]); const result = await evaluateMapping(record, entry({}), catalogs(), manifest); expect(result.status).toBe("blocked"); expect(result.entryDiagnostics.map((item) => [item.code, item.severity])).toEqual([["required-value-missing", "blocking"], ["optional-value-missing", "nonblocking"]]); expect(result.document?.root[0]?.props).toMatchObject({ title: "Static", subtitle: "Keep" }); });
  it("uses Content whitespace semantics and treats null as an invalid present value", async () => { const whitespace = await evaluateMapping(mapping(), entry({ title: "  \n" }), catalogs(), manifest); expect(whitespace.entryDiagnostics[0]?.code).toBe("required-value-missing"); const invalid = await evaluateMapping(mapping(), entry({ title: null }), catalogs(), manifest); expect(invalid.entryDiagnostics[0]?.code).toBe("invalid-source-value"); });
  it("validates dates, select options, and Unicode transform limits", async () => { const select = await evaluateMapping(mapping([{ id: "select", sourceFieldId: "tone", target: { nodeId: "hero", prop: "tone" }, transform: { kind: "identity" } }]), entry({ tone: "invalid" }), catalogs(), manifest); expect(select.entryDiagnostics[0]?.code).toBe("select-option-invalid"); const date = await evaluateMapping(mapping([{ id: "date", sourceFieldId: "date", target: { nodeId: "hero", prop: "subtitle" }, transform: { kind: "date-medium" } }]), entry({ date: "2026-02-30" }), catalogs(), manifest); expect(date.entryDiagnostics[0]?.code).toBe("invalid-canonical-date"); const long = "😀".repeat(161); const truncated = await evaluateMapping(mapping([{ id: "unicode", sourceFieldId: "title", target: { nodeId: "hero", prop: "title" }, transform: { kind: "truncate-160" } }]), entry({ title: long }), catalogs(), manifest); expect(Array.from(String(truncated.document?.root[0]?.props.title))).toHaveLength(161); expect(String(truncated.document?.root[0]?.props.title).endsWith("…")).toBe(true); expect(validateMappingRecord({ ...mapping(), document: { ...mapping().document, bindings: [{ id: "x", sourceFieldId: "title", projection: { kind: "value" }, target: { nodeId: "hero", prop: "title" }, transform: { kind: "prefix", prefix: "😀".repeat(81) } }] } }).ok).toBe(false); });
  it("distinguishes missing, invalid, and provider errors", async () => { const missing = createContentCatalog([{ descriptor: { id: "content", label: "Content" }, store: { listModels: async () => [], getModel: async () => ({ status: "not-found" as const, id: "articles" }) } }]); const failed = createCompositionCatalog([{ descriptor: { id: "files", label: "Compositions" }, store: { list: async () => [], get: async () => { throw new Error("offline"); } } }]); const result = await resolveMappingDefinition(mapping(), { content: missing, compositions: failed }, manifest); expect(result.diagnostics.map((item) => item.code)).toEqual(["content-model-not-found", "composition-provider-error"]); });
});

describe("Mapping catalog over the filesystem store", () => {
  const sandboxes: string[] = [];
  afterEach(async () => {
    await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("exposes listed/resolved Mapping catalog outcomes", async () => {
    const mappingsRoot = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-mapping-catalog-")));
    sandboxes.push(mappingsRoot);
    const store = await createFilesystemMappingStore({ mappingsRoot });
    await store.put(mapping());
    const providerId = MAPPING_PROVIDERS.filesystem.id;
    const catalog = createMappingCatalog([{ descriptor: MAPPING_PROVIDERS.filesystem, store }]);
    expect(await catalog.list()).toMatchObject({ status: "listed", entries: [{ ref: { providerId, recordId: "article-landing" } }], failures: [] });
    expect(await catalog.resolve({ providerId, recordId: "article-landing" })).toMatchObject({ status: "resolved", record: { id: "article-landing" } });
    expect(await catalog.resolve({ providerId: "missing", recordId: "article-landing" })).toEqual({ status: "not-found" });
  });
});
