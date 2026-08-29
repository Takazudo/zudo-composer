// The preview iframe's snapshot state + the REVISION GUARD.
//
// Pure, DOM-free, and Preact-free on purpose: revision ordering is the part of
// this feature most likely to break silently (a late `render` overtaking a
// newer one after a reload, a re-delivered message re-applying an old document),
// so it is a plain function that can be exhaustively tested without a renderer.
//
// The rule is one line: a message is applied only when its revision is STRICTLY
// greater than the revision currently on screen. The parent mints revisions
// monotonically (`bridge.ts`), so "greater" means "newer", and a stale snapshot
// can never win — including the replay the parent sends after the iframe
// reloads and re-announces `ready`.

import type { CompositionDocument } from "../../../composer";
import type {
  ModeMessage,
  PreviewLinkedSourceContext,
  PreviewSession,
  RenderMessage,
} from "./protocol";

/** Everything the preview draws from. */
export interface PreviewState {
  /** Revision of the newest applied message. `-1` = nothing applied yet. */
  revision: number;
  /** `null` until the first `render` arrives (a `mode` message may land first). */
  document: CompositionDocument | null;
  /** Consumer record identity for local owner-qualified runtime keys. */
  localRecordId: string | null;
  /** Resolved read-only source/outlet context, or `null` for a local/broken view. */
  linked: PreviewLinkedSourceContext | null;
  session: PreviewSession;
}

/**
 * The state a freshly (re)loaded preview document starts in. `revision: -1`
 * means it accepts the parent's very next message whatever its revision is —
 * which is exactly what makes the post-reload replay work.
 */
export const INITIAL_PREVIEW_STATE: PreviewState = {
  revision: -1,
  document: null,
  localRecordId: null,
  linked: null,
  session: { mode: "edit", theme: "light", selectedId: null },
};

/**
 * Fold a validated parent message into the current state.
 *
 * Returns `null` when the message is STALE (revision <= current) — the caller
 * must then drop it entirely, not merge any part of it.
 *
 * Typed to `RenderMessage | ModeMessage` ONLY — the two revision-gated
 * snapshot members — not the full `ParentToPreviewMessage` union. `#256`'s
 * `restore-focus` is a one-shot focus command with no `revision` and no
 * document/session payload, so it does not belong in this fold at all;
 * `client.ts`'s `onMessage` narrows it away (an early `if (type ===
 * "restore-focus")` branch) before ever calling this function, and that
 * narrowing is what keeps this signature honest instead of forcing a
 * meaningless case here.
 */
export function applyInbound(
  state: PreviewState,
  message: RenderMessage | ModeMessage,
): PreviewState | null {
  if (message.revision <= state.revision) return null;

  switch (message.type) {
    case "render":
      return {
        revision: message.revision,
        document: message.document,
        localRecordId: message.localRecordId ?? message.document.id,
        linked: message.linked ?? null,
        session: message.session,
      };
    case "mode":
      // Session-only — the document on screen is kept as-is.
      return {
        revision: message.revision,
        document: state.document,
        localRecordId: state.localRecordId,
        linked: state.linked,
        session: message.session,
      };
    default: {
      // Compile-time exhaustiveness over the NARROWED two-member type above.
      // Fails CLOSED — an unhandled type is dropped rather than mistaken for
      // a session update (which would bump the revision and make the next
      // legitimate snapshot look stale).
      const unhandled: never = message;
      void unhandled;
      return null;
    }
  }
}
