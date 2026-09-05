import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord, ContentFieldDefinition, ContentModelRecord } from "../../content/model";
import { isValueValidForField } from "../../content/model";
import { compareUnicodeCodePoints } from "../../site-project/model/canonical";
import type { MappingCollectionEvaluation, MappingCollectionQuery, MappingCollectionDiagnostic } from "../model";

function scalar(value: JsonValue | undefined): string | number | boolean | null | undefined {
  return value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)
    ? value as string | number | boolean | null | undefined
    : undefined;
}

function compareValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const a = scalar(left); const b = scalar(right);
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
  return compareUnicodeCodePoints(String(a), String(b));
}

function conditionMatches(value: JsonValue | undefined, condition: MappingCollectionQuery["conditions"][number]): boolean {
  if (condition.operator === "exists") return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
  if (condition.operator === "contains") {
    if (typeof value === "string" && typeof condition.value === "string") return value.includes(condition.value);
    if (Array.isArray(value)) return value.some((item) => JSON.stringify(item) === JSON.stringify(condition.value));
    return false;
  }
  const equal = JSON.stringify(value) === JSON.stringify(condition.value);
  return condition.operator === "equals" ? equal : !equal;
}

function eligible(entry: ContentEntryRecord, query: MappingCollectionQuery): boolean {
  return query.publication === "include-drafts" || entry.lifecycle === "published";
}

/** Pure deterministic query evaluation; provider reads belong to the caller. */
export function evaluateCollectionQuery(options: {
  model: ContentModelRecord;
  providerId: string;
  entries: readonly ContentEntryRecord[];
  query: MappingCollectionQuery;
}): MappingCollectionEvaluation {
  const { model, providerId, query } = options;
  const diagnostics: MappingCollectionDiagnostic[] = [];
  if (model.document.kind !== "collection") diagnostics.push({ code: "collection-required", severity: "blocking", message: `Content model "${model.id}" is not a collection.` });
  const fields = new Map(model.document.fields.map((field) => [field.id, field]));
  for (const item of [...query.conditions, ...query.sort]) {
    if (!fields.has(item.fieldId)) diagnostics.push({ code: "stale-query-field", severity: "blocking", fieldId: item.fieldId, message: `Query field "${item.fieldId}" no longer exists.` });
  }
  for (const sort of query.sort) {
    const field = fields.get(sort.fieldId);
    if (field && !isScalarQueryField(field)) diagnostics.push({ code: "unsupported-query-field", severity: "blocking", fieldId: field.id, message: `Field "${field.label}" cannot be used for deterministic sorting.` });
  }
  for (const condition of query.conditions) {
    const field = fields.get(condition.fieldId);
    const conditionField = field && condition.operator === "contains" && field.kind === "list" ? field.item : field;
    const supported = !field || condition.operator !== "contains" || field.kind === "list" || ["text", "long-text", "markdown", "slug", "url"].includes(field.kind);
    if (field && !supported) diagnostics.push({ code: "unsupported-query-field", severity: "blocking", fieldId: field.id, message: `Field "${field.label}" does not support the contains operator.` });
    else if (field && conditionField && condition.operator !== "exists" && !isValueValidForField(conditionField, condition.value)) diagnostics.push({ code: "invalid-condition-value", severity: "blocking", fieldId: field.id, message: `Condition value does not match field "${field.label}".` });
  }
  if (diagnostics.some((item) => item.severity === "blocking")) return { status: "blocked", entries: [], diagnostics };

  const allEntriesById = new Map(options.entries.map((entry) => [entry.id, entry]));
  const all = options.entries.filter((entry) => entry.modelId === model.id);
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const pinned: ContentEntryRecord[] = [];
  const seen = new Set<string>();
  for (const pin of query.pins) {
    if (pin.providerId !== providerId) { diagnostics.push({ code: "pin-provider-mismatch", severity: "nonblocking", entryId: pin.recordId, message: `Pinned Entry "${pin.recordId}" belongs to another provider.` }); continue; }
    if (pin.modelId !== model.id) { diagnostics.push({ code: "pin-model-mismatch", severity: "nonblocking", entryId: pin.recordId, message: `Pinned Entry "${pin.recordId}" belongs to another model.` }); continue; }
    const entry = byId.get(pin.recordId);
    if (!entry) {
      const existing = allEntriesById.get(pin.recordId);
      diagnostics.push({ code: existing ? "pin-model-mismatch" : "pin-not-found", severity: "nonblocking", entryId: pin.recordId, message: existing ? `Pinned Entry "${pin.recordId}" belongs to another model.` : `Pinned Entry "${pin.recordId}" was not found.` });
      continue;
    }
    if (!eligible(entry, query)) { diagnostics.push({ code: "pin-ineligible", severity: "nonblocking", entryId: entry.id, message: `Pinned Entry "${entry.id}" is not eligible for the publication policy.` }); continue; }
    if (!seen.has(entry.id)) { seen.add(entry.id); pinned.push(entry); }
  }

  const matched = all
    .filter((entry) => eligible(entry, query) && !seen.has(entry.id) && query.conditions.every((condition) => conditionMatches(entry.values[condition.fieldId], condition)))
    .sort((left, right) => {
      for (const sort of query.sort) {
        const compared = compareValues(left.values[sort.fieldId], right.values[sort.fieldId]);
        if (compared) return sort.direction === "asc" ? compared : -compared;
      }
      return compareUnicodeCodePoints(left.id, right.id);
    });
  const entries = [...pinned, ...matched].slice(0, query.limit);
  if (entries.length === 0) diagnostics.push({ code: "empty-source", severity: "nonblocking", message: "The collection query produced no Entries." });
  return { status: "ready", entries, diagnostics };
}

export function isScalarQueryField(field: ContentFieldDefinition): boolean {
  return !["object", "list", "media-use", "reference-list"].includes(field.kind);
}
