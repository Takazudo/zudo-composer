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
  | "invalid-composition-ref"
  | "invalid-node-notes"
  | "invalid-children"
  | "cycle"
  | "not-json-safe";

export type SitemapValidationResult =
  | { ok: true; document: SitemapDocument }
  | { ok: false; code: SitemapValidationFailureCode; path: string };

const DOCUMENT_KEYS = ["schemaVersion", "id", "name", "root"] as const;
const NODE_REQUIRED_KEYS = ["id", "title", "children"] as const;
const NODE_OPTIONAL_KEYS = ["slug", "composition", "notes"] as const;
const COMPOSITION_REF_KEYS = ["providerId", "recordId"] as const;

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

function validateNode(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  ancestors: Set<object>,
): SitemapValidationResult | undefined {
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
    if (Object.hasOwn(value, "composition")) {
      const ref = value.composition;
      if (
        !isPlainObject(ref)
        || !hasExactKeys(ref, COMPOSITION_REF_KEYS)
        || typeof ref.providerId !== "string"
        || ref.providerId.length === 0
        || !isSafeRecordId(ref.recordId)
      ) {
        return failure("invalid-composition-ref", `${path}.composition`);
      }
    }
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

