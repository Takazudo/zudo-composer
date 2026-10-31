import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentFieldDefinition } from "../model";
import type { EditorialFieldDifference } from "./types";

export function canonicalEditorialJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEditorialJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEditorialJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameEditorialValue(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined ? left === right : canonicalEditorialJson(left) === canonicalEditorialJson(right);
}

/** Field-level differences in definition order, then fields the current definition no longer has. */
export function editorialDifferences(fields: readonly Pick<ContentFieldDefinition, "id" | "key" | "label">[], before: Record<string, JsonValue>, after: Record<string, JsonValue>): EditorialFieldDifference[] {
  const known = new Set(fields.map((field) => field.id));
  const removed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((fieldId) => !known.has(fieldId)).sort();
  return [
    ...fields.map((field) => ({ fieldId: field.id, key: field.key, label: field.label, removedFromDefinition: false })),
    ...removed.map((fieldId) => ({ fieldId, key: fieldId, label: fieldId, removedFromDefinition: true })),
  ].flatMap((field) => {
    const previous = before[field.fieldId], next = after[field.fieldId];
    if (sameEditorialValue(previous, next)) return [];
    return [{
      ...field,
      change: previous === undefined ? "added" as const : next === undefined ? "removed" as const : "changed" as const,
      ...(previous !== undefined ? { before: previous } : {}),
      ...(next !== undefined ? { after: next } : {}),
    }];
  });
}
