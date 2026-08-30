import { describe, expect, it } from "vitest";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { SiteProject } from "../types";
import {
  canonicalizeSiteProject,
  compareUnicodeCodePoints,
  createInMemorySiteProjectAdapters,
  parseSiteProjectJson,
  serializeSiteProject,
  SITE_PROJECT_SCHEMA_VERSION,
  validateSiteProject,
} from "../index";

const timestamp = "2026-08-30T00:00:00.000Z";
const manifest: ComponentPackManifest = {
  kind: "zudo-composer/component-pack",
  contractVersion: 2,
  packId: "test-pack",
  packVersion: "1.0.0",
  components: [{
    id: "hero",
    schemaVersion: 1,
    title: "Hero",
    category: "Test",
    description: "",
    source: { module: "test-ui", exportKind: "named", exportName: "Hero" },
    defaults: {},
    fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } }],
    slots: [],
  }],
};
const context = { componentPack: manifest };
type MutableProject = SiteProject & { extra?: unknown };

function project(): SiteProject {
  const composition = {
    id: "landing",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 2 as const,
      id: "landing",
      name: "Landing",
      root: [{ id: "hero-node", componentId: "hero", componentVersion: 1, props: { title: "Hello" }, slots: {} }],
    },
  };
  const model = {
    id: "articles",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 1 as const,
      id: "articles",
      name: "Articles",
      kind: "collection" as const,
      fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" as const }],
    },
  };
  const entry = { schemaVersion: 1 as const, id: "welcome", modelId: "articles", createdAt: timestamp, updatedAt: timestamp, values: { title: "Welcome" } };
  const mapping = {
    id: "article-page",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 1 as const,
      id: "article-page",
      name: "Article page",
      contentModel: { providerId: "content-indexeddb", recordId: "articles" },
      composition: { providerId: "indexeddb" as const, recordId: "landing" },
      bindings: [{ id: "title-binding", sourceFieldId: "title", target: { nodeId: "hero-node", prop: "title" }, transform: { kind: "identity" as const } }],
    },
  };
  const sitemap = {
    id: "main",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 2 as const,
      id: "main",
      name: "Main",
      root: [{ id: "home", title: "Home", source: { kind: "mapping" as const, ref: { providerId: "mapping-indexeddb", recordId: "article-page" }, route: { kind: "single" as const } }, children: [] }],
    },
  };
  return {
    schemaVersion: SITE_PROJECT_SCHEMA_VERSION,
    id: "example-site",
    name: "Example site",
    componentPack: { contractVersion: manifest.contractVersion, packId: manifest.packId, packVersion: manifest.packVersion },
    providers: {
      compositions: [
        { id: "files", records: [{ ...structuredClone(composition), id: "landing", document: { ...structuredClone(composition.document), id: "landing" } }] },
        { id: "indexeddb", records: [composition] },
      ],
      content: [{ id: "content-indexeddb", models: [model], entries: [entry] }],
      mappings: [{ id: "mapping-indexeddb", records: [mapping] }],
      sitemaps: [{ id: "sitemap-indexeddb", records: [sitemap] }],
    },
    activeSitemap: { providerId: "sitemap-indexeddb", recordId: "main" },
  };
}

describe("SiteProject contract", () => {
  it("validates a provider-scoped graph and permits equal record ids in different providers", () => {
    expect(validateSiteProject(project(), context)).toEqual({ ok: true, project: project(), diagnostics: [] });
  });

  it("round-trips canonical JSON byte-stably independent of provider and record order", () => {
    const original = project();
    const permuted = structuredClone(original);
    permuted.providers.compositions.reverse();
    for (const provider of permuted.providers.compositions) provider.records.reverse();
    expect(serializeSiteProject(permuted)).toBe(serializeSiteProject(original));
    const parsed = parseSiteProjectJson(serializeSiteProject(original), context);
    expect(parsed).toEqual({ ok: true, project: canonicalizeSiteProject(original), diagnostics: [] });
    if (parsed.ok) expect(serializeSiteProject(parsed.project)).toBe(serializeSiteProject(original));
  });

  it("uses Unicode code-point order rather than locale or UTF-16 order", () => {
    expect(["\u{10000}", "\uE000"].sort(compareUnicodeCodePoints)).toEqual(["\uE000", "\u{10000}"]);
  });

  it.each([
    ["unknown top-level key", (value: MutableProject) => { value.extra = true; }, "invalid-keys", "$"],
    ["future aggregate", (value: MutableProject) => { (value as { schemaVersion: number }).schemaVersion = 2; }, "future-schema", "$.schemaVersion"],
    ["pack mismatch", (value: MutableProject) => { value.componentPack.packVersion = "2"; }, "component-pack-mismatch", "$.componentPack"],
    ["unknown provider", (value: MutableProject) => { value.providers.compositions[0]!.id = "arbitrary"; }, "unknown-provider", "$.providers.compositions[0].id"],
    ["duplicate provider", (value: MutableProject) => { value.providers.compositions.push(structuredClone(value.providers.compositions[1]!)); }, "duplicate-provider", "$.providers.compositions[2].id"],
    ["duplicate record", (value: MutableProject) => { value.providers.compositions[1]!.records.push(structuredClone(value.providers.compositions[1]!.records[0]!)); }, "duplicate-record", "$.providers.compositions[1].records[1].id"],
    ["unsafe project id", (value: MutableProject) => { value.id = "../bad"; }, "unsafe-id", "$.id"],
    ["missing active Sitemap", (value: MutableProject) => { value.activeSitemap.recordId = "missing"; }, "invalid-active-sitemap", "$.activeSitemap"],
    ["Entry/model mismatch", (value: MutableProject) => { value.providers.content[0]!.entries[0]!.modelId = "missing"; }, "dangling-content-model", "$.providers.content[0].entries[0].modelId"],
    ["dangling Mapping ref", (value: MutableProject) => { value.providers.mappings[0]!.records[0]!.document.composition.recordId = "missing"; }, "dangling-mapping-reference", "$.providers.mappings[0].records[0].document.composition"],
    ["wrong Mapping provider", (value: MutableProject) => { value.providers.mappings[0]!.records[0]!.document.composition.providerId = "files"; value.providers.compositions[0]!.records = []; }, "wrong-mapping-provider", "$.providers.mappings[0].records[0].document.composition"],
    ["dangling Sitemap ref", (value: MutableProject) => { const source = value.providers.sitemaps[0]!.records[0]!.document.root[0]!.source; if (source.kind === "mapping") source.ref.recordId = "missing"; }, "dangling-sitemap-reference", "$.providers.sitemaps[0].records[0].document.root[0].source.ref"],
    ["malformed domain record", (value: MutableProject) => { (value.providers.content[0]!.models[0] as unknown as Record<string, unknown>).extra = true; }, "malformed-record", "$.providers.content[0].models[0]"],
  ])("rejects %s with a golden diagnostic path", (_label, mutate, code, path) => {
    const value = project() as MutableProject;
    mutate(value);
    const result = validateSiteProject(value, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code, path }));
  });

  it("reports malformed JSON without throwing", () => {
    expect(parseSiteProjectJson("{", context)).toEqual({ ok: false, diagnostics: [{ severity: "error", code: "invalid-project", path: "$", message: "SiteProject JSON could not be parsed." }] });
  });
});

describe("in-memory SiteProject adapters", () => {
  it("exposes immutable provider-qualified stores, catalogs, and the active Sitemap", () => {
    const source = project();
    const adapters = createInMemorySiteProjectAdapters(source);
    source.providers.compositions[1]!.records[0]!.document.name = "mutated outside";
    expect(adapters.compositions.catalog.resolve({ providerId: "indexeddb", recordId: "landing" })?.document.name).toBe("Landing");
    expect(adapters.compositions.catalog.resolve({ providerId: "files", recordId: "landing" })).toBeDefined();
    expect(adapters.content.catalog.resolveModel({ providerId: "content-indexeddb", recordId: "articles" })?.id).toBe("articles");
    expect(adapters.content.catalog.listEntries({ providerId: "content-indexeddb", recordId: "articles" })).toHaveLength(1);
    expect(adapters.mappings.catalog.resolve({ providerId: "mapping-indexeddb", recordId: "article-page" })?.id).toBe("article-page");
    expect(adapters.activeSitemap.id).toBe("main");
    expect(Object.isFrozen(adapters.project)).toBe(true);
  });
});
