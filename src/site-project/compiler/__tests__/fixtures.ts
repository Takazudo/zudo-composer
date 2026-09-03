import { createComponentCatalog } from "../../../composer/model/types";
import type { CompositionRecord } from "../../../composer/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../../content/model/types";
import type { MappingRecord } from "../../../mapping/model/types";
import type { SitemapNode } from "../../../sitemapper/model/types";
import type { SiteProject } from "../../model/types";

export const timestamp = "2026-08-31T00:00:00.000Z";

export const componentCatalog = createComponentCatalog({
  kind: "zudo-composer/component-pack",
  contractVersion: 2,
  packId: "compiler-fixture",
  packVersion: "1.0.0",
  components: [
    {
      id: "shell",
      schemaVersion: 1,
      title: "Shell",
      category: "Test",
      description: "",
      source: { module: "@test/shell", exportKind: "named", exportName: "Shell" },
      defaults: {},
      fields: [],
      slots: [{ id: "body", prop: "body", label: "Body", cardinality: "many", accepts: ["leaf"] }],
    },
    {
      id: "leaf",
      schemaVersion: 1,
      title: "Leaf",
      category: "Test",
      description: "",
      source: { module: "@test/leaf", exportKind: "named", exportName: "Leaf" },
      defaults: { title: "" },
      fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" }, required: true }],
      slots: [],
    },
  ],
});

export function composition(id: string, title = id): CompositionRecord {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 2,
      id,
      name: id,
      root: [{ id: `${id}-leaf`, componentId: "leaf", componentVersion: 1, props: { title }, slots: {} }],
    },
  };
}

export function globalTemplate(id = "shell"): CompositionRecord {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 2,
      id,
      name: id,
      root: [{ id: `${id}-root`, componentId: "shell", componentVersion: 1, props: {}, slots: { body: [] } }],
      publication: { kind: "global-template", outlet: { id: "main", label: "Main", target: { parentId: `${id}-root`, slotId: "body" } } },
    },
  };
}

export function linkedComposition(id = "linked", sourceRecordId = "shell", outletId = "main"): CompositionRecord {
  const record = composition(id, "Linked local");
  record.document.binding = { sourceRecordId, outletId };
  return record;
}

export function model(kind: "single" | "collection" = "collection"): ContentModelRecord {
  return {
    id: "articles",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 1,
      id: "articles",
      name: "Articles",
      kind,
      fields: [
        { id: "title", key: "title", label: "Title", required: true, kind: "text" },
        { id: "slug", key: "slug", label: "Slug", required: true, kind: "slug" },
      ],
    },
  };
}

export function entry(id: string, title: unknown = id, slug: unknown = id): ContentEntryRecord {
  return {
    schemaVersion: 1,
    id,
    modelId: "articles",
    createdAt: timestamp,
    updatedAt: timestamp,
    values: { title, slug } as ContentEntryRecord["values"],
  };
}

export function mapping(compositionId = "landing"): MappingRecord {
  return {
    id: "article-page",
    createdAt: timestamp,
    updatedAt: timestamp,
    document: {
      schemaVersion: 1,
      id: "article-page",
      name: "Article page",
      contentModel: { providerId: "content-indexeddb", recordId: "articles" },
      composition: { providerId: "indexeddb", recordId: compositionId },
      bindings: [{ id: "title-binding", sourceFieldId: "title", target: { nodeId: `${compositionId}-leaf`, prop: "title" }, transform: { kind: "identity" } }],
    },
  };
}

export function page(id: string, slug: string | undefined, source: SitemapNode["source"], children: SitemapNode[] = []): SitemapNode {
  return { id, title: id, ...(slug === undefined ? {} : { slug }), source, children };
}

export function project(options: {
  root?: SitemapNode;
  compositions?: CompositionRecord[];
  contentModel?: ContentModelRecord;
  entries?: ContentEntryRecord[];
  mappings?: MappingRecord[];
} = {}): SiteProject {
  const root = options.root ?? page("home", undefined, { kind: "composition", ref: { providerId: "indexeddb", recordId: "landing" } });
  return {
    schemaVersion: 1,
    id: "compiler-site",
    name: "Compiler site",
    componentPack: { contractVersion: 2, packId: "compiler-fixture", packVersion: "1.0.0" },
    providers: {
      compositions: [{ id: "indexeddb", records: options.compositions ?? [composition("landing", "Static")] }],
      content: [{ id: "content-indexeddb", models: [options.contentModel ?? model()], entries: options.entries ?? [] }],
      mappings: [{ id: "mapping-indexeddb", records: options.mappings ?? [mapping()] }],
      sitemaps: [{ id: "sitemap-indexeddb", records: [{ id: "main", createdAt: timestamp, updatedAt: timestamp, document: { schemaVersion: 2, id: "main", name: "Main", root: [root] } }] }],
    },
    activeSitemap: { providerId: "sitemap-indexeddb", recordId: "main" },
  };
}

export const mappingSource = (kind: "single" | "entry-field" = "entry-field", titleFieldId?: string) => ({
  kind: "mapping" as const,
  ref: { providerId: "mapping-indexeddb", recordId: "article-page" },
  route: kind === "single" ? { kind: "single" as const } : { kind: "entry-field" as const, fieldId: "slug", ...(titleFieldId ? { titleFieldId } : {}) },
});
