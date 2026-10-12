// The restricted content-mutation boundary a hosted editor role goes through.
//
// The host supplies its trusted policy and the authenticated actor out of
// band; the request is untrusted JSON that may only name stable record/field
// ids and the revision it was prepared against. Nothing in a request can
// widen the policy: extra keys are rejected before anything is looked at,
// and schema, component, template, mapping and sitemap records are not
// reachable from any request kind. The result is either a `ContentMutation`
// the host applies through its storage adapter, or one typed refusal.

import type { JsonValue } from "@zudo-composer/component-contract";
import { isSafeRecordId, isPlainObject, isJsonSafe } from "../shared";
import { contentEntrySemanticIssue, createContentEntryRecord } from "../content/library";
import type { ContentMutation, ContentMutationOperation, ContentSnapshot } from "../content/library";
import type { ContentEntryRecord, ContentFieldDefinition, ContentModelRecord, ContentValueSchema } from "../content/model";
import { isValueValidForField, traverseContentSchema } from "../content/model";
import { DEFAULT_MARKDOWN_CONTENT_POLICY, diagnoseMarkdownValue, type MarkdownContentPolicy } from "./markdown-policy";

export const HOST_CONTENT_OPERATIONS = ["put-entry-values", "create-entry", "delete-entry", "reorder"] as const;
export type HostContentOperation = (typeof HOST_CONTENT_OPERATIONS)[number];

export interface HostContentModelPolicy {
  /** Field ids of the model this role may write. Everything else is read-only. */
  readonly fields: readonly string[];
  readonly operations: readonly HostContentOperation[];
  readonly markdown?: MarkdownContentPolicy;
}

export interface HostContentAssetPolicy {
  readonly providerId: string;
  /** The approved, committed catalog ids an `asset-use` value may name. */
  readonly assetIds: readonly string[];
}

/** Trusted host configuration; never derived from a request. */
export interface HostContentPolicy {
  readonly projectId: string;
  readonly providerId: string;
  readonly models: Readonly<Record<string, HostContentModelPolicy>>;
  readonly assets?: HostContentAssetPolicy;
  readonly markdown?: MarkdownContentPolicy;
}

/** Verified by the host (session, Access JWT, …) before any request is read. */
export interface HostContentActor {
  readonly subject: string;
}

interface ContentMutationRequestBase {
  readonly projectId: string;
  readonly providerId: string;
  readonly modelId: string;
  /** The Content snapshot mutation token the request was prepared against. */
  readonly expectedRevision: number;
}

export type ContentMutationRequest =
  | (ContentMutationRequestBase & { readonly kind: "put-entry-values"; readonly entryId: string; readonly values: Readonly<Record<string, JsonValue>> })
  | (ContentMutationRequestBase & { readonly kind: "create-entry"; readonly entryId: string; readonly values: Readonly<Record<string, JsonValue>> })
  | (ContentMutationRequestBase & { readonly kind: "delete-entry"; readonly entryId: string })
  /** Rewrites one permitted `number` field across every entry of the model, in the listed order. */
  | (ContentMutationRequestBase & { readonly kind: "reorder"; readonly fieldId: string; readonly entryIds: readonly string[] });

export type ContentMutationRefusalCode =
  | "malformed-request" | "forbidden" | "wrong-project" | "stale" | "unknown-model" | "unknown-field"
  | "not-found" | "conflict" | "invalid-value" | "unsafe-reference";

export interface ContentMutationRefusal {
  readonly ok: false;
  readonly code: ContentMutationRefusalCode;
  readonly message: string;
  readonly path?: string;
}

export interface AuthorizedContentMutation {
  readonly ok: true;
  readonly request: ContentMutationRequest;
  readonly actor: HostContentActor;
  readonly mutation: ContentMutation;
  readonly affectedEntryIds: readonly string[];
}

export type ContentMutationAuthorization = AuthorizedContentMutation | ContentMutationRefusal;

export interface AuthorizeContentMutationOptions {
  /** Canonical ISO timestamp source for `updatedAt`/`createdAt`; defaults to the real clock. */
  now?: () => string;
}

const BASE_KEYS = ["kind", "projectId", "providerId", "modelId", "expectedRevision"] as const;
const REQUEST_KEYS: Record<HostContentOperation, readonly string[]> = {
  "put-entry-values": [...BASE_KEYS, "entryId", "values"],
  "create-entry": [...BASE_KEYS, "entryId", "values"],
  "delete-entry": [...BASE_KEYS, "entryId"],
  reorder: [...BASE_KEYS, "fieldId", "entryIds"],
};
const PRIVILEGE_KEYS = new Set(["actor", "role", "roles", "policy", "capabilities", "permissions", "schema", "model", "fields", "operations", "project", "subject"]);

const refuse = (code: ContentMutationRefusalCode, message: string, path?: string): ContentMutationRefusal => ({ ok: false, code, message, ...(path ? { path } : {}) });

function entryRefs(schema: ContentValueSchema, value: JsonValue): { providerId: string; modelId: string; recordId: string }[] {
  switch (schema.kind) {
    case "reference": return [value as { providerId: string; modelId: string; recordId: string }];
    case "reference-list": return value as { providerId: string; modelId: string; recordId: string }[];
    case "object": return Object.entries(value as Record<string, JsonValue>).flatMap(([id, item]) => { const child = schema.fields.find((candidate) => candidate.id === id); return child ? entryRefs(child, item) : []; });
    case "list": return (value as JsonValue[]).flatMap((item) => entryRefs(schema.item, item));
    default: return [];
  }
}

function assetIds(schema: ContentValueSchema, value: JsonValue): { providerId: string; assetId: string }[] {
  switch (schema.kind) {
    case "asset-use": return [(value as { asset: { providerId: string; assetId: string } }).asset];
    case "object": return Object.entries(value as Record<string, JsonValue>).flatMap(([id, item]) => { const child = schema.fields.find((candidate) => candidate.id === id); return child ? assetIds(child, item) : []; });
    case "list": return (value as JsonValue[]).flatMap((item) => assetIds(schema.item, item));
    default: return [];
  }
}

function markdownValues(schema: ContentValueSchema, value: JsonValue): string[] {
  switch (schema.kind) {
    case "markdown": return typeof value === "string" ? [value] : [];
    case "object": return Object.entries(value as Record<string, JsonValue>).flatMap(([id, item]) => { const child = schema.fields.find((candidate) => candidate.id === id); return child ? markdownValues(child, item) : []; });
    case "list": return (value as JsonValue[]).flatMap((item) => markdownValues(schema.item, item));
    default: return [];
  }
}

function checkValues(
  policy: HostContentPolicy,
  modelPolicy: HostContentModelPolicy,
  model: ContentModelRecord,
  snapshot: ContentSnapshot,
  values: Readonly<Record<string, JsonValue>>,
  entryId: string,
): ContentMutationRefusal | undefined {
  const fields = new Map(model.document.fields.map((field) => [field.id, field]));
  const markdownPolicy = modelPolicy.markdown ?? policy.markdown ?? DEFAULT_MARKDOWN_CONTENT_POLICY;
  for (const [fieldId, value] of Object.entries(values)) {
    const path = `values.${fieldId}`;
    if (!isSafeRecordId(fieldId)) return refuse("malformed-request", "Field ids must be safe record ids.", path);
    const field = fields.get(fieldId);
    if (!field) return refuse("unknown-field", `Model "${model.id}" has no field "${fieldId}".`, path);
    if (!modelPolicy.fields.includes(fieldId)) return refuse("forbidden", `Field "${field.key}" is not editable by this role.`, path);
    if (!isValueValidForField(field, value)) return refuse("invalid-value", `Value for field "${field.key}" does not match ${field.kind}.`, path);
    for (const ref of entryRefs(field, value)) {
      if (ref.providerId !== policy.providerId) return refuse("unsafe-reference", `Reference in "${field.key}" targets another Content provider.`, path);
      if (!snapshot.entries.some((entry) => entry.id === ref.recordId && entry.modelId === ref.modelId)) return refuse("unsafe-reference", `Reference in "${field.key}" targets a missing entry "${ref.recordId}".`, path);
      if (ref.recordId === entryId) return refuse("unsafe-reference", `Field "${field.key}" cannot reference its own entry.`, path);
    }
    for (const asset of assetIds(field, value)) {
      if (!policy.assets || asset.providerId !== policy.assets.providerId || !policy.assets.assetIds.includes(asset.assetId)) {
        return refuse("unsafe-reference", `Asset "${asset.assetId}" is not in the approved catalog.`, path);
      }
    }
    for (const markdown of markdownValues(field, value)) {
      const [diagnostic] = diagnoseMarkdownValue(markdown, markdownPolicy);
      if (diagnostic) return refuse(diagnostic.code === "unsafe-link" ? "unsafe-reference" : "invalid-value", `Markdown in "${field.key}": ${diagnostic.message}`, path);
    }
  }
  return undefined;
}

function numberField(model: ContentModelRecord, fieldId: string): ContentFieldDefinition | undefined {
  return traverseContentSchema(model.document.fields).find(({ field, path }) => path.length === 1 && field.id === fieldId && field.kind === "number")?.field;
}

/**
 * Decide one request. Pure: reads the policy, the actor and the current
 * Content snapshot, and returns the exact mutation to apply or why not.
 */
export function authorizeContentMutation(
  policy: HostContentPolicy,
  actor: HostContentActor,
  request: unknown,
  snapshot: ContentSnapshot,
  options: AuthorizeContentMutationOptions = {},
): ContentMutationAuthorization {
  if (!isPlainObject(actor) || typeof actor.subject !== "string" || actor.subject.trim().length === 0) return refuse("forbidden", "A verified actor is required.");
  if (!isPlainObject(request)) return refuse("malformed-request", "Request must be a plain object.");
  for (const key of Object.keys(request)) if (PRIVILEGE_KEYS.has(key)) return refuse("malformed-request", `Request may not supply "${key}"; it comes from the host.`, key);
  if (typeof request.kind !== "string" || !(HOST_CONTENT_OPERATIONS as readonly string[]).includes(request.kind)) return refuse("malformed-request", "Unknown request kind.", "kind");
  const kind = request.kind as HostContentOperation;
  const keys = REQUEST_KEYS[kind];
  if (Object.keys(request).length !== keys.length || !keys.every((key) => Object.hasOwn(request, key))) return refuse("malformed-request", `A ${kind} request must contain exactly: ${keys.join(", ")}.`);
  if (!isJsonSafe(request)) return refuse("malformed-request", "Request must be JSON-safe.");
  if (typeof request.projectId !== "string" || typeof request.providerId !== "string") return refuse("malformed-request", "projectId and providerId must be strings.");
  if (!isSafeRecordId(request.modelId)) return refuse("malformed-request", "modelId must be a safe record id.", "modelId");
  if (!Number.isSafeInteger(request.expectedRevision) || (request.expectedRevision as number) < 0) return refuse("malformed-request", "expectedRevision must be a nonnegative safe integer.", "expectedRevision");
  if (request.projectId !== policy.projectId || request.providerId !== policy.providerId) return refuse("wrong-project", "Request targets a project or Content provider this host does not edit.");
  if (snapshot.providerId !== policy.providerId) return refuse("wrong-project", "The Content snapshot belongs to another provider.");
  if (request.expectedRevision !== snapshot.mutationToken) return refuse("stale", `Content is at revision ${snapshot.mutationToken}; the request expected ${String(request.expectedRevision)}.`);
  const modelId = request.modelId as string;
  const modelPolicy = policy.models[modelId];
  if (!modelPolicy) return refuse("forbidden", `Model "${modelId}" is not editable by this role.`, "modelId");
  const model = snapshot.models.find((candidate) => candidate.id === modelId);
  if (!model) return refuse("unknown-model", `Model "${modelId}" does not exist.`, "modelId");
  if (!modelPolicy.operations.includes(kind)) return refuse("forbidden", `Operation ${kind} is not permitted on model "${modelId}".`, "kind");
  const typed = request as unknown as ContentMutationRequest;
  const now = options.now ?? (() => new Date().toISOString());
  const modelEntries = snapshot.entries.filter((entry) => entry.modelId === modelId);
  const authorized = (operations: ContentMutationOperation[], affectedEntryIds: string[]): AuthorizedContentMutation => ({
    ok: true, request: typed, actor: { subject: actor.subject }, mutation: { expectedMutationToken: snapshot.mutationToken, operations }, affectedEntryIds,
  });

  switch (typed.kind) {
    case "put-entry-values": {
      if (!isSafeRecordId(typed.entryId)) return refuse("malformed-request", "entryId must be a safe record id.", "entryId");
      if (!isPlainObject(typed.values)) return refuse("malformed-request", "values must be a plain object.", "values");
      const existing = modelEntries.find((entry) => entry.id === typed.entryId);
      if (!existing) return refuse("not-found", `Entry "${typed.entryId}" does not exist in model "${modelId}".`, "entryId");
      const refused = checkValues(policy, modelPolicy, model, snapshot, typed.values, typed.entryId);
      if (refused) return refused;
      const timestamp = now();
      const record: ContentEntryRecord = { ...existing, updatedAt: timestamp < existing.updatedAt ? existing.updatedAt : timestamp, values: { ...existing.values, ...structuredClone(typed.values) } };
      const issue = contentEntrySemanticIssue(record, model);
      if (issue) return refuse("invalid-value", issue, "values");
      return authorized([{ kind: "put-entry", record }], [record.id]);
    }
    case "create-entry": {
      if (!isSafeRecordId(typed.entryId)) return refuse("malformed-request", "entryId must be a safe record id.", "entryId");
      if (!isPlainObject(typed.values)) return refuse("malformed-request", "values must be a plain object.", "values");
      if (snapshot.entries.some((entry) => entry.id === typed.entryId)) return refuse("conflict", `Entry "${typed.entryId}" already exists.`, "entryId");
      if (model.document.kind === "single" && modelEntries.length > 0) return refuse("forbidden", `Model "${modelId}" holds a single entry.`, "modelId");
      const refused = checkValues(policy, modelPolicy, model, snapshot, typed.values, typed.entryId);
      if (refused) return refused;
      const record = createContentEntryRecord(modelId, structuredClone(typed.values) as ContentEntryRecord["values"], { id: typed.entryId, timestamp: now() });
      const issue = contentEntrySemanticIssue(record, model);
      if (issue) return refuse("invalid-value", issue, "values");
      return authorized([{ kind: "put-entry", record }], [record.id]);
    }
    case "delete-entry": {
      if (!isSafeRecordId(typed.entryId)) return refuse("malformed-request", "entryId must be a safe record id.", "entryId");
      if (!modelEntries.some((entry) => entry.id === typed.entryId)) return refuse("not-found", `Entry "${typed.entryId}" does not exist in model "${modelId}".`, "entryId");
      for (const owner of snapshot.entries) {
        const ownerModel = snapshot.models.find((candidate) => candidate.id === owner.modelId);
        if (!ownerModel || owner.id === typed.entryId) continue;
        for (const field of ownerModel.document.fields) {
          const value = owner.values[field.id];
          if (value !== undefined && entryRefs(field, value).some((ref) => ref.recordId === typed.entryId && ref.modelId === modelId)) {
            return refuse("unsafe-reference", `Entry "${typed.entryId}" is still referenced by "${owner.id}".`, "entryId");
          }
        }
      }
      return authorized([{ kind: "delete-entry", id: typed.entryId }], [typed.entryId]);
    }
    case "reorder": {
      if (!isSafeRecordId(typed.fieldId)) return refuse("malformed-request", "fieldId must be a safe record id.", "fieldId");
      if (!Array.isArray(typed.entryIds) || !typed.entryIds.every(isSafeRecordId)) return refuse("malformed-request", "entryIds must be safe record ids.", "entryIds");
      const field = numberField(model, typed.fieldId);
      if (!model.document.fields.some((candidate) => candidate.id === typed.fieldId)) return refuse("unknown-field", `Model "${modelId}" has no field "${typed.fieldId}".`, "fieldId");
      if (!field) return refuse("invalid-value", `Field "${typed.fieldId}" is not a top-level number field.`, "fieldId");
      if (!modelPolicy.fields.includes(typed.fieldId)) return refuse("forbidden", `Field "${field.key}" is not editable by this role.`, "fieldId");
      const listed = new Set(typed.entryIds);
      if (listed.size !== typed.entryIds.length || listed.size !== modelEntries.length || !modelEntries.every((entry) => listed.has(entry.id))) {
        return refuse("not-found", `reorder must list every entry of model "${modelId}" exactly once.`, "entryIds");
      }
      const timestamp = now();
      const operations: ContentMutationOperation[] = typed.entryIds.map((entryId, index) => {
        const existing = modelEntries.find((entry) => entry.id === entryId)!;
        return { kind: "put-entry", record: { ...existing, updatedAt: timestamp < existing.updatedAt ? existing.updatedAt : timestamp, values: { ...existing.values, [typed.fieldId]: index } } };
      });
      return authorized(operations, [...typed.entryIds]);
    }
  }
}
