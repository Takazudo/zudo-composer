import { createUuidIdFactory } from "../../shared/id-factory";
import type { IdFactory } from "../../shared/id-factory";
import type {
  ContentCompletenessDiagnostic,
  ContentEntryRecord,
  ContentFieldDefinition,
  ContentModelDocument,
  ContentModelRecord,
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
  input: { name: string; kind: "collection" | "single"; fields?: readonly ContentFieldDefinition[] },
  options: { id?: string; timestamp?: string; idFactory?: IdFactory; now?: () => string },
): ContentModelRecord {
  const id = options.id ?? (options.idFactory ?? defaultContentIdFactory)("content-model");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  const document: ContentModelDocument = { schemaVersion: CONTENT_MODEL_SCHEMA_VERSION, id, name: input.name, kind: input.kind, fields: [...(input.fields ?? [])] };
  return { id, createdAt: timestamp, updatedAt: timestamp, document };
}

export function createContentEntryRecord(
  modelId: string,
  values: ContentEntryRecord["values"],
  options: { id?: string; timestamp?: string; idFactory?: IdFactory; now?: () => string },
): ContentEntryRecord {
  const id = options.id ?? (options.idFactory ?? defaultContentIdFactory)("content-entry");
  const timestamp = options.timestamp ?? options.now?.() ?? new Date().toISOString();
  return { schemaVersion: CONTENT_ENTRY_SCHEMA_VERSION, id, modelId, createdAt: timestamp, updatedAt: timestamp, values: { ...values } };
}

function empty(value: unknown): boolean { return value === undefined || (typeof value === "string" && value.trim().length === 0); }

export function diagnoseContentEntryCompleteness(model: ContentModelRecord, entry: ContentEntryRecord): ContentCompletenessDiagnostic[] {
  return model.document.fields.flatMap((field) => field.required && empty(entry.values[field.id]) ? [{
    code: "required-value-missing" as const,
    modelId: model.id,
    entryId: entry.id,
    fieldId: field.id,
    fieldKey: field.key,
    message: `Required field "${field.label}" is empty.`,
  }] : []);
}
