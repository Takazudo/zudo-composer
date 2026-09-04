// One provider-backed Mapping workspace, shared by the controller, library,
// editor and presentation specs.
//
// The fixture is chosen so both sides of compatibility are provable: the
// Content model carries a text, a boolean, a date and a slug field, and the
// Composition carries three text props, a select and a boolean one. A boolean
// source therefore fits exactly one target and nothing else, which is what
// makes "only compatible things are offered" a real assertion rather than a
// tautology over a single-typed fixture.

import type { CompositionRecord } from "../../../composer/library";
import type { ContentCatalog, ContentEntryRecord, ContentModelRecord } from "../../../content";
import {
  createMappingRecord,
  MAPPING_PROVIDERS,
  type CompositionCatalog,
  type MappingBinding,
  type MappingLoadOutcome,
  type MappingProvider,
  type MappingRecord,
} from "../../../mapping";
import { createSequentialIdFactory } from "../../../shared";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingEditorController, type MappingContentEntryCatalog, type MappingEditorControllerOptions } from "../controller";

export const NOW = "2026-01-02T03:04:05.000Z";

const components = activeComponentProvider.manifest.components;
/** Three text props plus a select — the multi-target side of the fixture. */
export const HEADING = components.find((item) => item.id === "ui.section-heading")!;
/** The one boolean prop in the pack; the only target a boolean source can drive. */
export const GRID = components.find((item) => item.id === "ui.auto-grid")!;

export const HEADING_NODE = "heading-node";
export const GRID_NODE = "grid-node";

export const CONTENT_REF = { providerId: "content-indexeddb", recordId: "model-1" } as const;
export const COMPOSITION_REF = { providerId: "indexeddb", recordId: "composition-1" } as const;

export const model: ContentModelRecord = {
  id: "model-1",
  createdAt: NOW,
  updatedAt: NOW,
  document: {
    schemaVersion: 1,
    id: "model-1",
    name: "Articles",
    kind: "collection",
    fields: [
      { id: "field-title", key: "title", label: "Title", required: true, kind: "text" },
      { id: "field-flag", key: "published", label: "Published", required: false, kind: "boolean" },
      { id: "field-date", key: "released_at", label: "Release date", required: false, kind: "date" },
      { id: "field-slug", key: "slug", label: "Slug", required: false, kind: "slug" },
    ],
  },
};

export const entry: ContentEntryRecord = {
  schemaVersion: 1,
  id: "entry-1",
  modelId: model.id,
  createdAt: NOW,
  updatedAt: NOW,
  values: { "field-title": "Hello world", "field-flag": true, "field-date": "2026-01-02", "field-slug": "hello-world" },
};

function node(component: typeof HEADING, id: string) {
  return {
    id,
    componentId: component.id,
    componentVersion: component.schemaVersion,
    props: { ...component.defaults },
    slots: Object.fromEntries(component.slots.map((slot) => [slot.id, []])),
  };
}

export const composition: CompositionRecord = {
  id: "composition-1",
  createdAt: NOW,
  updatedAt: NOW,
  document: {
    schemaVersion: 2,
    id: "composition-1",
    name: "Article page",
    root: [node(HEADING, HEADING_NODE), node(GRID, GRID_NODE)],
  },
};

export const HEADING_TARGET = { nodeId: HEADING_NODE, prop: "heading" } as const;
export const EYEBROW_TARGET = { nodeId: HEADING_NODE, prop: "eyebrow" } as const;
export const FILL_TARGET = { nodeId: GRID_NODE, prop: "fill" } as const;

export const READY_BINDING: MappingBinding = {
  id: "binding-title",
  sourceFieldId: "field-title",
  target: { ...HEADING_TARGET },
  transform: { kind: "identity" },
};

/** A boolean driving a text prop: incompatible under every transform. */
export const INCOMPATIBLE_BINDING: MappingBinding = {
  id: "binding-flag",
  sourceFieldId: "field-flag",
  target: { ...EYEBROW_TARGET },
  transform: { kind: "identity" },
};

export function mappingRecord(bindings: readonly MappingBinding[] = [], id = "mapping-1", name = "Article Mapping"): MappingRecord {
  return createMappingRecord({ id, name, contentModel: CONTENT_REF, composition: COMPOSITION_REF, bindings, createdAt: NOW });
}

export const RESOLVED_ENTRIES: MappingContentEntryCatalog = {
  async scan(ref) {
    return ref.providerId === CONTENT_REF.providerId && ref.recordId === model.id
      ? { status: "resolved", snapshot: { model, count: 1, entries: [entry], diagnostics: [] } }
      : { status: "not-found" };
  },
  async get(ref, id) {
    return ref.providerId === CONTENT_REF.providerId && id === entry.id
      ? { status: "resolved", entry }
      : { status: "not-found" };
  },
};

export interface MappingHarness {
  controller: MappingEditorController;
  provider: MappingProvider;
  records: Map<string, MappingRecord>;
  content: ContentCatalog;
  compositions: CompositionCatalog;
  contentEntries: MappingContentEntryCatalog;
}

export function harness(
  seed: readonly MappingRecord[] = [],
  contentEntries: MappingContentEntryCatalog = RESOLVED_ENTRIES,
  options: MappingEditorControllerOptions = {},
): MappingHarness {
  const records = new Map(seed.map((record) => [record.id, structuredClone(record)]));
  const provider: MappingProvider = {
    descriptor: MAPPING_PROVIDERS.indexeddb,
    store: {
      provider: MAPPING_PROVIDERS.indexeddb,
      async list() {
        return [...records.values()].map((record) => ({
          id: record.id,
          name: record.document.name,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          bindingCount: record.document.bindings.length,
        }));
      },
      async get(id): Promise<MappingLoadOutcome> {
        const record = records.get(id);
        return record ? { status: "loaded", record: structuredClone(record) } : { status: "not-found", id };
      },
      async put(record) { records.set(record.id, structuredClone(record)); },
      async delete(id) { return records.delete(id); },
      async seed() {},
      async clear() { records.clear(); },
    },
    initialization: {
      async initialize() { return { status: "ready", summaries: await provider.store.list() }; },
      async retry() { return provider.initialization.initialize(); },
      async startFresh() { records.clear(); return { status: "ready", summaries: [] }; },
    },
  };

  const content: ContentCatalog = {
    async listModels() {
      return {
        status: "listed",
        entries: [{
          ref: { ...CONTENT_REF },
          providerLabel: "Browser storage",
          summary: { id: model.id, name: model.document.name, kind: model.document.kind, fieldCount: model.document.fields.length, createdAt: NOW, updatedAt: NOW },
        }],
        failures: [],
      };
    },
    async resolveModel(ref) {
      return ref.recordId === model.id ? { status: "resolved", record: model } : { status: "not-found" };
    },
  };

  const compositions: CompositionCatalog = {
    async list() {
      return {
        status: "listed",
        entries: [{
          ref: { ...COMPOSITION_REF },
          providerLabel: "Browser storage",
          summary: { id: composition.id, name: composition.document.name, createdAt: NOW, updatedAt: NOW, nodeCount: composition.document.root.length },
        }],
        failures: [],
      };
    },
    async resolve(ref) {
      return ref.recordId === composition.id ? { status: "resolved", record: composition } : { status: "not-found" };
    },
  };

  const controller = new MappingEditorController(
    provider,
    { content, compositions },
    contentEntries,
    activeComponentProvider.catalog,
    { idFactory: createSequentialIdFactory("test"), now: () => NOW, ...options },
  );

  return { controller, provider, records, content, compositions, contentEntries };
}

/** An initialized controller with `record` open — the editor specs' entry point. */
export async function openedHarness(record: MappingRecord): Promise<MappingHarness> {
  const workspace = harness([record]);
  await workspace.controller.initialize();
  await workspace.controller.open(record.id);
  return workspace;
}
