import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import type {
  ContentCompletenessDiagnostic,
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelDocument,
  ContentModelRecord,
  ContentValueSchema,
} from "../model";
import { CONTENT_ENTRY_SCHEMA_VERSION, CONTENT_MODEL_SCHEMA_VERSION } from "../model";
import type { ContentModelSummary } from "./types";

const defaultContentIdFactory = createUuidIdFactory();

export function summarizeContentModel(record: ContentModelRecord): ContentModelSummary {
  return { id: record.id, name: record.document.name, kind: record.document.kind, fieldCount: record.document.fields.length, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

export function compareContentModelsNewestFirst(a: ContentModelSummary, b: ContentModelSummary): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

export function compareContentEntriesNewestFirst(a: ContentEntryRecord, b: ContentEntryRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

export function createContentModelRecord(
  input: { name: string; description?: string; kind: "collection" | "single"; fields?: readonly ContentFieldDefinition[]; presentation?: ContentModelDocument["presentation"] },
  options: { id?: string; timestamp?: string; idFactory?: IdFactory; now?: () => string },
): ContentModelRecord {
  const id = options.id ?? (options.idFactory ?? defaultContentIdFactory)("content-model");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  const document: ContentModelDocument = { schemaVersion: CONTENT_MODEL_SCHEMA_VERSION, id, name: input.name, description: input.description ?? "", kind: input.kind, fields: structuredClone([...(input.fields ?? [])]), ...(input.presentation ? { presentation: structuredClone(input.presentation) } : {}) };
  return { id, createdAt: timestamp, updatedAt: timestamp, document };
}

export function createContentEntryRecord(
  modelId: string,
  values: ContentEntryRecord["values"],
  options: { id?: string; timestamp?: string; idFactory?: IdFactory; now?: () => string },
): ContentEntryRecord {
  const id = options.id ?? (options.idFactory ?? defaultContentIdFactory)("content-entry");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  return { schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION, id, modelId, createdAt: timestamp, updatedAt: timestamp, values: structuredClone(values), lifecycle: "draft", generation: 0 };
}

function empty(value: unknown): boolean { return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0) || (Array.isArray(value) && value.length === 0); }

export function diagnoseContentEntryCompleteness(model: ContentModelRecord, entry: ContentEntryRecord): ContentCompletenessDiagnostic[] {
  const diagnostics: ContentCompletenessDiagnostic[] = [];
  function visit(schema: ContentValueSchema, value: unknown, field: ContentFieldDefinition, path: (string | number)[], required: boolean): void {
    const add = (code: ContentCompletenessDiagnostic["code"], message: string) => diagnostics.push({ code, modelId: model.id, entryId: entry.id, fieldId: field.id, fieldKey: field.key, path, message });
    if (empty(value)) { if (required) add("required-value-missing", `Required field "${field.label}" is empty.`); return; }
    if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) for (const child of schema.fields) visit(child, (value as Record<string, unknown>)[child.id], child, [...path, child.id], child.required);
    if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, index) => visit(schema.item, item, field, [...path, index], true));
    if (schema.kind === "asset-use" && value && typeof value === "object") {
      const use = value as Record<string, unknown>;
      if ((use.kind === "image" && !use.decorative && empty(use.alt)) || (use.kind === "link" && empty(use.label)) || (use.kind === "card" && empty(use.title))) add("semantic-value-incomplete", `Asset use in "${field.label}" needs its per-use accessible text.`);
    }
  }
  for (const field of model.document.fields) visit(field, entry.values[field.id], field, [field.id], field.required);
  return diagnostics;
}
