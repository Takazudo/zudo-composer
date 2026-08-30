import type { ContentFieldKind } from "../../content/model";
import type { MappingTargetKind, MappingTransform } from "../model";

function assertNever(value: never, axis: "Content field" | "component target"): never {
  throw new TypeError(`Unhandled ${axis} kind: ${String(value)}`);
}

export function isStringProducingSource(kind: ContentFieldKind): boolean {
  switch (kind) {
    case "text": case "long-text": case "markdown": case "date": case "slug": case "color": case "url": return true;
    case "number": case "boolean": return false;
    default: return assertNever(kind, "Content field");
  }
}

function isIdentityCompatible(source: ContentFieldKind, target: MappingTargetKind): boolean {
  switch (target) {
    case "text": return isStringProducingSource(source);
    case "select": {
      switch (source) {
        case "text": case "slug": return true;
        case "long-text": case "markdown": case "number": case "boolean": case "date": case "color": case "url": return false;
        default: return assertNever(source, "Content field");
      }
    }
    case "color": {
      switch (source) {
        case "color": return true;
        case "text": case "long-text": case "markdown": case "number": case "boolean": case "date": case "slug": case "url": return false;
        default: return assertNever(source, "Content field");
      }
    }
    case "number": {
      switch (source) {
        case "number": return true;
        case "text": case "long-text": case "markdown": case "boolean": case "date": case "slug": case "color": case "url": return false;
        default: return assertNever(source, "Content field");
      }
    }
    case "boolean": {
      switch (source) {
        case "boolean": return true;
        case "text": case "long-text": case "markdown": case "number": case "date": case "slug": case "color": case "url": return false;
        default: return assertNever(source, "Content field");
      }
    }
    default: return assertNever(target, "component target");
  }
}

export function isMappingCompatible(source: ContentFieldKind, target: MappingTargetKind, transform: MappingTransform): boolean {
  switch (transform.kind) {
    case "identity":
      return isIdentityCompatible(source, target);
    case "date-medium": return source === "date" && target === "text";
    case "truncate-160": return isStringProducingSource(source) && target === "text";
    case "prefix": return isStringProducingSource(source) && target === "text" && Array.from(transform.prefix).length <= 80;
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
