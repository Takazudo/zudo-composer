// IFRAME-SIDE half of the Composer preview bridge.
//
// Mirrors `bridge.ts`: same guard, same exact-origin posting, same revision
// rule — but from inside the preview document. Kept out of the Preact island so
// the listener, the revision guard, and the emitters can be tested against
// plain fake windows with no DOM and no component tree.
//
// Trust: the ONLY window it accepts messages from is `window.parent`, and the
// origin must equal this document's own origin (the preview is same-origin with
// `/composer`). Everything else is dropped. `event.data` is never touched
// before the schema validates it.

import type { InsertionTarget } from "../headless-api";
import type {
  GuardFailure,
  MessageEventLike,
  MessagePoster,
  MessageTarget,
  PreviewPackIdentity,
  SerializedRect,
} from "./protocol";
import {
  commitInlineEditMessage,
  dropNodeMessage,
  errorMessage,
  openSourceMessage,
  readParentToPreview,
  readyMessage,
  requestAddMessage,
  requestInsertMenuMessage,
  requestNodeMenuMessage,
  selectMessage,
} from "./protocol";
import { INITIAL_PREVIEW_STATE, applyInbound, type PreviewState } from "./snapshot-store";

export interface PreviewClientOptions {
  /** Window hosting the `message` listener — the iframe's own `window`. */
  hostWindow: MessageTarget;
  /** Where outbound messages go — the parent window. */
  parentWindow: MessagePoster;
  /** The ONLY trusted `event.source`. Normally the same object as `parentWindow`. */
  expectedSource: unknown;
  /** Inbound `event.origin` must equal this — this document's own origin. */
  expectedOrigin: string;
  /** Exact origin for outbound posts. Never `"*"`. */
  targetOrigin: string;
  /** Exact component pack imported by this iframe. */
  pack: PreviewPackIdentity;
  /** A newer snapshot was applied. Stale messages never reach this. */
  onState: (state: PreviewState) => void;
  /**
   * The host answered a `request-node-menu` / `request-insert-menu` with a
   * `restore-focus` (issue Takazudo/zudo-sg#256). NOT revision-gated and never touches
   * `PreviewState` — see `snapshot-store.ts`'s `applyInbound` comment.
   */
  onRestoreFocus?: (focusToken: string) => void;
  /** A message was DROPPED by the guard. */
  onRejected?: (reason: GuardFailure, detail?: string) => void;
}

export interface PreviewClient {
  /** Announce readiness. Called on every load — including after a reload. */
  emitReady(): void;
  emitSelect(nodeId: string | null): void;
  emitRequestAdd(target: InsertionTarget): void;
  /** Navigate to the linked source; this never selects or mutates source nodes. */
  emitOpenSource(sourceRecordId: string): void;
  /** The selected node's chrome "⋯" was activated (issue Takazudo/zudo-sg#256). */
  emitRequestNodeMenu(nodeId: string, rect: SerializedRect, focusToken: string): void;
  /** An insert point's "⋯" was activated (issue Takazudo/zudo-sg#256). */
  emitRequestInsertMenu(target: InsertionTarget, rect: SerializedRect, focusToken: string): void;
  /**
   * An inline-editing session committed a new value (issue Takazudo/zudo-sg#257). `documentRevision`
   * is supplied by the CALLER, not computed here (issue Takazudo/zudo-sg#288): the renderer
   * captures its inline session's SESSION-START revision and threads it down
   * through `preview-app.ts`, so the host can drop a commit authored during a
   * session a later render has since superseded — reading `state.revision` at
   * commit time here (like `emitSelect`/`emitRequestAdd` do for their own,
   * one-shot, non-session actions) would always look "fresh", defeating the
   * gate entirely.
   */
  emitCommitInlineEdit(nodeId: string, fieldKey: string, value: string, documentRevision: number): void;
  /**
   * A cross-slot drag & drop committed (issue Takazudo/zudo-sg#258). Stamped with the revision
   * on screen (`documentRevision`) so the host can drop a stale drop — exactly
   * like `emitCommitInlineEdit` stamps its own.
   */
  emitDropNode(sourceNodeId: string, target: InsertionTarget, copy: boolean): void;
  emitError(message: string, recoverable?: boolean): void;
  /** The newest applied state. */
  readonly state: PreviewState;
  readonly terminal: boolean;
  dispose(): void;
}

export function createPreviewClient(options: PreviewClientOptions): PreviewClient {
  const { hostWindow, parentWindow, expectedSource, expectedOrigin, targetOrigin, pack } = options;

  let state: PreviewState = INITIAL_PREVIEW_STATE;
  let disposed = false;
  let terminal = false;

  const post = (message: unknown): void => {
    if (!terminal) parentWindow.postMessage(message, targetOrigin);
  };

  /**
   * Revision to stamp on an outbound message. Before the first snapshot lands
   * there is no canvas to interact with, so this only guards against a rogue
   * caller producing a schema-invalid negative revision.
   */
  const outboundRevision = (): number => Math.max(0, state.revision);

  const onMessage = (event: MessageEventLike): void => {
    if (disposed || terminal) return;
    const result = readParentToPreview(event, {
      source: expectedSource,
      origin: expectedOrigin,
      pack,
    });
    if (!result.ok) {
      if (result.reason === "pack-mismatch") {
        terminal = true;
        state = INITIAL_PREVIEW_STATE;
      }
      options.onRejected?.(result.reason, result.detail);
      return;
    }
    const message = result.message;
    // `restore-focus` (Takazudo/zudo-sg#256) is not a document/session snapshot — it never
    // reaches the revision-gated fold below. See `applyInbound`'s comment.
    if (message.type === "restore-focus") {
      options.onRestoreFocus?.(message.focusToken);
      return;
    }
    const next = applyInbound(state, message);
    if (!next) return; // stale revision — drop it whole
    state = next;
    options.onState(next);
  };

  hostWindow.addEventListener("message", onMessage);

  return {
    emitReady() {
      post(readyMessage(pack));
    },
    emitSelect(nodeId) {
      post(selectMessage(pack, outboundRevision(), nodeId));
    },
    emitRequestAdd(target) {
      post(requestAddMessage(pack, outboundRevision(), target));
    },
    emitOpenSource(sourceRecordId) {
      post(openSourceMessage(pack, sourceRecordId));
    },
    emitRequestNodeMenu(nodeId, rect, focusToken) {
      post(requestNodeMenuMessage(pack, outboundRevision(), nodeId, rect, focusToken));
    },
    emitRequestInsertMenu(target, rect, focusToken) {
      post(requestInsertMenuMessage(pack, outboundRevision(), target, rect, focusToken));
    },
    emitCommitInlineEdit(nodeId, fieldKey, value, documentRevision) {
      // `Math.max(0, ...)` mirrors `outboundRevision()`'s own guard — defence
      // against a rogue caller producing a schema-invalid negative revision.
      post(commitInlineEditMessage(pack, nodeId, fieldKey, value, Math.max(0, documentRevision)));
    },
    emitDropNode(sourceNodeId, target, copy) {
      post(dropNodeMessage(pack, sourceNodeId, target, copy, outboundRevision()));
    },
    emitError(message, recoverable = true) {
      post(errorMessage(pack, state.revision < 0 ? null : state.revision, message, recoverable));
    },
    get state() {
      return state;
    },
    get terminal() {
      return terminal;
    },
    dispose() {
      disposed = true;
      hostWindow.removeEventListener("message", onMessage);
    },
  };
}
