/** Additive hosted-document messages on the existing guarded Composer wire protocol.
 * This module is portable: no browser globals or renderer implementations. */
import { z } from "zod";
import type { JsonValue } from "./types";
import {
  guardPreviewMessage, previewEnvelopeSchema, previewEnvelopeValue,
  type MessageEventLike, type PreviewPackIdentity, type GuardResult,
} from "../features/composer/preview/wire";
export { COMPOSER_PREVIEW_CHANNEL, COMPOSER_PREVIEW_PROTOCOL_VERSION } from "../features/composer/preview/wire";
export type { MessageEventLike, MessageTarget, MessagePoster, PreviewPackIdentity } from "../features/composer/preview/wire";

export interface HostedRendererIdentity { rendererId: string; rendererVersion: string }
const token = z.string().min(1);
const renderer = { rendererId: token, rendererVersion: token };
const envelope = { ...previewEnvelopeSchema, ...renderer };

// Structured-clone supports more than JSON. Reject non-JSON values even when
// tests/adapters supply objects directly, before the recursive parser clones them.
const jsonObject: z.ZodType<Record<string, JsonValue>> = z.unknown().superRefine((value, ctx) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    ctx.addIssue({ code: "custom", message: "Expected a plain JSON object" });
  }
}).pipe(z.lazy(() => z.record(z.string(), json)));
const json: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), jsonObject,
]));

const renderDataSchema = z.unknown().superRefine((value, ctx) => {
  const active = new Set<object>();
  const stack: { value: unknown; exit?: boolean; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.value === null || typeof item.value !== "object") continue;
    if (item.exit) { active.delete(item.value); continue; }
    if (item.depth > 128 || active.has(item.value)) {
      ctx.addIssue({ code: "custom", message: "Render data must be acyclic JSON with bounded nesting" });
      return;
    }
    active.add(item.value);
    stack.push({ ...item, exit: true });
    const array = Array.isArray(item.value);
    for (const key of Reflect.ownKeys(item.value)) {
      if (typeof key !== "string") {
        ctx.addIssue({ code: "custom", message: "Render data cannot contain symbol keys" });
        return;
      }
      if (array && key === "length") continue;
      if (array && (!Number.isSafeInteger(Number(key)) || Number(key) < 0 || String(Number(key)) !== key)) {
        ctx.addIssue({ code: "custom", message: "JSON arrays cannot contain named properties" });
        return;
      }
      const property = Object.getOwnPropertyDescriptor(item.value, key)!;
      if (key === "__proto__" || !("value" in property) || !property.enumerable) {
        ctx.addIssue({ code: "custom", message: "Render data cannot contain prototype keys or accessors" });
        return;
      }
      stack.push({ value: property.value, depth: item.depth + 1 });
    }
  }
}).pipe(json);

export const hostedPreviewBindingSchema = z.object({
  frameSession: token,
  frameGeneration: z.number().int().nonnegative().safe(),
  requestId: z.number().int().positive().safe(),
  snapshotId: token,
  snapshotDigest: token,
  draftRevision: token,
  baseline: z.object({ gitSha: token, contentDigest: token }).strict(),
  definition: token,
  routeId: token,
}).strict();
export type HostedPreviewBinding = z.infer<typeof hostedPreviewBindingSchema>;
export const hostedReadySchema = z.object({ ...envelope, type: z.literal("host-ready"), frameSession: token }).strict();
export const hostedRenderSchema = z.object({ ...envelope, ...hostedPreviewBindingSchema.shape,
  type: z.literal("document-render"), renderData: renderDataSchema }).strict();
export const hostedRenderedSchema = z.object({ ...envelope, ...hostedPreviewBindingSchema.shape,
  type: z.literal("document-rendered") }).strict();
export const hostedDocumentErrorSchema = z.object({ ...envelope, ...hostedPreviewBindingSchema.shape,
  type: z.literal("document-error"),
  code: z.enum(["render-failed", "missing-dependency", "unsupported-route", "invalid-document"]),
  message: token,
}).strict();
export const hostedPreviewResponseSchema = z.discriminatedUnion("type", [hostedReadySchema, hostedRenderedSchema, hostedDocumentErrorSchema]);
export type HostedDocumentRender = z.infer<typeof hostedRenderSchema>;
export type HostedDocumentRendered = z.infer<typeof hostedRenderedSchema>;
export type HostedDocumentError = z.infer<typeof hostedDocumentErrorSchema>;
export type HostedPreviewResponse = z.infer<typeof hostedPreviewResponseSchema>;
export type HostedPreviewGuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch" | "renderer-mismatch";

type Expected = { source: unknown; origin: string; pack: PreviewPackIdentity; renderer: HostedRendererIdentity };
function read<T extends HostedRendererIdentity>(schema: z.ZodType<T>, event: MessageEventLike, expected: Expected):
  GuardResult<T> | { ok: false; reason: "renderer-mismatch"; detail: string } {
  const result = guardPreviewMessage(schema, event, expected);
  if (!result.ok) return result;
  if (result.message.rendererId !== expected.renderer.rendererId || result.message.rendererVersion !== expected.renderer.rendererVersion) {
    return { ok: false, reason: "renderer-mismatch", detail: "Preview renderer identity does not match" };
  }
  return result;
}
export function readHostedPreviewRequest(event: MessageEventLike, expected: Expected) { return read(hostedRenderSchema, event, expected); }
export function readHostedPreviewResponse(event: MessageEventLike, expected: Expected) { return read(hostedPreviewResponseSchema, event, expected); }
export function hostedReadyMessage(pack: PreviewPackIdentity, identity: HostedRendererIdentity, frameSession: string) {
  return hostedReadySchema.parse({ ...previewEnvelopeValue(pack), ...identity, type: "host-ready", frameSession });
}
export function hostedRenderMessage(pack: PreviewPackIdentity, identity: HostedRendererIdentity, binding: HostedPreviewBinding, renderData: JsonValue): HostedDocumentRender {
  return hostedRenderSchema.parse({ ...previewEnvelopeValue(pack), ...identity, ...binding, type: "document-render", renderData });
}
export function hostedRenderedMessage(request: HostedDocumentRender): HostedDocumentRendered {
  const { renderData, ...rest } = request;
  void renderData;
  return hostedRenderedSchema.parse({ ...rest, type: "document-rendered" });
}
export function hostedDocumentErrorMessage(request: HostedDocumentRender, code: HostedDocumentError["code"], message: string): HostedDocumentError {
  const { renderData, ...rest } = request;
  void renderData;
  return hostedDocumentErrorSchema.parse({ ...rest, type: "document-error", code, message });
}
/** Result binding equality deliberately covers every identity, never only request ID. */
export function matchesHostedPreviewBinding(a: HostedPreviewBinding, b: HostedPreviewBinding): boolean {
  return a.frameSession === b.frameSession && a.frameGeneration === b.frameGeneration && a.requestId === b.requestId
    && a.snapshotId === b.snapshotId && a.snapshotDigest === b.snapshotDigest && a.draftRevision === b.draftRevision
    && a.baseline.gitSha === b.baseline.gitSha && a.baseline.contentDigest === b.baseline.contentDigest
    && a.definition === b.definition && a.routeId === b.routeId;
}
