import type { ContentFieldKind } from "../../content/model";
import type { MappingTargetKind, MappingTransform } from "../model";

const STRING_KINDS = new Set<ContentFieldKind>(["text", "long-text", "markdown", "slug", "url", "date", "color"]);

export function isStringProducingSource(kind: ContentFieldKind): boolean { return STRING_KINDS.has(kind); }

export function isMappingCompatible(source: ContentFieldKind, target: MappingTargetKind, transform: MappingTransform): boolean {
  switch (transform.kind) {
    case "identity":
      if (target === "text") return STRING_KINDS.has(source);
      if (target === "select") return source === "text" || source === "slug";
      if (target === "color") return source === "color";
      if (target === "number") return source === "number";
      return target === "boolean" && source === "boolean";
    case "date-medium": return source === "date" && target === "text";
    case "truncate-160": return STRING_KINDS.has(source) && target === "text";
    case "prefix": return STRING_KINDS.has(source) && target === "text" && Array.from(transform.prefix).length <= 80;
  }
}

export const MAPPING_COMPATIBILITY_MATRIX: Readonly<Record<MappingTransform["kind"], readonly string[]>> = {
  identity: ["text|long-text|markdown|slug|url|date -> text", "text|slug -> select", "color -> color|text", "number -> number", "boolean -> boolean"],
  "date-medium": ["date -> text"],
  "truncate-160": ["string-producing -> text"],
  prefix: ["string-producing -> text"],
};

export function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function applyMappingTransform(value: string | number | boolean, transform: MappingTransform): string | number | boolean {
  switch (transform.kind) {
    case "identity": return value;
    case "prefix": return transform.prefix + String(value);
    case "truncate-160": { const points = Array.from(String(value)); return points.length > 160 ? `${points.slice(0, 160).join("")}…` : String(value); }
    case "date-medium": { const date = new Date(`${String(value)}T00:00:00.000Z`); return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date); }
  }
}
