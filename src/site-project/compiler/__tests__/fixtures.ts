import { createComponentCatalog } from "../../../composer/model/types";
import type { CompositionRecord } from "../../../composer/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../../content/model/types";
import type { MappingRecord } from "../../../mapping/model/types";
import type { SitemapNode } from "../../../sitemapper/model/types";
import type { SiteProject, SiteProjectCollectionAttachment } from "../../model/types";

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
    {
      id: "single-shell",
      schemaVersion: 1,
      title: "Single shell",
      category: "Test",
      description: "",
      source: { module: "@test/single-shell", exportKind: "named", exportName: "SingleShell" },
      defaults: {},
      fields: [],
      slots: [{ id: "body", prop: "body", label: "Body", cardinality: "single", accepts: ["leaf"] }],
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
      description: "",
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
    lifecycle: "published",
    generation: 0,
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
      schemaVersion: 2,
      id: "article-page",
      name: "Article page",
      contentModel: { providerId: "content-filesystem", recordId: "articles" },
      composition: { providerId: "files", recordId: compositionId },
      mode: { kind: "single" },
      bindings: [{ id: "title-binding", sourceFieldId: "title", projection: { kind: "value" }, target: { nodeId: `${compositionId}-leaf`, prop: "title" }, transform: { kind: "identity" } }],
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
  attachments?: SiteProjectCollectionAttachment[];
} = {}): SiteProject {
  const root = options.root ?? page("home", undefined, { kind: "composition", ref: { providerId: "files", recordId: "landing" } });
  const mappings = options.mappings ?? [mapping()];
  if (!options.mappings && root.source.kind === "mapping" && root.source.route.kind === "entry-field") mappings[0]!.document.mode = { kind: "collection", query: { publication: "include-drafts", conditions: [], sort: [], pins: [], limit: 100 } };
  return {
    schemaVersion: 2,
    id: "compiler-site",
    name: "Compiler site",
    componentPack: { contractVersion: 2, packId: "compiler-fixture", packVersion: "1.0.0" },
    providers: {
      compositions: [{ id: "files", records: options.compositions ?? [composition("landing", "Static")] }],
      content: [{ id: "content-filesystem", models: [options.contentModel ?? model()], entries: options.entries ?? [] }],
      mappings: [{ id: "mapping-filesystem", records: mappings }],
      sitemaps: [{ id: "sitemap-filesystem", records: [{ id: "main", createdAt: timestamp, updatedAt: timestamp, document: { schemaVersion: 3, navigation: { primary: [], footer: [] }, id: "main", name: "Main", root: [root] } }] }],
    },
    activeSitemap: { providerId: "sitemap-filesystem", recordId: "main" },
    collectionAttachments: options.attachments ?? [],
  };
}

export const mappingSource = (kind: "single" | "entry-field" = "entry-field", titleFieldId?: string) => ({
  kind: "mapping" as const,
  ref: { providerId: "mapping-filesystem", recordId: "article-page" },
  route: kind === "single" ? { kind: "single" as const } : { kind: "entry-field" as const, fieldId: "slug", ...(titleFieldId ? { titleFieldId } : {}) },
});
