import { z } from "zod";
import { isValueValidForField } from "../content/model/validate";
import type { ContentValueSchema } from "../content/model/types";
import { canonicalSerialize } from "./canonical";
import { HostedContentError } from "./types";
import type { HostedCommand, HostedFieldPermission, HostedPolicy, JsonValue } from "./types";

const token = z.string().min(1).max(256);
const ref = z.object({ providerId: token, modelId: token, recordId: token }).strict();
const expected = z.object({ draftRevision: token, baseline: z.object({ gitSha: token, contentDigest: token }).strict(), definition: token }).strict();
const json: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string().max(100_000), z.array(json).max(1_000), z.record(z.string().min(1).max(256), json)]));
const values = z.record(token, json);
const base = { operationKey: token, expected };
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("set-fields"), entry: ref, values, clear: z.array(token).max(200) }).strict(),
  z.object({ ...base, kind: z.literal("create-entry"), collectionId: token, values, before: ref.nullable() }).strict(),
  z.object({ ...base, kind: z.literal("add-entry"), collectionId: token, entry: ref, before: ref.nullable() }).strict(),
  z.object({ ...base, kind: z.literal("reorder"), collectionId: token, entries: z.array(ref).max(1_000) }).strict(),
  z.object({ ...base, kind: z.literal("capture-snapshot") }).strict(),
  z.object({ ...base, kind: z.literal("begin-publication"), snapshotId: token }).strict(),
]);

export function parseHostedCommand(request: unknown): HostedCommand {
  // Bound recursion before entering recursive validators; direct service callers need this too.
  let count = 0, bytes = 0;
  const stack = [{ value: request, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 20_000 || depth > 24) throw new HostedContentError("invalid-request", "Request exceeds structural limits.");
    if (typeof value === "string") bytes += value.length;
    if (bytes > 1_000_000) throw new HostedContentError("invalid-request", "Request exceeds size limit.");
    if (value && typeof value === "object") {
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new HostedContentError("invalid-request", "Request must contain plain JSON.");
      for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new HostedContentError("invalid-request", "Unsafe value key.");
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  const parsed = commandSchema.safeParse(request);
  if (!parsed.success) throw new HostedContentError("invalid-request", "Malformed hosted command.");
  const command = parsed.data;
  if (command.kind === "set-fields" && (new Set(command.clear).size !== command.clear.length || command.clear.some(id => Object.hasOwn(command.values, id)))) throw new HostedContentError("invalid-request", "Fields may be named only once.");
  return parsed.data;
}

export const sameValue = (left: unknown, right: unknown): boolean => left === undefined || right === undefined ? left === right : canonicalSerialize(left) === canonicalSerialize(right);
function forbidden(path: string): never { throw new HostedContentError("forbidden", `Field ${path} is protected.`); }
function invalid(path: string, message: string): never { throw new HostedContentError("invalid-value", `${path}: ${message}`); }

export function assertSafeUrl(value: string): void {
  if (value.length === 0 || value.charCodeAt(0) <= 32 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\") || value.startsWith("//") || !/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value)) throw new HostedContentError("invalid-value", "URL must use an approved non-executable scheme or a site-relative path.");
}

export function assertSafeMarkdown(value: string): void {
  // Hosted Markdown is prose, never MDX. Raw HTML and images bypass the approved asset contract.
  let decoded = value.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex: string, decimal: string) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(hex || decimal, hex ? 16 : 10))));
  decoded = decoded.replace(/&colon;/gi, ":").replace(/&(?:tab|newline);/gi, "").replace(/\\([\s\S])/g, "$1");
  try { decoded = decodeURIComponent(decoded); } catch { /* Plain percent prose remains valid. */ }
  for (const link of decoded.matchAll(/(?:\]\(\s*|^\s*\[[^\]]+\]:\s*)([^\s)]+)/gm)) assertSafeUrl(link[1]!);
  if (/<\/?[a-z!]|<>|<\/>|[{}]|^\s*(?:import|export)\s|!\[/im.test(decoded) || /(?:javascript|vbscript|data)\s*:/i.test(Array.from(decoded).filter(character => character.charCodeAt(0) > 32).join(""))) throw new HostedContentError("invalid-value", "Markdown contains source, HTML, an image or an unsafe URL; use approved asset fields.");
}

/** Compare actual stored values, including protected descendants, before applying replacement. */
export function assertFieldChange(schema: ContentValueSchema, permission: HostedFieldPermission | undefined, previous: JsonValue | undefined, next: JsonValue | undefined, policy: HostedPolicy, path: string, validateMarkdown?: (value: string) => void): void {
  if (sameValue(previous, next)) return;
  if (!permission) forbidden(path);
  if (schema.kind === "slug" || schema.kind === "reference" || schema.kind === "reference-list") forbidden(path);
  if (next === undefined) {
    if (!permission.clear) forbidden(path);
    // Clearing a container must not erase protected descendants.
    if (schema.kind === "object") for (const field of schema.fields) assertFieldChange(field, permission.children?.find(item => item.fieldId === field.id), (previous as Record<string, JsonValue> | undefined)?.[field.id], undefined, policy, `${path}.${field.id}`, validateMarkdown);
    else if (schema.kind === "list" || schema.kind === "asset-use") forbidden(path);
    return;
  }
  if (!isValueValidForField(schema, next)) invalid(path, "Value does not match the Content schema.");
  if (typeof next === "string" && permission.maxLength !== undefined && next.length > permission.maxLength) invalid(path, "Value exceeds the configured length.");
  if (schema.kind === "object") {
    const before = (previous ?? {}) as Record<string, JsonValue>, after = next as Record<string, JsonValue>;
    for (const field of schema.fields) assertFieldChange(field, permission.children?.find(item => item.fieldId === field.id) ?? (permission.replace ? { fieldId: field.id, replace: true, clear: permission.clear } : undefined), before[field.id], after[field.id], policy, `${path}.${field.id}`, validateMarkdown);
    return;
  }
  if (schema.kind === "list") {
    const before = (previous ?? []) as JsonValue[], after = next as JsonValue[];
    if (after.length > before.length && !permission.listAdd || after.length < before.length && !permission.listRemove) forbidden(path);
    if (permission.maxLength !== undefined && after.length > permission.maxLength) invalid(path, "List exceeds the configured length.");
    if (after.length !== before.length) {
      // Without stable item identities only an explicitly replaceable complete subtree may change shape.
      if (!permission.replace || containsProtected(schema.item)) forbidden(path);
    }
    const sortedBefore = before.map(canonicalSerialize).sort(), sortedAfter = after.map(canonicalSerialize).sort();
    if (sameValue(sortedBefore, sortedAfter) && !permission.listReorder) forbidden(path);
    for (let index = 0; index < Math.max(before.length, after.length); index++) assertFieldChange(schema.item, { ...permission, clear: permission.listRemove }, before[index], after[index], policy, `${path}[${index}]`, validateMarkdown);
    return;
  }
  if (schema.kind === "asset-use") {
    const before = previous as Record<string, JsonValue> | undefined, after = next as Record<string, JsonValue>;
    const asset = after.asset as { providerId: string; assetId: string };
    if (!policy.assets.some(item => item.providerId === asset.providerId && item.assetId === asset.assetId)) forbidden(path);
    if (!sameValue(before?.asset, after.asset) && !permission.assetSelect) forbidden(path);
    if (before && before.kind !== after.kind) forbidden(path);
    for (const key of Object.keys(after)) if (key !== "kind" && key !== "asset" && !sameValue(before?.[key], after[key]) && !permission.assetDescription?.includes(key)) forbidden(`${path}.${key}`);
    return;
  }
  if (!permission.replace) forbidden(path);
  if (schema.kind === "url") assertSafeUrl(next as string);
  if (schema.kind === "markdown") { assertSafeMarkdown(next as string); validateMarkdown?.(next as string); }
}
function containsProtected(schema: ContentValueSchema): boolean {
  return ["slug", "reference", "reference-list", "asset-use"].includes(schema.kind) || schema.kind === "object" && schema.fields.some(containsProtected) || schema.kind === "list" && containsProtected(schema.item);
}
