// The host preview postMessage protocol: the only thing that crosses the
// boundary between a hosted content editor (parent) and the host-owned
// document the preview iframe renders.
//
// It follows the Composer preview protocol's trust model: every inbound
// message passes the source gate, then the exact-origin gate, then a strict
// zod schema; outbound messages always use an exact target origin. It carries
// identities only. The iframe fetches the snapshot's rendered document from
// the host itself, so no document, VNode or source text ever enters a message.
//
// Identity, not time, decides what "previewed" means. A render request names
// `snapshotId`, `revision`, `route` and the iframe's `frameLoadId`; a
// `rendered` acknowledgement counts only when all four equal the outstanding
// request, so a late response from a previous load, route or revision can
// never mark a newer edit as previewed.

import { z } from "zod";

export const HOST_PREVIEW_CHANNEL = "zudo-composer-host-preview" as const;
export const HOST_PREVIEW_PROTOCOL_VERSION = 1 as const;

export interface HostPreviewPackIdentity {
  readonly packId: string;
  readonly packVersion: string;
}

/** What one render request names; the iframe echoes it back exactly. */
export interface HostPreviewRequest {
  readonly snapshotId: string;
  readonly revision: number;
  readonly route: string;
  readonly frameLoadId: string;
}

const envelope = {
  channel: z.literal(HOST_PREVIEW_CHANNEL),
  v: z.literal(HOST_PREVIEW_PROTOCOL_VERSION),
  packId: z.string().min(1),
  packVersion: z.string().min(1),
} as const;

const snapshotIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
const revisionSchema = z.number().int().nonnegative();
const routeSchema = z.string().regex(/^\/(?!\/)[^\s?#]*$/);
const frameLoadIdSchema = z.string().min(1).max(128);

// ── parent → preview ────────────────────────────────────────────────────────

export const hostRenderMessageSchema = z.object({
  ...envelope,
  type: z.literal("render"),
  snapshotId: snapshotIdSchema,
  revision: revisionSchema,
  route: routeSchema,
  frameLoadId: frameLoadIdSchema,
}).strict();

export const hostToPreviewSchema = z.discriminatedUnion("type", [hostRenderMessageSchema]);
export type HostRenderMessage = z.infer<typeof hostRenderMessageSchema>;
export type HostToPreviewMessage = z.infer<typeof hostToPreviewSchema>;

// ── preview → parent ────────────────────────────────────────────────────────

/** Emitted on every load with a fresh `frameLoadId`; the parent replays its newest request under that id. */
export const previewReadyMessageSchema = z.object({ ...envelope, type: z.literal("ready"), frameLoadId: frameLoadIdSchema }).strict();

export const previewRenderedMessageSchema = z.object({
  ...envelope,
  type: z.literal("rendered"),
  snapshotId: snapshotIdSchema,
  revision: revisionSchema,
  route: routeSchema,
  frameLoadId: frameLoadIdSchema,
}).strict();

export const previewErrorMessageSchema = z.object({
  ...envelope,
  type: z.literal("error"),
  snapshotId: snapshotIdSchema.nullable(),
  revision: revisionSchema.nullable(),
  route: routeSchema.nullable(),
  frameLoadId: frameLoadIdSchema,
  message: z.string().min(1),
  /** False only if the preview cannot continue without a reload. */
  recoverable: z.boolean(),
}).strict();

export const previewToHostSchema = z.discriminatedUnion("type", [previewReadyMessageSchema, previewRenderedMessageSchema, previewErrorMessageSchema]);
export type PreviewReadyMessage = z.infer<typeof previewReadyMessageSchema>;
export type PreviewRenderedMessage = z.infer<typeof previewRenderedMessageSchema>;
export type PreviewErrorMessage = z.infer<typeof previewErrorMessageSchema>;
export type PreviewToHostMessage = z.infer<typeof previewToHostSchema>;

// ── Structural window/message types ─────────────────────────────────────────

export interface MessageEventLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export interface MessagePoster {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface MessageTarget {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

export type HostPreviewGuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch";

export type HostPreviewGuardResult<T> =
  | { ok: true; message: T }
  | { ok: false; reason: HostPreviewGuardFailure; detail?: string };

export interface HostPreviewExpectation {
  readonly source: unknown;
  readonly origin: string;
  readonly pack: HostPreviewPackIdentity;
}

function guard<T extends HostPreviewPackIdentity>(schema: z.ZodType<T>, event: MessageEventLike, expected: HostPreviewExpectation): HostPreviewGuardResult<T> {
  if (expected.source == null || event.source !== expected.source) return { ok: false, reason: "wrong-source" };
  if (event.origin !== expected.origin) return { ok: false, reason: "wrong-origin" };
  const parsed = schema.safeParse(event.data);
  if (!parsed.success) return { ok: false, reason: "invalid-payload", detail: parsed.error.message };
  if (parsed.data.packId !== expected.pack.packId || parsed.data.packVersion !== expected.pack.packVersion) {
    return { ok: false, reason: "pack-mismatch", detail: `Expected ${expected.pack.packId}@${expected.pack.packVersion}, received ${parsed.data.packId}@${parsed.data.packVersion}.` };
  }
  return { ok: true, message: parsed.data };
}

/** Validate a message arriving AT the preview iframe FROM the host editor. */
export function readHostToPreview(event: MessageEventLike, expected: HostPreviewExpectation): HostPreviewGuardResult<HostToPreviewMessage> {
  return guard(hostToPreviewSchema, event, expected);
}

/** Validate a message arriving AT the host editor FROM the preview iframe. */
export function readPreviewToHost(event: MessageEventLike, expected: HostPreviewExpectation): HostPreviewGuardResult<PreviewToHostMessage> {
  return guard(previewToHostSchema, event, expected);
}

// ── Constructors ────────────────────────────────────────────────────────────

function envelopeValue(pack: HostPreviewPackIdentity) {
  return { channel: HOST_PREVIEW_CHANNEL, v: HOST_PREVIEW_PROTOCOL_VERSION, packId: pack.packId, packVersion: pack.packVersion } as const;
}

export function hostRenderMessage(pack: HostPreviewPackIdentity, request: HostPreviewRequest): HostRenderMessage {
  return { ...envelopeValue(pack), type: "render", snapshotId: request.snapshotId, revision: request.revision, route: request.route, frameLoadId: request.frameLoadId };
}

export function previewReadyMessage(pack: HostPreviewPackIdentity, frameLoadId: string): PreviewReadyMessage {
  return { ...envelopeValue(pack), type: "ready", frameLoadId };
}

export function previewRenderedMessage(pack: HostPreviewPackIdentity, request: HostPreviewRequest): PreviewRenderedMessage {
  return { ...envelopeValue(pack), type: "rendered", snapshotId: request.snapshotId, revision: request.revision, route: request.route, frameLoadId: request.frameLoadId };
}

export function previewErrorMessage(
  pack: HostPreviewPackIdentity,
  frameLoadId: string,
  message: string,
  options: { request?: Omit<HostPreviewRequest, "frameLoadId"> | null; recoverable?: boolean } = {},
): PreviewErrorMessage {
  const request = options.request ?? null;
  return {
    ...envelopeValue(pack),
    type: "error",
    snapshotId: request?.snapshotId ?? null,
    revision: request?.revision ?? null,
    route: request?.route ?? null,
    frameLoadId,
    message,
    recoverable: options.recoverable ?? true,
  };
}

export function sameHostPreviewRequest(left: HostPreviewRequest, right: HostPreviewRequest): boolean {
  return left.snapshotId === right.snapshotId && left.revision === right.revision && left.route === right.route && left.frameLoadId === right.frameLoadId;
}
