import type { ContentEntryRecord, ContentFieldDefinition } from "../../content";

export function contentEntryLabel(entry: ContentEntryRecord, fields: readonly ContentFieldDefinition[]): string {
  for (const field of fields) {
    const value = entry.values[field.id];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Untitled Entry";
}
