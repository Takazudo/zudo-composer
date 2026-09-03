import type { ContentEntryRecord, ContentFieldDefinition, ContentFieldKind } from "../../content";

/**
 * The field kinds a human-readable name can come from. A number, a date, a
 * colour or a toggle names nothing, so they never carry an Entry's title.
 */
const TITLE_KINDS: ReadonlySet<ContentFieldKind> = new Set(["text", "long-text", "markdown", "slug", "url"]);

export function contentEntryLabel(entry: ContentEntryRecord, fields: readonly ContentFieldDefinition[]): string {
  for (const field of fields) {
    const value = entry.values[field.id];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Untitled Entry";
}

/**
 * The field the toolbar's inline title writes to.
 *
 * `contentEntryLabel` reads fields in order and takes the first non-empty
 * string, so writing to the first title-bearing field always makes the name in
 * the toolbar the name the navigator then shows — the two cannot disagree.
 * A model with no such field has no editable title, and the toolbar says so by
 * disabling the control rather than writing somewhere surprising.
 */
export function contentEntryTitleField(fields: readonly ContentFieldDefinition[]): ContentFieldDefinition | null {
  return fields.find((field) => TITLE_KINDS.has(field.kind)) ?? null;
}

/** The right-aligned mono column beside an Entry: its slug value, or its id. */
export function contentEntrySlug(entry: ContentEntryRecord, fields: readonly ContentFieldDefinition[]): string {
  for (const field of fields) {
    if (field.kind !== "slug") continue;
    const value = entry.values[field.id];
    if (typeof value === "string" && value.trim()) return value;
  }
  return entry.id;
}
