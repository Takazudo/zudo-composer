// The Composer preview postMessage protocol — the ONLY thing that crosses the
// `/composer` ⇄ `/composer/preview` trust boundary.
//
// ── Trust model (locked by epic Takazudo/zudo-sg#243) ────────────────────────────────────────
// The preview runs in an isolated same-origin iframe. Only JSON DATA crosses
// the bridge: never a component function, never a VNode, never source text.
// The iframe receives the trusted local provider and maps the
// received document's stable slot ids onto real Preact props locally. Nothing
// received from a message is ever parsed as code or evaluated.
//
// Every inbound message passes THREE gates, in this order (see `guard` below):
//   1. `event.source` is the exact expected window (the iframe's contentWindow
//      on the parent side; `window.parent` on the iframe side);
//   2. `event.origin === location.origin` — the preview is same-origin, so any
//      other origin is a foreign frame and is dropped;
//   3. the payload validates against a STRICT zod schema (unknown `type`,
//      wrong shape, or ANY extra key is rejected).
// Outbound messages always use an EXACT target origin, never `"*"`.
//
// ── Versioning + additive growth ─────────────────────────────────────────────
// Every envelope carries `channel` + `v`. `channel` keeps the protocol from
// colliding with any other message bus on the page
// (both of which share this `window`); `v` lets a future breaking change be
// rejected rather than misread.
//
// Menu/focus, inline-edit, and move/copy message types all live in this module.
// To add one:
//   1. declare its `.strict()` schema next to its peers below;
//   2. append it to `PARENT_TO_PREVIEW_MEMBERS` / `PREVIEW_TO_PARENT_MEMBERS`;
//   3. add a handler to the corresponding options interface.
// Nothing else changes — the guards, the union types, and the exhaustive
// switches all derive from those two member tuples. The one exception is
// `restore-focus` (Takazudo/zudo-sg#256): it carries no revision (it is a one-shot focus
// command, not a document/session snapshot), so `snapshot-store.ts`'s
// `applyInbound` is typed to only the revision-gated members
// (`RenderMessage | ModeMessage`) and `client.ts` intercepts `restore-focus`
// before it would ever reach that fold — see both files' comments.

import { z } from "zod";
import type {
  CompositionBinding,
  CompositionDocument,
  CompositionNode,
  CompositionPublication,
  GlobalTemplateOutlet,
  GlobalTemplateOutletTarget,
  InsertionTarget,
} from "../headless-api";
import { COMPOSITION_RECORD_ID_PATTERN, COMPOSITION_SCHEMA_VERSION } from "../headless-api";
import { RESERVED_PERSISTED_KEYS } from "@zudo-composer/component-contract";

export const RESERVED_PROP_KEYS = new Set<string>(RESERVED_PERSISTED_KEYS);

const jsonValueSchema: z.ZodType<import("@zudo-composer/component-contract").JsonValue> = z.lazy(() =>
  z.union([
    z.string(), z.number().finite(), z.boolean(), z.null(),
    z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
  ]),
);

/** Envelope discriminator — keeps Composer traffic off other message buses. */
export const COMPOSER_PREVIEW_CHANNEL = "composer-preview" as const;

/** Protocol version. Bump only on a BREAKING envelope change. */
export const COMPOSER_PREVIEW_PROTOCOL_VERSION = 2 as const;

export interface PreviewPackIdentity {
  readonly packId: string;
  readonly packVersion: string;
}

// ── Session ─────────────────────────────────────────────────────────────────

/** Edit shows authoring affordances; Preview renders the bare components. */
export type PreviewMode = "edit" | "preview";
export type PreviewTheme = "light" | "dark";

/**
 * The slice of `/composer` SESSION state the preview needs. Deliberately not
 * document state: it is never persisted into the `CompositionDocument`.
 */
export interface PreviewSession {
  mode: PreviewMode;
  theme: PreviewTheme;
  /** Currently selected node id, mirrored from the tree/canvas. */
  selectedId: string | null;
}

export const previewSessionSchema = z
  .object({
    mode: z.enum(["edit", "preview"]),
    theme: z.enum(["light", "dark"]),
    selectedId: z.string().min(1).nullable(),
  })
  .strict();

// ── Composition document (wire schema) ──────────────────────────────────────

/**
 * Prop names a Composition node may NEVER carry.
 *
 * Defined by the component contract
 * so `updateProps` can reject these keys too — not just this wire schema and
 * `renderer.ts`'s `safeProps`. Re-exported here so existing preview-side
 * consumers share the same rejection list.
 */
/**
 * Reject the reserved keys, then parse.
 *
 * The order is the whole point. The check runs on the RAW payload's own property
 * names — not on a record zod has already built — because `result["__proto__"] = v`
 * hits the prototype setter and silently vanishes, so a post-parse check would
 * report a clean document while never having seen the key at all. Reading
 * `Object.getOwnPropertyNames` off the raw value sees exactly what was sent.
 */
const nodePropsSchema = z
  .unknown()
  .superRefine((raw, ctx) => {
    if (raw === null || typeof raw !== "object") return; // shape errors are the record's job
    for (const key of Object.getOwnPropertyNames(raw)) {
      if (!RESERVED_PROP_KEYS.has(key)) continue;
      ctx.addIssue({
        code: "custom",
        message: `props may not contain the reserved key "${key}"`,
      });
    }
  })
  .pipe(z.record(z.string(), jsonValueSchema));

/**
 * Wire-level zod schema for Takazudo/zudo-sg#245's `CompositionNode`. `.strict()` so a payload
 * carrying an extra key (a smuggled `component`, a stray `adapters` object, a
 * future-schema property) is REJECTED rather than silently forwarded into the
 * renderer. The type annotation pins it to the model's own type, so the schema
 * cannot drift from the Composer model without a compile error.
 */
export const compositionNodeSchema: z.ZodType<CompositionNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      componentId: z.string().min(1),
      componentVersion: z.number().int().positive().safe(),
      props: nodePropsSchema,
      slots: z.record(z.string(), z.array(compositionNodeSchema)),
    })
    .strict(),
);

/** Strict wire shape for the one real slot exposed by a Global template. */
export const globalTemplateOutletTargetSchema: z.ZodType<GlobalTemplateOutletTarget> = z
  .object({
    parentId: z.string().min(1),
    slotId: z.string().min(1),
  })
  .strict();

export const globalTemplateOutletSchema: z.ZodType<GlobalTemplateOutlet> = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    target: globalTemplateOutletTargetSchema,
  })
  .strict();

const compositionPublicationSchema: z.ZodType<CompositionPublication> = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("global-template"),
      outlet: globalTemplateOutletSchema,
    })
    .strict(),
  z.object({ kind: z.literal("pattern") }).strict(),
]);

export const compositionBindingSchema: z.ZodType<CompositionBinding> = z
  .object({
    sourceRecordId: z.string().regex(COMPOSITION_RECORD_ID_PATTERN),
    outletId: z.string().min(1),
  })
  .strict();

/** Wire-level zod schema for Takazudo/zudo-sg#245's `CompositionDocument`. */
export const compositionDocumentSchema: z.ZodType<CompositionDocument> = z
  .object({
    schemaVersion: z.literal(COMPOSITION_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string(),
    root: z.array(compositionNodeSchema),
    publication: compositionPublicationSchema.optional(),
    binding: compositionBindingSchema.optional(),
  })
  .strict();

/**
 * The resolved, read-only source half of a linked Global-template view.
 *
 * `document` on a render message is always the consumer's canonical LOCAL
 * document. This optional context is deliberately a second document rather
 * than a projected tree: the iframe can mark ownership while retaining the
 * local document as the only mutation address space. Both documents are JSON
 * only and every key remains subject to the same strict wire validation.
 */
export interface PreviewLinkedSourceContext {
  sourceRecordId: string;
  sourceDocument: CompositionDocument;
  outlet: GlobalTemplateOutlet;
}

export const previewLinkedSourceContextSchema: z.ZodType<PreviewLinkedSourceContext> = z
  .object({
    sourceRecordId: z.string().regex(COMPOSITION_RECORD_ID_PATTERN),
    sourceDocument: compositionDocumentSchema,
    outlet: globalTemplateOutletSchema,
  })
  .strict();

/**
 * Parent-side render input. `localRecordId` names the canonical consumer for
 * owner-qualified runtime keys. `linked` is present only after the
 * provider-owning app has resolved and validated a Global template.
 */
export interface ComposerPreviewSnapshot {
  document: CompositionDocument;
  localRecordId: string;
  linked?: PreviewLinkedSourceContext;
}

export function localPreviewSnapshot(
  document: CompositionDocument,
  localRecordId: string,
): ComposerPreviewSnapshot {
  return { document, localRecordId };
}

/**
 * Wire-level schema for Takazudo/zudo-sg#245's shared `InsertionTarget`. The preview emits this
 * verbatim on `request-add` — an insert-at-INDEX target, never an append-only
 * slot reference (the round-2 contract).
 */
export const insertionTargetSchema: z.ZodType<InsertionTarget> = z
  .object({
    parentId: z.string().min(1).nullable(),
    slotId: z.string().min(1),
    index: z.number().int().nonnegative(),
  })
  .strict();

/**
 * A `getBoundingClientRect()` snapshot, serialized to plain JSON-safe fields
 * (issue Takazudo/zudo-sg#256). `DOMRect`'s own fields are accessor properties on its
 * PROTOTYPE, not own-enumerable properties of an instance, so a bare
 * `JSON.stringify(rect)` yields `{}` — callers must build this explicitly (see
 * `serializeRect` below) rather than spread a live `DOMRect`. `.finite()`
 * rejects `NaN`/`Infinity`, which a detached or zero-sized element can produce.
 */
export const rectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .strict();

export type SerializedRect = z.infer<typeof rectSchema>;

/** Build the wire-safe rect shape from any `DOMRect`-like value. */
export function serializeRect(rect: { x: number; y: number; width: number; height: number }): SerializedRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

// ── Envelope ────────────────────────────────────────────────────────────────

const envelope = {
  channel: z.literal(COMPOSER_PREVIEW_CHANNEL),
  v: z.literal(COMPOSER_PREVIEW_PROTOCOL_VERSION),
  packId: z.string().min(1),
  packVersion: z.string().min(1),
} as const;

/** A monotonically increasing snapshot revision. Stale ones are ignored. */
const revisionSchema = z.number().int().nonnegative();

// ── parent → preview ────────────────────────────────────────────────────────

/** Full snapshot: the whole document plus the session it must be drawn under. */
export const renderMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("render"),
    revision: revisionSchema,
    /** Canonical local consumer document — source nodes never enter controller state. */
    document: compositionDocumentSchema,
    /** Owner namespace for local runtime/DOM keys. */
    localRecordId: z.string().regex(COMPOSITION_RECORD_ID_PATTERN),
    /** Optional already-resolved source/outlet context for a linked Global template. */
    linked: previewLinkedSourceContextSchema.optional(),
    session: previewSessionSchema,
  })
  .strict();

/**
 * Session-only update (Edit/Preview toggle, theme change, selection move). Sent
 * instead of a full `render` when the document has not changed — but it is
 * revision-stamped exactly like a `render`, so the two share one ordering.
 */
export const modeMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("mode"),
    revision: revisionSchema,
    session: previewSessionSchema,
  })
  .strict();

/**
 * Host → preview focus-restore response (issue Takazudo/zudo-sg#256). Sent once a context menu
 * the preview requested (`request-node-menu` / `request-insert-menu`) has
 * closed, so the iframe can restore focus to the EXACT control that opened it
 * — the host never reaches into the iframe's DOM itself; it only echoes back
 * the opaque `focusToken` the preview minted on the original request.
 *
 * Deliberately NOT revision-stamped: it is not a document/session snapshot
 * (nothing in `PreviewState` changes), so it sits outside the
 * `render`/`mode` revision-gated fold in `snapshot-store.ts` — see that
 * module's `applyInbound` and `client.ts`'s `onRestoreFocus` handling.
 */
export const restoreFocusMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("restore-focus"),
    focusToken: z.string().min(1),
  })
  .strict();

/** Append future parent → preview messages here (see the module header). */
export const PARENT_TO_PREVIEW_MEMBERS = [
  renderMessageSchema,
  modeMessageSchema,
  restoreFocusMessageSchema,
] as const;

export const parentToPreviewSchema = z.discriminatedUnion("type", [...PARENT_TO_PREVIEW_MEMBERS]);

export type RenderMessage = z.infer<typeof renderMessageSchema>;
export type ModeMessage = z.infer<typeof modeMessageSchema>;
export type RestoreFocusMessage = z.infer<typeof restoreFocusMessageSchema>;
export type ParentToPreviewMessage = z.infer<typeof parentToPreviewSchema>;

// ── preview → parent ────────────────────────────────────────────────────────

/**
 * The iframe finished booting and is listening. Emitted on EVERY load — a late
 * load or a reload re-emits it, and the parent answers by replaying only its
 * newest snapshot (see `bridge.ts`).
 */
export const readyMessageSchema = z.object({ ...envelope, type: z.literal("ready") }).strict();

/** A node (or empty canvas) was clicked in Edit mode. */
export const selectMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("select"),
    /** Revision the preview was showing when the user acted. */
    revision: revisionSchema,
    nodeId: z.string().min(1).nullable(),
  })
  .strict();

/** An insert point was activated. Carries Takazudo/zudo-sg#245's insert-at-index target. */
export const requestAddMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("request-add"),
    revision: revisionSchema,
    target: insertionTargetSchema,
  })
  .strict();

/**
 * A linked-source affordance was activated. This is navigation only: it never
 * selects, edits, or otherwise mutates a source-owned node from the consumer.
 */
export const openSourceMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("open-source"),
    sourceRecordId: z.string().regex(COMPOSITION_RECORD_ID_PATTERN),
  })
  .strict();

/**
 * The selected node's chrome "⋯" was activated in Edit mode (issue Takazudo/zudo-sg#256).
 * `rect` is the trigger control's own `getBoundingClientRect()`, serialized —
 * IFRAME-LOCAL coordinates; the host translates by the iframe's own offset
 * before positioning the menu (see `composer-canvas-host.tsx`). `focusToken`
 * is opaque to the host: it is only ever echoed back verbatim in a later
 * `restore-focus` message, which this same control's `data-zc-focus-token`
 * attribute is looked up by (see `renderer.ts`'s `focusByToken`).
 */
export const requestNodeMenuMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("request-node-menu"),
    revision: revisionSchema,
    nodeId: z.string().min(1),
    rect: rectSchema,
    focusToken: z.string().min(1),
  })
  .strict();

/**
 * An insert point's "⋯" was activated. Carries Takazudo/zudo-sg#245's insert-at-index target
 * (the round-2 contract) plus the same rect/focusToken pair as
 * `request-node-menu` — see that schema's comment.
 */
export const requestInsertMenuMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("request-insert-menu"),
    revision: revisionSchema,
    target: insertionTargetSchema,
    rect: rectSchema,
    focusToken: z.string().min(1),
  })
  .strict();

/** A render/protocol failure the preview recovered from, surfaced to the host. */
export const errorMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("error"),
    /** Revision in effect when it failed; `null` before the first snapshot. */
    revision: revisionSchema.nullable(),
    message: z.string().min(1),
    /** False only if the preview cannot continue without a reload. */
    recoverable: z.boolean(),
  })
  .strict();

/**
 * An inline-editing session on the canvas committed a new value for a flagged
 * text field (issue Takazudo/zudo-sg#257). Carries the exact `{ nodeId, fieldKey, value }` the
 * host routes through the controller's EXISTING `updateProps` action — no
 * second mutation path — plus `documentRevision`: the revision the preview was
 * showing when the user committed.
 *
 * `documentRevision` is what makes a STALE inline edit droppable: the host
 * compares it against the newest DOCUMENT snapshot it has sent (see
 * `composer-canvas-host.tsx`). An edit committed against a document the host has
 * since superseded is dropped with an honest status, never silently applied.
 * `value` is any string (empty is a legitimate erasure); newlines survive for
 * a multiline field. Field-domain validation stays the controller's job — this
 * schema only guards the WIRE shape.
 */
export const commitInlineEditMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("commit-inline-edit"),
    nodeId: z.string().min(1),
    fieldKey: z.string().min(1),
    value: z.string(),
    documentRevision: revisionSchema,
  })
  .strict();

/**
 * A cross-slot drag & drop completed on the canvas (issue Takazudo/zudo-sg#258). Carries the
 * drag SOURCE's node id, Takazudo/zudo-sg#245's insert-at-index `target`, and `copy` (Alt held
 * at drop → a copy instead of a move). `documentRevision` is the revision the
 * preview was showing when the user dropped — the host uses it exactly like
 * Takazudo/zudo-sg#257's inline-edit `documentRevision` to DROP a stale drop authored against a
 * document it has since superseded (see `composer-canvas-host.tsx`), never
 * silently applying it. The host revalidates the whole operation ATOMICALLY
 * (slot acceptance, cardinality, cycle guard, root semantics, opaque-node
 * policy) before applying — the iframe's own highlight state is advisory only.
 */
export const dropNodeMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("drop-node"),
    sourceNodeId: z.string().min(1),
    target: insertionTargetSchema,
    copy: z.boolean(),
    documentRevision: revisionSchema,
  })
  .strict();

/**
 * A non-editable canvas shortcut asked the host to move through Composer
 * history. This deliberately carries no document revision: undo/redo applies
 * to the host controller's CURRENT history, not to the snapshot that happened
 * to be on screen when the key was pressed.
 */
export const requestHistoryMessageSchema = z
  .object({
    ...envelope,
    type: z.literal("request-history"),
    direction: z.enum(["undo", "redo"]),
  })
  .strict();

/** Append future preview → parent messages here (see the module header). */
export const PREVIEW_TO_PARENT_MEMBERS = [
  readyMessageSchema,
  selectMessageSchema,
  requestAddMessageSchema,
  openSourceMessageSchema,
  requestNodeMenuMessageSchema,
  requestInsertMenuMessageSchema,
  errorMessageSchema,
  commitInlineEditMessageSchema,
  dropNodeMessageSchema,
  requestHistoryMessageSchema,
] as const;

export const previewToParentSchema = z.discriminatedUnion("type", [...PREVIEW_TO_PARENT_MEMBERS]);

export type ReadyMessage = z.infer<typeof readyMessageSchema>;
export type SelectMessage = z.infer<typeof selectMessageSchema>;
export type RequestAddMessage = z.infer<typeof requestAddMessageSchema>;
export type OpenSourceMessage = z.infer<typeof openSourceMessageSchema>;
export type RequestNodeMenuMessage = z.infer<typeof requestNodeMenuMessageSchema>;
export type RequestInsertMenuMessage = z.infer<typeof requestInsertMenuMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type CommitInlineEditMessage = z.infer<typeof commitInlineEditMessageSchema>;
export type DropNodeMessage = z.infer<typeof dropNodeMessageSchema>;
export type RequestHistoryMessage = z.infer<typeof requestHistoryMessageSchema>;
export type PreviewToParentMessage = z.infer<typeof previewToParentSchema>;

// ── Structural window/message types ─────────────────────────────────────────
//
// Structural (not `Window`/`MessageEvent`) so both sides can be unit-tested
// against plain fakes, and so a caller cannot accidentally hand the bridge a
// window it does not actually intend to talk to.

/** The three fields of a `MessageEvent` this protocol is allowed to look at. */
export interface MessageEventLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** Anything that can receive an exact-origin `postMessage`. */
export interface MessagePoster {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Anything that can host the `message` listener. */
export interface MessageTarget {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

// ── The guard ───────────────────────────────────────────────────────────────

export type GuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch";

export type GuardResult<T> =
  | { ok: true; message: T }
  | { ok: false; reason: GuardFailure; detail?: string };

/**
 * The single security gate. `event.data` is NEVER read, parsed, or coerced
 * before the source/origin checks pass and zod has validated it — it is handed
 * to `safeParse` as an opaque `unknown` and nothing else.
 */
function guard<T>(
  schema: z.ZodType<T>,
  event: MessageEventLike,
  expected: { source: unknown; origin: string; pack: PreviewPackIdentity },
): GuardResult<T> {
  // A null/undefined expected source would make `===` match a message whose
  // `source` is also null (e.g. one posted from a detached context), so an
  // unresolved expectation is treated as "trust nothing".
  if (expected.source == null || event.source !== expected.source) {
    return { ok: false, reason: "wrong-source" };
  }
  if (event.origin !== expected.origin) {
    return { ok: false, reason: "wrong-origin" };
  }
  const parsed = schema.safeParse(event.data);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-payload", detail: parsed.error.message };
  }
  const message = parsed.data as T & PreviewPackIdentity;
  if (
    message.packId !== expected.pack.packId
    || message.packVersion !== expected.pack.packVersion
  ) {
    return {
      ok: false,
      reason: "pack-mismatch",
      detail: `Expected ${expected.pack.packId}@${expected.pack.packVersion}, received ${message.packId}@${message.packVersion}.`,
    };
  }
  return { ok: true, message: parsed.data };
}

/** Validate a message arriving AT the preview iframe FROM the parent. */
export function readParentToPreview(
  event: MessageEventLike,
  expected: { source: unknown; origin: string; pack: PreviewPackIdentity },
): GuardResult<ParentToPreviewMessage> {
  return guard(parentToPreviewSchema, event, expected);
}

/** Validate a message arriving AT the parent FROM the preview iframe. */
export function readPreviewToParent(
  event: MessageEventLike,
  expected: { source: unknown; origin: string; pack: PreviewPackIdentity },
): GuardResult<PreviewToParentMessage> {
  return guard(previewToParentSchema, event, expected);
}

// ── Constructors ────────────────────────────────────────────────────────────
//
// Every outbound message is built here, so the envelope can never be forgotten.

export function renderMessage(
  pack: PreviewPackIdentity,
  revision: number,
  snapshot: ComposerPreviewSnapshot,
  session: PreviewSession,
): RenderMessage {
  return {
    ...envelopeValue(pack),
    type: "render",
    revision,
    document: snapshot.document,
    localRecordId: snapshot.localRecordId,
    ...(snapshot.linked ? { linked: snapshot.linked } : {}),
    session,
  };
}

export function modeMessage(pack: PreviewPackIdentity, revision: number, session: PreviewSession): ModeMessage {
  return { ...envelopeValue(pack), type: "mode", revision, session };
}

export function readyMessage(pack: PreviewPackIdentity): ReadyMessage {
  return { ...envelopeValue(pack), type: "ready" };
}

export function selectMessage(pack: PreviewPackIdentity, revision: number, nodeId: string | null): SelectMessage {
  return { ...envelopeValue(pack), type: "select", revision, nodeId };
}

export function requestAddMessage(pack: PreviewPackIdentity, revision: number, target: InsertionTarget): RequestAddMessage {
  return { ...envelopeValue(pack), type: "request-add", revision, target };
}

export function openSourceMessage(pack: PreviewPackIdentity, sourceRecordId: string): OpenSourceMessage {
  return { ...envelopeValue(pack), type: "open-source", sourceRecordId };
}

export function requestNodeMenuMessage(
  pack: PreviewPackIdentity,
  revision: number,
  nodeId: string,
  rect: SerializedRect,
  focusToken: string,
): RequestNodeMenuMessage {
  return { ...envelopeValue(pack), type: "request-node-menu", revision, nodeId, rect, focusToken };
}

export function requestInsertMenuMessage(
  pack: PreviewPackIdentity,
  revision: number,
  target: InsertionTarget,
  rect: SerializedRect,
  focusToken: string,
): RequestInsertMenuMessage {
  return { ...envelopeValue(pack), type: "request-insert-menu", revision, target, rect, focusToken };
}

export function restoreFocusMessage(pack: PreviewPackIdentity, focusToken: string): RestoreFocusMessage {
  return { ...envelopeValue(pack), type: "restore-focus", focusToken };
}

export function commitInlineEditMessage(
  pack: PreviewPackIdentity,
  nodeId: string,
  fieldKey: string,
  value: string,
  documentRevision: number,
): CommitInlineEditMessage {
  return { ...envelopeValue(pack), type: "commit-inline-edit", nodeId, fieldKey, value, documentRevision };
}

export function dropNodeMessage(
  pack: PreviewPackIdentity,
  sourceNodeId: string,
  target: InsertionTarget,
  copy: boolean,
  documentRevision: number,
): DropNodeMessage {
  return { ...envelopeValue(pack), type: "drop-node", sourceNodeId, target, copy, documentRevision };
}

export function requestHistoryMessage(
  pack: PreviewPackIdentity,
  direction: RequestHistoryMessage["direction"],
): RequestHistoryMessage {
  return { ...envelopeValue(pack), type: "request-history", direction };
}

export function errorMessage(
  pack: PreviewPackIdentity,
  revision: number | null,
  message: string,
  recoverable = true,
): ErrorMessage {
  return { ...envelopeValue(pack), type: "error", revision, message, recoverable };
}

function envelopeValue(pack: PreviewPackIdentity) {
  return {
    channel: COMPOSER_PREVIEW_CHANNEL,
    v: COMPOSER_PREVIEW_PROTOCOL_VERSION,
    packId: pack.packId,
    packVersion: pack.packVersion,
  } as const;
}
