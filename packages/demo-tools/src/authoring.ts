// The TypeScript authoring surface behind every demo package's `site-project.ts`.
//
// A demo site is a whole SiteProject aggregate — compositions, content models
// and entries, mappings, collection attachments and one sitemap — and writing
// that aggregate by hand means repeating record envelopes, provider ids and
// field ids everywhere. This module derives all of that: records take their
// ids from names, content entries are keyed by field KEY rather than field id,
// and every provider is the tool's filesystem provider for that domain.
//
// It produces the same shape `src/test/site-project-fixture.json` has, so the
// tool's own validator, compiler and release CLI accept the output unchanged.

import type { ComponentPackManifest, JsonValue, TrustedComponentPack } from "@zudo-composer/component-contract";
import type { CompositionRecord } from "../../../src/composer/library/types";
import type { CompositionNode, GlobalTemplateOutlet } from "../../../src/composer/model/types";
import type {
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelRecord,
  ContentValueSchema,
} from "../../../src/content/model/types";
import type {
  MappingBinding,
  MappingCollectionQuery,
  MappingRecord,
  MappingSourceProjection,
  MappingTransform,
} from "../../../src/mapping/model/types";
import type { SitemapRecord } from "../../../src/sitemapper/library/types";
import type { SitemapNavigationItem, SitemapNode } from "../../../src/sitemapper/model/types";
import type { SiteProject, SiteProjectCollectionAttachment } from "../../../src/site-project/model/types";

export const COMPOSITION_PROVIDER_ID = "files";
export const CONTENT_PROVIDER_ID = "content-filesystem";
export const MAPPING_PROVIDER_ID = "mapping-filesystem";
export const SITEMAP_PROVIDER_ID = "sitemap-filesystem";

/** Every generated record carries one fixed timestamp so regeneration is byte-stable. */
export const DEFAULT_TIMESTAMP = "2026-09-12T00:00:00.000Z";

export type JsonObject = { [key: string]: JsonValue };

/** `Product card` → `product-card`; matches the tool's safe record-id pattern. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`Cannot derive a record id from "${name}".`);
  return slug;
}

export interface NodeInput {
  id?: string;
  componentId: string;
  props?: JsonObject;
  slots?: Record<string, NodeInput[]>;
}

/** One composition node. Omitted ids are derived per composition from the component id and position. */
export function node(componentId: string, props: JsonObject = {}, slots: Record<string, NodeInput[]> = {}, id?: string): NodeInput {
  return { ...(id === undefined ? {} : { id }), componentId, props, slots };
}

export interface TemplateInput {
  id?: string;
  name: string;
  root: NodeInput[];
  outlet: { id?: string; label?: string; target: { parentId: string; slotId: string } };
}

export interface Template {
  id: string;
  outlet: GlobalTemplateOutlet;
  record: CompositionRecord;
}

export interface PageInput {
  id?: string;
  name: string;
  root: NodeInput[];
  /** Bind this page into a global template's outlet. A detached page (no template) is what a collection mapping needs. */
  template?: Template;
}

export interface Page {
  id: string;
  record: CompositionRecord;
}

export type FieldInput =
  & { key: string; label?: string; required?: boolean }
  & (
    | { kind: "text" | "long-text" | "markdown" | "number" | "boolean" | "date" | "slug" | "color" | "url" }
    | { kind: "choice"; options: { value: string; label: string }[] }
    | { kind: "reference"; target: Model }
    | { kind: "reference-list"; target: Model; ordered?: boolean }
    | { kind: "object"; fields: FieldInput[] }
    | { kind: "list"; item: ContentValueSchema }
    | { kind: "asset-use"; use: "image" | "link" | "download" | "card" }
  );

export interface ModelInput {
  id?: string;
  name: string;
  kind: "single" | "collection";
  description?: string;
  fields: FieldInput[];
}

export interface Model {
  id: string;
  record: ContentModelRecord;
  /** Field key → field id, the lookup every entry, mapping and sitemap route uses. */
  fieldId(key: string): string;
}

export interface EntryInput {
  id?: string;
  /** Values keyed by field KEY. `reference` / `reference-list` values are `entryRef(...)` objects. */
  values: Record<string, JsonValue>;
  lifecycle?: "draft" | "published";
}

export interface Entry {
  id: string;
  modelId: string;
  record: ContentEntryRecord;
}

export interface BindingInput {
  field: string;
  nodeId: string;
  prop: string;
  projection?: MappingSourceProjection;
  transform?: MappingTransform;
  id?: string;
}

export interface CollectionModeInput {
  kind: "collection";
  sort?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  publication?: MappingCollectionQuery["publication"];
  conditions?: { field: string; operator: MappingCollectionQuery["conditions"][number]["operator"]; value?: JsonValue }[];
}

export interface MappingInput {
  id?: string;
  name: string;
  model: Model;
  composition: Page;
  mode?: { kind: "single" } | CollectionModeInput;
  bindings: BindingInput[];
}

export interface Mapping {
  id: string;
  model: Model;
  composition: Page;
  record: MappingRecord;
}

export interface Attachment {
  id: string;
  record: SiteProjectCollectionAttachment;
}

export type RouteSource =
  | { page: Page }
  | { mapping: Mapping; route?: "single" }
  | { mapping: Mapping; route: "entry-field"; field: string; titleField?: string };

export type RouteInput = {
  id?: string;
  title: string;
  slug?: string;
  notes?: string;
  children?: RouteInput[];
} & RouteSource;

export interface NavigationRef {
  route: RouteInput;
  label?: string;
  visible?: boolean;
  id?: string;
}

export interface SitemapInput {
  id?: string;
  name: string;
  root: RouteInput;
  navigation?: { primary?: NavigationRef[]; footer?: NavigationRef[] };
}

export interface SiteOptions {
  id: string;
  name: string;
  componentPack: TrustedComponentPack | { manifest: ComponentPackManifest };
  timestamp?: string;
}

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly manifest: ComponentPackManifest;
  template(input: TemplateInput): Template;
  page(input: PageInput): Page;
  model(input: ModelInput): Model;
  entry(model: Model, input: EntryInput): Entry;
  mapping(input: MappingInput): Mapping;
  /**
   * Materialise a collection mapping's composition once per entry into a named
   * slot of `target.nodeId`. The node's owner composition is found among the
   * pages and templates declared so far; pass `composition` when the node id
   * appears in more than one.
   */
  attach(mapping: Mapping, target: { nodeId: string; slotId: string; composition?: Page | Template }, id?: string): Attachment;
  sitemap(input: SitemapInput): SitemapRecord;
  toSiteProject(): SiteProject;
}

function assertNew(registry: Map<string, unknown>, id: string, kind: string): void {
  if (registry.has(id)) throw new Error(`Duplicate ${kind} id "${id}".`);
}

interface NodeBuildContext {
  compositionId: string;
  packId: string;
  /** Component id → `schemaVersion`, the `componentVersion` every node is stamped with. */
  componentVersions: ReadonlyMap<string, number>;
  seen: Set<string>;
  next: number;
}

function buildNodes(context: NodeBuildContext, inputs: readonly NodeInput[]): CompositionNode[] {
  return inputs.map((input) => {
    const componentVersion = context.componentVersions.get(input.componentId);
    if (componentVersion === undefined) throw new Error(`Component "${input.componentId}" is not in pack "${context.packId}".`);
    const id = input.id ?? `${context.compositionId}-${slugify(input.componentId)}-${context.next++}`;
    if (context.seen.has(id)) throw new Error(`Duplicate node id "${id}" in composition "${context.compositionId}".`);
    context.seen.add(id);
    const slots: Record<string, CompositionNode[]> = {};
    for (const [slotId, children] of Object.entries(input.slots ?? {})) slots[slotId] = buildNodes(context, children);
    return { id, componentId: input.componentId, componentVersion, props: { ...(input.props ?? {}) }, slots };
  });
}

/** `publishedOn` → `published-on`, so derived field ids keep the key's word boundaries. */
function kebabFromKey(key: string): string {
  return slugify(key.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}

function buildField(modelId: string, input: FieldInput): ContentFieldDefinition {
  const base = { id: `${modelId}-${kebabFromKey(input.key)}`, key: input.key, label: input.label ?? labelFromKey(input.key), required: input.required ?? true };
  switch (input.kind) {
    case "choice": return { ...base, kind: "choice", options: input.options };
    case "reference": return { ...base, kind: "reference", target: { providerId: CONTENT_PROVIDER_ID, recordId: input.target.id } };
    case "reference-list": return { ...base, kind: "reference-list", target: { providerId: CONTENT_PROVIDER_ID, recordId: input.target.id }, ordered: input.ordered ?? true };
    case "object": return { ...base, kind: "object", fields: input.fields.map((field) => buildField(base.id, field)) };
    case "list": return { ...base, kind: "list", item: input.item };
    case "asset-use": return { ...base, kind: "asset-use", use: input.use };
    default: return { ...base, kind: input.kind };
  }
}

function labelFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function defineSite(options: SiteOptions): Site {
  const timestamp = options.timestamp ?? DEFAULT_TIMESTAMP;
  const manifest = options.componentPack.manifest;
  const compositions = new Map<string, CompositionRecord>();
  const models = new Map<string, ContentModelRecord>();
  const entries = new Map<string, ContentEntryRecord>();
  const mappings = new Map<string, MappingRecord>();
  const attachments = new Map<string, SiteProjectCollectionAttachment>();
  let sitemap: SitemapRecord | undefined;
  const envelope = { createdAt: timestamp, updatedAt: timestamp };

  const componentVersions = new Map(manifest.components.map((component) => [component.id, component.schemaVersion]));
  const composition = (id: string, root: NodeInput[]): CompositionNode[] => {
    assertNew(compositions, id, "composition");
    return buildNodes({ compositionId: id, packId: manifest.packId, componentVersions, seen: new Set(), next: 1 }, root);
  };

  const site: Site = {
    id: options.id,
    name: options.name,
    manifest,

    template(input) {
      const id = input.id ?? slugify(input.name);
      const root = composition(id, input.root);
      const outlet: GlobalTemplateOutlet = { id: input.outlet.id ?? `${id}-outlet`, label: input.outlet.label ?? "Main content", target: input.outlet.target };
      const record: CompositionRecord = { id, ...envelope, document: { schemaVersion: 2, id, name: input.name, root, publication: { kind: "global-template", outlet } } };
      compositions.set(id, record);
      return { id, outlet, record };
    },

    page(input) {
      const id = input.id ?? slugify(input.name);
      const root = composition(id, input.root);
      const record: CompositionRecord = {
        id,
        ...envelope,
        document: {
          schemaVersion: 2,
          id,
          name: input.name,
          root,
          ...(input.template ? { binding: { sourceRecordId: input.template.id, outletId: input.template.outlet.id } } : {}),
        },
      };
      compositions.set(id, record);
      return { id, record };
    },

    model(input) {
      const id = input.id ?? slugify(input.name);
      assertNew(models, id, "content model");
      const fields = input.fields.map((field) => buildField(id, field));
      const byKey = new Map(fields.map((field) => [field.key, field.id]));
      if (byKey.size !== fields.length || new Set(byKey.values()).size !== fields.length) throw new Error(`Model "${id}" declares a duplicate field key.`);
      const record: ContentModelRecord = { id, ...envelope, document: { schemaVersion: 1, id, name: input.name, description: input.description ?? "", kind: input.kind, fields } };
      models.set(id, record);
      return {
        id,
        record,
        fieldId(key) {
          const fieldId = byKey.get(key);
          if (fieldId === undefined) throw new Error(`Model "${id}" has no field "${key}".`);
          return fieldId;
        },
      };
    },

    entry(model, input) {
      const id = input.id ?? deriveEntryId(model, input.values);
      assertNew(entries, id, "content entry");
      const values: Record<string, JsonValue> = {};
      const fields = model.record.document.fields;
      for (const [key, value] of Object.entries(input.values)) values[model.fieldId(key)] = valueByFieldId(fields.find((field) => field.key === key)!, value);
      const record: ContentEntryRecord = { schemaVersion: 1, id, modelId: model.id, ...envelope, values, lifecycle: input.lifecycle ?? "published", generation: 0 };
      entries.set(id, record);
      return { id, modelId: model.id, record };
    },

    mapping(input) {
      const id = input.id ?? slugify(input.name);
      assertNew(mappings, id, "mapping");
      const bindings: MappingBinding[] = input.bindings.map((binding) => ({
        id: binding.id ?? `${id}-${slugify(binding.field)}-${slugify(binding.prop)}`,
        sourceFieldId: input.model.fieldId(binding.field),
        projection: binding.projection ?? { kind: "value" },
        target: { nodeId: binding.nodeId, prop: binding.prop },
        transform: binding.transform ?? { kind: "identity" },
      }));
      const mode = input.mode ?? { kind: "single" };
      const record: MappingRecord = {
        id,
        ...envelope,
        document: {
          schemaVersion: 2,
          id,
          name: input.name,
          contentModel: { providerId: CONTENT_PROVIDER_ID, recordId: input.model.id },
          composition: { providerId: COMPOSITION_PROVIDER_ID, recordId: input.composition.id },
          mode: mode.kind === "single" ? { kind: "single" } : {
            kind: "collection",
            query: {
              publication: mode.publication ?? "published-only",
              conditions: (mode.conditions ?? []).map((condition) => ({ fieldId: input.model.fieldId(condition.field), operator: condition.operator, ...(condition.value === undefined ? {} : { value: condition.value }) })),
              sort: (mode.sort ?? []).map((sort) => ({ fieldId: input.model.fieldId(sort.field), direction: sort.direction })),
              pins: [],
              limit: mode.limit ?? 100,
            },
          },
          bindings,
        },
      };
      mappings.set(id, record);
      return { id, model: input.model, composition: input.composition, record };
    },

    attach(mapping, target, id) {
      const attachmentId = id ?? `${mapping.id}-${slugify(target.nodeId)}-${slugify(target.slotId)}`;
      assertNew(attachments, attachmentId, "collection attachment");
      const owner = target.composition?.id ?? ownerOfNode(compositions, target.nodeId);
      const record: SiteProjectCollectionAttachment = {
        id: attachmentId,
        order: attachments.size,
        composition: { providerId: COMPOSITION_PROVIDER_ID, recordId: owner },
        target: { nodeId: target.nodeId, slotId: target.slotId },
        mapping: { providerId: MAPPING_PROVIDER_ID, recordId: mapping.id },
      };
      attachments.set(attachmentId, record);
      return { id: attachmentId, record };
    },

    sitemap(input) {
      if (sitemap) throw new Error("A site has exactly one sitemap.");
      const id = input.id ?? slugify(input.name);
      const nodeIds = new Map<RouteInput, string>();
      const seen = new Set<string>();
      const buildRoute = (route: RouteInput): SitemapNode => {
        const nodeId = route.id ?? `${slugify(route.title)}-node`;
        if (seen.has(nodeId)) throw new Error(`Duplicate sitemap node id "${nodeId}".`);
        seen.add(nodeId);
        nodeIds.set(route, nodeId);
        return {
          id: nodeId,
          title: route.title,
          ...(route.slug === undefined ? {} : { slug: route.slug }),
          ...(route.notes === undefined ? {} : { notes: route.notes }),
          source: routeSource(route),
          children: (route.children ?? []).map(buildRoute),
        };
      };
      const root = buildRoute(input.root);
      const navigationItems = (refs: NavigationRef[] = []): SitemapNavigationItem[] => refs.map((ref) => {
        const nodeId = nodeIds.get(ref.route);
        if (nodeId === undefined) throw new Error(`Navigation item "${ref.route.title}" is not in the sitemap tree.`);
        return { id: ref.id ?? `nav-${nodeId}`, label: ref.label ?? ref.route.title, visible: ref.visible ?? true, destination: { kind: "route", nodeId } };
      });
      sitemap = {
        id,
        ...envelope,
        document: {
          schemaVersion: 3,
          id,
          name: input.name,
          navigation: { primary: navigationItems(input.navigation?.primary), footer: navigationItems(input.navigation?.footer) },
          root: [root],
        },
      };
      return sitemap;
    },

    toSiteProject() {
      if (!sitemap) throw new Error(`Site "${options.id}" has no sitemap.`);
      return {
        schemaVersion: 2,
        id: options.id,
        name: options.name,
        componentPack: { contractVersion: manifest.contractVersion, packId: manifest.packId, packVersion: manifest.packVersion },
        providers: {
          compositions: [{ id: COMPOSITION_PROVIDER_ID, records: [...compositions.values()] }],
          content: [{ id: CONTENT_PROVIDER_ID, models: [...models.values()], entries: [...entries.values()] }],
          mappings: [{ id: MAPPING_PROVIDER_ID, records: [...mappings.values()] }],
          sitemaps: [{ id: SITEMAP_PROVIDER_ID, records: [sitemap] }],
        },
        activeSitemap: { providerId: SITEMAP_PROVIDER_ID, recordId: sitemap.id },
        collectionAttachments: [...attachments.values()],
      };
    },
  };
  return site;
}

function containsNode(nodes: readonly CompositionNode[], nodeId: string): boolean {
  return nodes.some((item) => item.id === nodeId || Object.values(item.slots).some((children) => containsNode(children, nodeId)));
}

function ownerOfNode(compositions: Map<string, CompositionRecord>, nodeId: string): string {
  const owners = [...compositions.values()].filter((record) => containsNode(record.document.root, nodeId)).map((record) => record.id);
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 0) throw new Error(`No declared composition contains node "${nodeId}"; declare the page before attaching to it.`);
  throw new Error(`Node "${nodeId}" exists in compositions ${owners.join(", ")}; pass the owner as target.composition.`);
}

/** Object values are stored keyed by nested field id; authors write them keyed by nested field key. */
function valueByFieldId(schema: ContentValueSchema, value: JsonValue): JsonValue {
  if (schema.kind === "list" && Array.isArray(value)) return value.map((item) => valueByFieldId(schema.item, item));
  if (schema.kind !== "object" || value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const stored: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const field = schema.fields.find((candidate) => candidate.key === key);
    if (!field) throw new Error(`Object field has no nested field "${key}".`);
    stored[field.id] = valueByFieldId(field, item);
  }
  return stored;
}

/** The provider-qualified value a `reference` field stores (a `reference-list` stores an array of them). */
export function entryRef(entry: Entry): { providerId: string; modelId: string; recordId: string } {
  return { providerId: CONTENT_PROVIDER_ID, modelId: entry.modelId, recordId: entry.id };
}

/** An entry id from its first slug/text value; explicit ids are preferred in real content. */
function deriveEntryId(model: Model, values: Record<string, JsonValue>): string {
  for (const field of model.record.document.fields) {
    const value = values[field.key];
    if ((field.kind === "slug" || field.kind === "text") && typeof value === "string" && value.trim() !== "") return `${model.id}-${slugify(value)}`;
  }
  throw new Error(`Entry of model "${model.id}" needs an explicit id or a slug/text value.`);
}

function routeSource(route: RouteInput): SitemapNode["source"] {
  if ("page" in route) return { kind: "composition", ref: { providerId: COMPOSITION_PROVIDER_ID, recordId: route.page.id } };
  const ref = { providerId: MAPPING_PROVIDER_ID, recordId: route.mapping.id };
  if (route.route === "entry-field") {
    const titleField = route.titleField ?? route.mapping.model.record.document.fields.find((field) => field.kind === "text")?.key;
    return {
      kind: "mapping",
      ref,
      route: { kind: "entry-field", fieldId: route.mapping.model.fieldId(route.field), ...(titleField === undefined ? {} : { titleFieldId: route.mapping.model.fieldId(titleField) }) },
    };
  }
  return { kind: "mapping", ref, route: { kind: "single" } };
}
