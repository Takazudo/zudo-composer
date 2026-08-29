import { createMappingRecord, type MappingBinding, type MappingRecord } from "../../mapping";

const createdAt = "2026-01-02T03:04:05.000Z";
const contentModel = { providerId: "content-indexeddb", recordId: "article-model" };
const composition = { providerId: "indexeddb" as const, recordId: "article-page" };
const bindings: readonly MappingBinding[] = [
  { id: "binding-title", sourceFieldId: "field-title", target: { nodeId: "hero-node", prop: "title" }, transform: { kind: "identity" } },
  { id: "binding-summary", sourceFieldId: "field-summary", target: { nodeId: "body-node", prop: "body" }, transform: { kind: "truncate-160" } },
];

/** Browser-verification fixture matrix: populated, empty, invalid-long-label, dialog and broken-ref states. */
export const mappingBrowserFixtures = {
  populated: createMappingRecord({ id: "mapping-populated", name: "Article page", contentModel, composition, bindings, createdAt }),
  empty: createMappingRecord({ id: "mapping-empty", name: "Empty Mapping", contentModel, composition, createdAt }),
  longLabel: createMappingRecord({ id: "mapping-long-label", name: "Editorial article Mapping with a deliberately long provider-qualified source and target label for overflow verification", contentModel, composition, bindings, createdAt }),
  dialogOpen: { fixture: "populated", dialog: "test" as const },
  broken: createMappingRecord({ id: "mapping-broken", name: "Broken references", contentModel: { providerId: "content-indexeddb", recordId: "missing-model" }, composition: { providerId: "indexeddb", recordId: "missing-composition" }, bindings: [{ id: "binding-broken", sourceFieldId: "missing-field", target: { nodeId: "missing-node", prop: "missing-prop" }, transform: { kind: "identity" } }], createdAt }),
  invalid: { id: "mapping-invalid", document: { schemaVersion: 1, id: "different-id" } } as unknown,
} satisfies Record<string, MappingRecord | Readonly<Record<string, unknown>> | unknown>;
