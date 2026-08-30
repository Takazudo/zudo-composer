import type { JsonValue } from "@zudo-composer/component-contract";
import type { SiteProject } from "./types";

/** Locale-independent lexicographic comparison by Unicode code point. */
export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! < rightPoints[index]! ? -1 : 1;
  }
  return leftPoints.length === rightPoints.length ? 0 : leftPoints.length < rightPoints.length ? -1 : 1;
}

function compareById(left: { id: string }, right: { id: string }): number {
  return compareUnicodeCodePoints(left.id, right.id);
}

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    const output = Object.create(null) as Record<string, JsonValue>;
    const record = value as Record<string, JsonValue>;
    for (const key of Object.keys(record).sort(compareUnicodeCodePoints)) output[key] = canonicalJson(record[key]!);
    return output;
  }
  return value;
}

/** Canonical JSON text for any already validated JSON-safe value. */
export function canonicalStringifyJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalJson(value))}\n`;
}

/** Sort only set-like provider/record collections; authored tree/field order remains semantic. */
export function canonicalizeSiteProject(project: SiteProject): SiteProject {
  const copy = structuredClone(project);
  copy.providers.compositions.sort(compareById);
  for (const provider of copy.providers.compositions) provider.records.sort(compareById);
  copy.providers.content.sort(compareById);
  for (const provider of copy.providers.content) {
    provider.models.sort(compareById);
    provider.entries.sort(compareById);
  }
  copy.providers.mappings.sort(compareById);
  for (const provider of copy.providers.mappings) provider.records.sort(compareById);
  copy.providers.sitemaps.sort(compareById);
  for (const provider of copy.providers.sitemaps) provider.records.sort(compareById);
  return copy;
}

/** Canonical UTF-8-ready JSON text with recursively code-point-sorted keys. */
export function serializeSiteProject(project: SiteProject): string {
  return canonicalStringifyJson(canonicalizeSiteProject(project) as unknown as JsonValue);
}
