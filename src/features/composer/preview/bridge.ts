// PARENT-SIDE half of the Composer preview bridge: the exact iframe URL,
// the exact target origin, and an INSTANCE-SCOPED connection handle.
//
// ── Why instance-scoped, not a module singleton ──────────────────────────────
// The chooser mounts a second, ephemeral preview iframe for live per-entry
// preview, alive at the same time as the canvas preview. Every
// piece of connection state (readiness, the revision counter, the newest
// snapshot, the listener) therefore lives in a closure per `createComposerPreviewBridge`
// call. Two bridges never see each other's `ready`, and neither can be
// desynchronised by the other's revisions.
//
// ── Revision + replay contract ───────────────────────────────────────────────
// - Every outbound message mints the NEXT revision (strictly monotonic).
// - The newest snapshot is always retained. If the iframe is not ready yet, the
//   snapshot is held, not queued: a second `render()` REPLACES the first, so an
//   older document can never be delivered after a newer one.
// - On `ready` (first load, a late load, or a RELOAD) the bridge replays ONLY
//   the retained newest snapshot, at a FRESH revision.
//
//   The fresh revision is load-bearing, not cosmetic. A reload does not reset
//   `ready` on this side (the bridge cannot observe the navigation), so between
//   the reload and the new `ready` the parent may still post — e.g. a theme
//   toggle sends a document-less `mode` message, which the freshly booted iframe
//   accepts and which advances ITS revision to the retained one. Replaying at
//   the retained (now equal) revision would then be rejected as stale by the
//   iframe's `revision > current` guard, and the preview would sit blank
//   forever. Minting a new revision for the replay makes it strictly newer than
//   anything the iframe can already have seen.
//
// ── Origin contract ──────────────────────────────────────────────────────────
// `targetOrigin` is DERIVED from the resolved iframe URL and used verbatim on
// every `postMessage`. It is never `"*"`. Inbound messages must come from the
// iframe's own `contentWindow` AND carry that same origin (the preview is
// same-origin by construction).

import type { InsertionTarget } from "../headless-api";
import { COMPOSER_PREVIEW_IFRAME_TITLE, COMPOSER_PREVIEW_ROUTE_PATH } from "./route";
import type {
  GuardFailure,
  MessageEventLike,
  MessagePoster,
  MessageTarget,
  PreviewSession,
  PreviewPackIdentity,
  SerializedRect,
} from "./protocol";
import {
  modeMessage,
  readPreviewToParent,
  renderMessage,
  restoreFocusMessage,
  type ComposerPreviewSnapshot,
} from "./protocol";

// ── URL + iframe seam ───────────────────────────────────────────────────────

/** The resolved preview iframe location: what to load, and who to talk to. */
export interface ComposerPreviewLocation {
  /** Exact pathname for the iframe's `src`. */
  src: string;
  /** EXACT origin for every `postMessage`. Derived from `src`. Never `"*"`. */
  targetOrigin: string;
}

/**
 * Build the preview iframe's URL and its exact target origin.
 *
 * The standalone app has one canonical preview path. The origin is read from
 * its resolved URL so every `postMessage` still uses an exact target origin.
 *
 * @param documentOrigin origin of the hosting document; defaults to
 *   `location.origin`. Explicit so the helper is testable and so a caller in a
 *   non-browser context fails loudly instead of silently posting to `"*"`.
 */
export function buildComposerPreviewUrl(documentOrigin?: string): ComposerPreviewLocation {
  const origin = documentOrigin ?? globalThis.location?.origin;
  if (!origin) {
    throw new Error(
      "buildComposerPreviewUrl: no document origin — pass one explicitly outside a browser.",
    );
  }
  const resolved = new URL(COMPOSER_PREVIEW_ROUTE_PATH, origin);
  return { src: resolved.pathname, targetOrigin: resolved.origin };
}

/** The iframe attributes the HOST seam (Takazudo/zudo-sg#247 shell / Takazudo/zudo-sg#251 canvas) must apply. */
export interface ComposerPreviewFrameProps {
  src: string;
  /** Accessible name — an iframe without one is an unlabelled landmark. */
  title: string;
  /** Same-origin so the parent can address `contentWindow`; scripts for Preact. */
  sandbox: string;
}

/**
 * The iframe props for a resolved preview location. Exported so the mount site
 * cannot forget the accessible title or widen the sandbox.
 */
export function composerPreviewFrameProps(
  location: ComposerPreviewLocation,
  title: string = COMPOSER_PREVIEW_IFRAME_TITLE,
): ComposerPreviewFrameProps {
  return { src: location.src, title, sandbox: "allow-same-origin allow-scripts" };
}

// ── Connection ──────────────────────────────────────────────────────────────

/** Structural stand-in for `HTMLIFrameElement` (real ones are assignable). */
export interface PreviewFrameLike {
  readonly contentWindow: MessagePoster | null;
}

export interface ComposerPreviewBridgeOptions {
  /** The iframe. Its `contentWindow` is BOTH the post target and the only source trusted. */
  frame: PreviewFrameLike;
  /**
   * The resolved location from `buildComposerPreviewUrl()`. Taken whole rather
   * than as a loose `targetOrigin` string, so the origin the bridge posts to is
   * always the one the iframe's `src` actually resolved to — they cannot drift.
   */
  location: ComposerPreviewLocation;
  /** Window hosting the `message` listener — normally the parent `window`. */
  hostWindow: MessageTarget;
  /** Exact component pack this parent expects the iframe to run. */
  pack: PreviewPackIdentity;
  /** Origin every inbound message must carry. Defaults to the location's origin. */
  expectedOrigin?: string;

  onReady?: () => void;
  onSelect?: (nodeId: string | null, revision: number) => void;
  onRequestAdd?: (target: InsertionTarget, revision: number) => void;
  /** Linked-source navigation request; source nodes never route through local selection. */
  onOpenSource?: (sourceRecordId: string) => void;
  /** The selected node's chrome "⋯" was activated inside the iframe (issue Takazudo/zudo-sg#256). */
  onRequestNodeMenu?: (nodeId: string, rect: SerializedRect, focusToken: string, revision: number) => void;
  /** An insert point's "⋯" was activated inside the iframe (issue Takazudo/zudo-sg#256). */
  onRequestInsertMenu?: (target: InsertionTarget, rect: SerializedRect, focusToken: string, revision: number) => void;
  /**
   * An inline-editing session committed a value (issue Takazudo/zudo-sg#257). `documentRevision`
   * is the revision the preview was showing at commit time — the host validates
   * it against the newest DOCUMENT snapshot it sent before routing the value
   * through `updateProps`, dropping a stale edit rather than applying it.
   */
  onCommitInlineEdit?: (nodeId: string, fieldKey: string, value: string, documentRevision: number) => void;
  /**
   * A cross-slot drag & drop completed inside the iframe (issue Takazudo/zudo-sg#258). `copy` is
   * true when Alt was held at drop. `documentRevision` is the revision the
   * preview was showing at drop time — the host validates it against the newest
   * DOCUMENT snapshot it sent before applying the move/copy through the
   * controller, dropping a stale drop rather than applying it.
   */
  onDropNode?: (sourceNodeId: string, target: InsertionTarget, copy: boolean, documentRevision: number) => void;
  onError?: (message: string, recoverable: boolean, revision: number | null) => void;
  /** A message that failed source/origin/schema validation was DROPPED. */
  onRejected?: (reason: GuardFailure, detail?: string) => void;
}

export interface ComposerPreviewBridge {
  /** Send (or retain, if not ready) a full snapshot. Returns its revision. */
  render(snapshot: ComposerPreviewSnapshot, session: PreviewSession): number;
  /** Send (or retain) a session-only change. Returns its revision. */
  updateSession(session: PreviewSession): number;
  /**
   * Answer a `request-node-menu` / `request-insert-menu` once its menu has
   * closed: echoes the `focusToken` back so the iframe can restore focus to
   * the exact control that opened it (issue Takazudo/zudo-sg#256). Not revision-gated — a
   * no-op (silently dropped by the iframe's own guard) if not yet ready.
   */
  restoreFocus(focusToken: string): void;
  /** True once the iframe has announced `ready` at least once. */
  readonly ready: boolean;
  /** A trusted peer announced a different pack; this bridge can never revive. */
  readonly terminal: boolean;
  /** Revision of the retained newest snapshot (`-1` before the first send). */
  readonly revision: number;
  dispose(): void;
}

interface Retained {
  snapshot: ComposerPreviewSnapshot | null;
  session: PreviewSession;
  revision: number;
}

export function createComposerPreviewBridge(
  options: ComposerPreviewBridgeOptions,
): ComposerPreviewBridge {
  const { frame, location, hostWindow, pack } = options;
  const { targetOrigin } = location;
  const expectedOrigin = options.expectedOrigin ?? targetOrigin;

  // ── per-instance state ────────────────────────────────────────────────────
  let ready = false;
  let revisionCounter = -1;
  let retained: Retained | null = null;
  let disposed = false;
  let terminal = false;

  const nextRevision = (): number => ++revisionCounter;

  const post = (message: unknown): void => {
    // `contentWindow` is read at send time, not captured: it is null before the
    // iframe attaches, and it is the window a reload replaces the contents of.
    if (!terminal) frame.contentWindow?.postMessage(message, targetOrigin);
  };

  /** Send the retained snapshot. Always at its CURRENT revision. */
  const send = (): void => {
    if (!ready || !retained) return;
    post(
      retained.snapshot
        ? renderMessage(pack, retained.revision, retained.snapshot, retained.session)
        : modeMessage(pack, retained.revision, retained.session),
    );
  };

  /**
   * Answer a `ready`: replay ONLY the newest snapshot, at a FRESH revision so it
   * is strictly newer than anything the (possibly reloaded) iframe already
   * applied. See the revision/replay contract in the module header.
   */
  const replay = (): void => {
    if (!retained) return;
    retained = { ...retained, revision: nextRevision() };
    send();
  };

  const onMessage = (event: MessageEventLike): void => {
    if (disposed || terminal) return;
    const result = readPreviewToParent(event, {
      source: frame.contentWindow,
      origin: expectedOrigin,
      pack,
    });
    if (!result.ok) {
      if (result.reason === "pack-mismatch") {
        terminal = true;
        ready = false;
        retained = null;
      }
      options.onRejected?.(result.reason, result.detail);
      return;
    }
    const message = result.message;
    switch (message.type) {
      case "ready":
        ready = true;
        options.onReady?.();
        replay();
        return;
      case "select":
        options.onSelect?.(message.nodeId, message.revision);
        return;
      case "request-add":
        options.onRequestAdd?.(message.target, message.revision);
        return;
      case "open-source":
        options.onOpenSource?.(message.sourceRecordId);
        return;
      case "request-node-menu":
        options.onRequestNodeMenu?.(message.nodeId, message.rect, message.focusToken, message.revision);
        return;
      case "request-insert-menu":
        options.onRequestInsertMenu?.(message.target, message.rect, message.focusToken, message.revision);
        return;
      case "commit-inline-edit":
        options.onCommitInlineEdit?.(message.nodeId, message.fieldKey, message.value, message.documentRevision);
        return;
      case "drop-node":
        options.onDropNode?.(message.sourceNodeId, message.target, message.copy, message.documentRevision);
        return;
      case "error":
        options.onError?.(message.message, message.recoverable, message.revision);
        return;
      default: {
        // Compile-time exhaustiveness: appending a member to
        // PREVIEW_TO_PARENT_MEMBERS without adding a case here is a
        // TYPE ERROR, not a silently dropped message. At runtime this is
        // unreachable — zod already rejected anything not in the union.
        const unhandled: never = message;
        options.onRejected?.(
          "invalid-payload",
          `unhandled message type: ${String((unhandled as { type?: unknown }).type)}`,
        );
        return;
      }
    }
  };

  hostWindow.addEventListener("message", onMessage);

  return {
    render(snapshot, session) {
      if (terminal) return -1;
      retained = {
        snapshot,
        session,
        revision: nextRevision(),
      };
      send();
      return retained.revision;
    },
    updateSession(session) {
      if (terminal) return -1;
      retained = {
        snapshot: retained?.snapshot ?? null,
        session,
        revision: nextRevision(),
      };
      // Session-only: no need to resend the document to a live iframe. If the
      // iframe is mid-reload this post is lost — the `ready` replay covers it.
      if (ready) post(modeMessage(pack, retained.revision, session));
      return retained.revision;
    },
    restoreFocus(focusToken) {
      // Not retained/replayed: a menu can only have been requested by an
      // iframe that already announced `ready`, and if it reloads mid-menu the
      // control the token pointed at is gone anyway — nothing to replay.
      if (ready) post(restoreFocusMessage(pack, focusToken));
    },
    get ready() {
      return ready;
    },
    get terminal() {
      return terminal;
    },
    get revision() {
      return retained?.revision ?? -1;
    },
    dispose() {
      disposed = true;
      hostWindow.removeEventListener("message", onMessage);
    },
  };
}
