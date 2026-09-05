import type { MappingRecord, MappingSeedOptions, MappingSummary } from "./types";
import { MAPPING_SCHEMA_VERSION } from "./types";
import { validateMappingRecord } from "./validate";

export function createMappingRecord(options: MappingSeedOptions): MappingRecord {
  const record: MappingRecord = { id: options.id, createdAt: options.createdAt, updatedAt: options.updatedAt ?? options.createdAt, document: { schemaVersion: MAPPING_SCHEMA_VERSION, id: options.id, name: options.name, contentModel: { ...options.contentModel }, composition: { ...options.composition }, mode: structuredClone(options.mode ?? { kind: "single" }), bindings: (options.bindings ?? []).map((binding) => ({ ...binding, projection: structuredClone(binding.projection ?? { kind: "value" }), target: { ...binding.target }, transform: { ...binding.transform } })) } };
  const result = validateMappingRecord(record); if (!result.ok) throw new TypeError(result.issue.message); return record;
}
export function summarizeMapping(record: MappingRecord): MappingSummary { return { id: record.id, name: record.document.name, createdAt: record.createdAt, updatedAt: record.updatedAt, bindingCount: record.document.bindings.length }; }
