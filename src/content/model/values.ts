import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord, ContentFieldDefinition, ContentFieldKind, ContentAssetUse, ContentModelRecord, ContentRecordRef, ContentValueSchema } from "./types";

export interface ContentValueLocation {
  field: ContentFieldDefinition;
  schema: ContentValueSchema;
  path: readonly (string | number)[];
  value: JsonValue;
}

/** Visits structured containers and every populated nested value, in stored order. */
export function traverseContentValues(model: ContentModelRecord, entry: ContentEntryRecord): ContentValueLocation[] {
  const result: ContentValueLocation[] = [];
  function visit(schema: ContentValueSchema, value: JsonValue | undefined, field: ContentFieldDefinition, path: (string | number)[]): void {
    if (value === undefined) return;
    result.push({ schema, value, field, path });
    if (schema.kind === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) for (const child of schema.fields) visit(child, (value as Record<string, JsonValue>)[child.id], child, [...path, child.id]);
    if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, index) => visit(schema.item, item, field, [...path, index]));
  }
  for (const field of model.document.fields) visit(field, entry.values[field.id], field, [field.id]);
  return result;
}

export function createContentValueSchema(kind: ContentFieldKind, target?: ContentRecordRef): ContentValueSchema {
  switch (kind) {
    case "choice": return { kind, options: [{ value: "option", label: "Option" }] };
    case "reference": case "reference-list":
      if (!target) throw new TypeError("Reference schema requires an explicit target model.");
      return kind === "reference" ? { kind, target } : { kind, target, ordered: true };
    case "object": return { kind, fields: [] };
    case "list": return { kind, item: { kind: "text" } };
    case "asset-use": return { kind, use: "image" };
    default: return { kind };
  }
}

export function traverseContentSchema(fields: readonly ContentFieldDefinition[]): { schema: ContentValueSchema; field: ContentFieldDefinition; path: readonly string[] }[] {
  const result: ReturnType<typeof traverseContentSchema> = [];
  function visit(schema: ContentValueSchema, field: ContentFieldDefinition, path: string[]): void {
    result.push({ schema, field, path });
    if (schema.kind === "object") for (const child of schema.fields) visit(child, child, [...path, child.id]);
    if (schema.kind === "list") visit(schema.item, field, [...path, "[]"]);
  }
  for (const field of fields) visit(field, field, [field.id]);
  return result;
}

/** The resolver supplies an asset URL; no asset notes or mutable metadata become presentation. */
export function projectContentAssetUse(use: ContentAssetUse, url: string): Record<string, JsonValue> {
  switch (use.kind) {
    case "image": return { src: url, alt: use.decorative ? "" : use.alt, decorative: use.decorative, caption: use.caption };
    case "link": return { href: url, label: use.label };
    case "card": return { href: url, title: use.title, description: use.description };
  }
}
