// The expected-revision save path of the restricted content editor.
//
// The browser editor never writes records. It sends one untrusted
// `ContentMutationRequest` (stable ids, permitted field values and the
// revision it was prepared against) under a caller-minted `operationId`, and
// the host's trusted service decides it here:
//
//   1. An operation id that already has a receipt is recovered FIRST, before
//      any fresh validation or revision check. The same id with the same
//      request returns the original receipt even after later saves moved the
//      draft; the same id with a different request is an operation-id
//      conflict. That is what makes a retry after a lost acknowledgement safe.
//   2. A fresh request is authorized against the current draft with
//      `authorizeContentMutation`; a stale `expectedRevision` is a
//      `draft-revision` conflict carrying the current identities.
//   3. The derived mutation is applied through the storage adapter, which
//      compares both revisions and the operation id inside its own
//      transaction, keyed by the digest of the caller's request.
//
// `ContentEditorStorage` is the shape the browser mount consumes. A host
// implements it over its own transport (for example `fetch` to a Worker that
// calls `applyHostContentRequest`); `createContentEditorStorage` binds it
// directly to an adapter for in-process hosts and tests.

import type { JsonValue } from "@zudo-composer/component-contract";
import { canonicalStringifyJson } from "../site-project/model/canonical";
import { authorizeContentMutation, type ContentMutationRefusal, type ContentMutationRequest, type HostContentActor, type HostContentPolicy } from "./policy";
import {
  sha256Hex,
  type ContentDraftApplied,
  type ContentDraftMutationResult,
  type ContentDraftReadResult,
  type ContentDraftState,
  type ContentDraftStorageAdapter,
  type ContentOperationReceipt,
  type ContentSnapshotRecord,
} from "./storage";

export interface HostContentApplyInput {
  /** Caller-minted, reused verbatim for every retry of the same intent. */
  readonly operationId: string;
  /** Untrusted request JSON; validated by `authorizeContentMutation`. */
  readonly request: unknown;
  /** The baseline identity the editor loaded alongside `request.expectedRevision`. */
  readonly expectedBaselineRevision: string;
}

/** The adapter's result vocabulary plus the policy's own refusal. Nothing is written on `refused`. */
export type HostContentApplyResult = ContentDraftMutationResult<ContentDraftApplied> | { status: "refused"; refusal: ContentMutationRefusal };

export interface HostContentServiceOptions {
  readonly policy: HostContentPolicy;
  /** Verified by the host before the request is read. */
  readonly actor: HostContentActor;
  readonly now?: () => string;
}

/** Bounded so a request id can be stored as a key; the editor mints UUIDs. */
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isHostContentOperationId(value: unknown): value is string {
  return typeof value === "string" && OPERATION_ID.test(value);
}

/** Digest binding the actor, the exact request and the expected baseline: the replay identity of one operation. */
export function hostContentRequestDigest(actor: HostContentActor, request: unknown, expectedBaselineRevision: string): Promise<string> {
  return sha256Hex(canonicalStringifyJson({ subject: actor.subject, request, expectedBaselineRevision } as unknown as JsonValue));
}

function refused(message: string, path?: string): HostContentApplyResult {
  return { status: "refused", refusal: { ok: false, code: "malformed-request", message, ...(path ? { path } : {}) } };
}

/** Decide and apply one editor save. See the module header for the order of checks. */
export async function applyHostContentRequest(adapter: ContentDraftStorageAdapter, input: HostContentApplyInput, options: HostContentServiceOptions): Promise<HostContentApplyResult> {
  if (!isHostContentOperationId(input.operationId)) return refused("operationId must be a short opaque token.", "operationId");
  if (typeof input.expectedBaselineRevision !== "string" || input.expectedBaselineRevision.length === 0) return refused("expectedBaselineRevision is required.", "expectedBaselineRevision");
  const subject = typeof options.actor?.subject === "string" ? options.actor.subject : "";
  if (subject.trim().length === 0) return { status: "refused", refusal: { ok: false, code: "forbidden", message: "A verified actor is required." } };
  let requestDigest: string;
  try { requestDigest = await hostContentRequestDigest(options.actor, input.request, input.expectedBaselineRevision); }
  catch { return refused("Request must be JSON-safe."); }

  const prior = await adapter.readReceipt(input.operationId);
  if (prior.status === "unavailable") return prior;
  if (prior.status === "ok") {
    const draft = await adapter.readDraft();
    if (draft.status !== "ok") return draft.status === "not-found" ? { status: "unavailable", message: "The draft could not be read." } : draft;
    if (prior.value.actor.subject !== subject || prior.value.requestDigest !== requestDigest) {
      return { status: "conflict", reason: "operation-id", current: { draftRevision: draft.value.draftRevision, baselineRevision: draft.value.baselineRevision } };
    }
    return { status: "ok", value: { receipt: prior.value, draft: draft.value, replayed: true } };
  }

  const draft = await adapter.readDraft();
  if (draft.status !== "ok") return draft.status === "not-found" ? { status: "unavailable", message: "The draft could not be read." } : draft;
  const current = { draftRevision: draft.value.draftRevision, baselineRevision: draft.value.baselineRevision };
  if (input.expectedBaselineRevision !== current.baselineRevision) return { status: "conflict", reason: "baseline-revision", current };
  const decision = authorizeContentMutation(options.policy, options.actor, input.request, draft.value.snapshot, options.now ? { now: options.now } : {});
  if (!decision.ok) return decision.code === "stale" ? { status: "conflict", reason: "draft-revision", current } : { status: "refused", refusal: decision };
  return adapter.apply({
    operationId: input.operationId,
    actor: decision.actor,
    mutation: decision.mutation,
    expectedDraftRevision: decision.request.expectedRevision,
    expectedBaselineRevision: input.expectedBaselineRevision,
    requestDigest,
  });
}

/** A receipt is only returned to the actor that wrote it. */
export async function readHostContentReceipt(adapter: ContentDraftStorageAdapter, operationId: string, actor: HostContentActor): Promise<ContentDraftReadResult<ContentOperationReceipt>> {
  if (!isHostContentOperationId(operationId)) return { status: "not-found" };
  const receipt = await adapter.readReceipt(operationId);
  if (receipt.status === "ok" && receipt.value.actor.subject !== actor.subject) return { status: "not-found" };
  return receipt;
}

export interface ContentEditorApplyInput {
  readonly operationId: string;
  readonly request: ContentMutationRequest;
  readonly expectedBaselineRevision: string;
}

/**
 * What the browser editor needs from the host. Every method may reject (a
 * transport failure); the editor treats a rejected `apply` as an uncertain
 * write and resolves it through `readReceipt` and an identical retry.
 */
export interface ContentEditorStorage {
  read(): Promise<ContentDraftReadResult<ContentDraftState>>;
  apply(input: ContentEditorApplyInput): Promise<HostContentApplyResult>;
  readReceipt(operationId: string): Promise<ContentDraftReadResult<ContentOperationReceipt>>;
  snapshot(input: { expectedDraftRevision: number }): Promise<ContentDraftMutationResult<ContentSnapshotRecord>>;
}

/** Binds the editor shape to an adapter in the same process, with the host's trusted policy and actor. */
export function createContentEditorStorage(adapter: ContentDraftStorageAdapter, options: HostContentServiceOptions): ContentEditorStorage {
  return {
    read: () => adapter.readDraft(),
    apply: (input) => applyHostContentRequest(adapter, input, options),
    readReceipt: (operationId) => readHostContentReceipt(adapter, operationId, options.actor),
    snapshot: (input) => adapter.snapshot(input),
  };
}
