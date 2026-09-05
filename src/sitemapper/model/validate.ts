// Structural Sitemap validation — exact persisted shape with typed failures.
//
// This layer is manifest-agnostic: dangling Composition references remain
// structurally valid. It does enforce JSON safety, exact keys, one v1 root,
// globally unique node ids, acyclic object references, and provider-qualified
// record identity so recovery never silently accepts an ambiguous document.

import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { SITEMAP_SCHEMA_VERSION } from "./types";
import type { SitemapDocument } from "./types";

export type SitemapValidationFailureCode =
  | "not-an-object"
  | "invalid-document-keys"
  | "unsupported-schema-version"
  | "invalid-document-id"
  | "invalid-document-name"
  | "root-cardinality"
  | "invalid-node-keys"
  | "invalid-node-id"
  | "duplicate-node-id"
  | "invalid-node-title"
  | "invalid-node-slug"
  | "invalid-source"
  | "invalid-navigation"
  | "tree-limit"
  | "invalid-node-notes"
  | "invalid-children"
  | "cycle"
  | "not-json-safe";

export type SitemapValidationResult =
  | { ok: true; document: SitemapDocument }
  | { ok: false; code: SitemapValidationFailureCode; path: string };

const DOCUMENT_KEYS = ["schemaVersion", "id", "name", "root", "navigation"] as const;
const NODE_REQUIRED_KEYS = ["id", "title", "source", "children"] as const;
const NODE_OPTIONAL_KEYS = ["slug", "notes"] as const;
const REF_KEYS = ["providerId", "recordId"] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function failure(code: SitemapValidationFailureCode, path: string): SitemapValidationResult {
  return { ok: false, code, path };
}

function validRef(value: unknown): boolean {
  return isPlainObject(value) && hasExactKeys(value, REF_KEYS)
    && typeof value.providerId === "string" && value.providerId.length > 0
    && isSafeRecordId(value.recordId);
}

export function validSitemapEntryRef(value: unknown): boolean {
  return isPlainObject(value) && hasExactKeys(value, ["providerId", "modelId", "recordId"])
    && typeof value.providerId === "string" && value.providerId.length > 0 && isSafeRecordId(value.modelId) && isSafeRecordId(value.recordId);
}
export function safeNavigationUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.includes("\\") || Array.from(value).some((point) => point.charCodeAt(0) <= 32 || point.charCodeAt(0) === 127)) return false;
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
export function validSitemapNavigation(value: unknown): boolean {
  if (!isPlainObject(value) || !hasExactKeys(value, ["primary", "footer"])) return false;
  return [value.primary, value.footer].every((menu) => {
    if (!Array.isArray(menu) || menu.length > 10000) return false;
    const ids = new Set<string>();
    return menu.every((item: unknown) => {
      if (!isPlainObject(item) || !hasExactKeys(item, ["id", "label", "visible", "destination"]) || !isSafeRecordId(item.id) || ids.has(item.id) || typeof item.label !== "string" || !item.label.trim() || typeof item.visible !== "boolean") return false;
      ids.add(item.id); const target = item.destination;
      if (!isPlainObject(target)) return false;
      if (target.kind === "external") return hasExactKeys(target, ["kind", "url"]) && safeNavigationUrl(target.url);
      if (target.kind !== "route" || !hasExactKeys(target, ["kind", "nodeId"], ["entry", "ancestors"]) || typeof target.nodeId !== "string" || !target.nodeId) return false;
      if (Object.hasOwn(target, "entry") && !validSitemapEntryRef(target.entry)) return false;
      if (!Object.hasOwn(target, "ancestors")) return true;
      if (!Array.isArray(target.ancestors) || target.ancestors.length > 128) return false;
      const ancestors = new Set<string>();
      return target.ancestors.every((ancestor: unknown) => {
        if (!isPlainObject(ancestor) || !hasExactKeys(ancestor, ["nodeId", "entry"]) || typeof ancestor.nodeId !== "string" || !ancestor.nodeId || ancestors.has(ancestor.nodeId) || !validSitemapEntryRef(ancestor.entry)) return false;
        ancestors.add(ancestor.nodeId); return true;
      });
    });
  });
}
export function validSitemapSource(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "unassigned") return hasExactKeys(value, ["kind"]);
  if (value.kind === "composition") {
    return hasExactKeys(value, ["kind", "ref"]) && validRef(value.ref);
  }
  if (value.kind !== "mapping" || !hasExactKeys(value, ["kind", "ref", "route"]) || !validRef(value.ref)) return false;
  const route = value.route;
  if (!isPlainObject(route) || typeof route.kind !== "string") return false;
  if (route.kind === "selected-entry") return hasExactKeys(route, ["kind", "entry"]) && validSitemapEntryRef(route.entry);
  return route.kind === "single"
    ? hasExactKeys(route, ["kind"])
    : route.kind === "entry-field" && hasExactKeys(route, ["kind", "fieldId"], ["titleFieldId"])
      && isSafeRecordId(route.fieldId)
      && (!Object.hasOwn(route, "titleFieldId") || isSafeRecordId(route.titleFieldId));
}

function validateNode(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  ancestors: Set<object>,
): SitemapValidationResult | undefined {
  if (ancestors.size > 128 || seenIds.size >= 10000) return failure("tree-limit", path);
  if (!isPlainObject(value)) return failure("invalid-node-keys", path);
  if (ancestors.has(value)) return failure("cycle", path);
  ancestors.add(value);

  try {
    if (!hasExactKeys(value, NODE_REQUIRED_KEYS, NODE_OPTIONAL_KEYS)) {
      return failure("invalid-node-keys", path);
    }
    if (typeof value.id !== "string" || value.id.length === 0) {
      return failure("invalid-node-id", `${path}.id`);
    }
    if (seenIds.has(value.id)) return failure("duplicate-node-id", `${path}.id`);
    seenIds.add(value.id);

    if (typeof value.title !== "string") return failure("invalid-node-title", `${path}.title`);
    if (Object.hasOwn(value, "slug") && typeof value.slug !== "string") {
      return failure("invalid-node-slug", `${path}.slug`);
    }
    if (Object.hasOwn(value, "notes") && typeof value.notes !== "string") {
      return failure("invalid-node-notes", `${path}.notes`);
    }
    if (!validSitemapSource(value.source)) return failure("invalid-source", `${path}.source`);
    if (!Array.isArray(value.children)) return failure("invalid-children", `${path}.children`);

    for (let index = 0; index < value.children.length; index += 1) {
      const childFailure = validateNode(
        value.children[index],
        `${path}.children[${index}]`,
        seenIds,
        ancestors,
      );
      if (childFailure) return childFailure;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

/** Validate one untrusted value and return either the typed document or a code. */
export function isStructurallyValidDocument(value: unknown): SitemapValidationResult {
  if (!isPlainObject(value)) return failure("not-an-object", "$");
  if (!hasExactKeys(value, DOCUMENT_KEYS)) return failure("invalid-document-keys", "$");
  if (value.schemaVersion !== SITEMAP_SCHEMA_VERSION) {
    return failure("unsupported-schema-version", "$.schemaVersion");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    return failure("invalid-document-id", "$.id");
  }
  if (typeof value.name !== "string") return failure("invalid-document-name", "$.name");
  if (!validSitemapNavigation(value.navigation)) return failure("invalid-navigation", "$.navigation");
  if (!Array.isArray(value.root) || value.root.length !== 1) {
    return failure("root-cardinality", "$.root");
  }

  const seenIds = new Set<string>();
  const ancestors = new Set<object>([value]);
  for (let index = 0; index < value.root.length; index += 1) {
    const nodeFailure = validateNode(value.root[index], `$.root[${index}]`, seenIds, ancestors);
    if (nodeFailure) return nodeFailure;
  }

  // Every accepted leaf above is a JSON primitive and every container is a
  // plain object/array. Keep the shared predicate as the final defense against
  // JavaScript values that do not survive persistence.
  if (!isJsonSafe(value)) return failure("not-json-safe", "$");
  return { ok: true, document: value as unknown as SitemapDocument };
}
