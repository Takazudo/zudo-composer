// A local, self-contained test harness for driving the REAL #248 preview
// bridge from a chooser test without a live iframe — a recording frame
// (captures posts) + a deliverable host window (injects inbound messages).
//
// Deliberately NOT imported from `app/test-support/preview-harness.ts`: this
// issue (#254) owns only `ui/chooser/**`, and a sibling wave is concurrently
// working in `app/**` — staying self-contained here avoids any cross-worktree
// coupling. The shape mirrors that harness (and `preview/__tests__/bridge.test.ts`'s
// own fakes) closely on purpose, so the pattern reads the same everywhere.

import {
  COMPOSER_PREVIEW_CHANNEL,
  COMPOSER_PREVIEW_PACK_ID,
  COMPOSER_PREVIEW_PACK_VERSION,
  COMPOSER_PREVIEW_PROTOCOL_VERSION,
  createComposerPreviewBridge,
  type ComposerPreviewLocation,
  type MessageEventLike,
  type MessageTarget,
  type PreviewFrameLike,
} from "../../../preview";

export interface RecordingFrame {
  frame: PreviewFrameLike;
  contentWindow: unknown;
  posts: { message: unknown; targetOrigin: string }[];
}

/** An iframe stand-in whose contentWindow records every post + its origin. */
export function recordingFrame(): RecordingFrame {
  const posts: { message: unknown; targetOrigin: string }[] = [];
  const contentWindow = {
    postMessage: (message: unknown, targetOrigin: string) => {
      posts.push({ message, targetOrigin });
    },
  };
  return { frame: { contentWindow }, contentWindow, posts };
}

export interface DeliverableHost extends MessageTarget {
  deliver(event: MessageEventLike): void;
}

/** A host window with real listener plumbing and a manual `deliver`. */
export function deliverableHost(): DeliverableHost {
  const listeners = new Set<(event: MessageEventLike) => void>();
  return {
    addEventListener: (_type, listener) => void listeners.add(listener as (e: MessageEventLike) => void),
    removeEventListener: (_type, listener) =>
      void listeners.delete(listener as (e: MessageEventLike) => void),
    deliver: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** The bare `ready` envelope — the only inbound message the (non-interactive) chooser preview reacts to. */
export function chooserPreviewReadyPayload(): unknown {
  return {
    channel: COMPOSER_PREVIEW_CHANNEL,
    v: COMPOSER_PREVIEW_PROTOCOL_VERSION,
    packId: COMPOSER_PREVIEW_PACK_ID,
    packVersion: COMPOSER_PREVIEW_PACK_VERSION,
    type: "ready",
  };
}

export interface ChooserPreviewBridgeHarness {
  /** Drop-in for `ChooserPreviewHost`'s `createBridge` prop — wraps the real bridge. */
  createBridge: typeof createComposerPreviewBridge;
  location: ComposerPreviewLocation;
  /** Everything the (fake) preview iframe was posted, newest last. */
  posts: { message: unknown; targetOrigin: string }[];
  /** Deliver the `ready` handshake, so the bridge starts replaying/sending. */
  deliverReady(): void;
}

/**
 * Builds a harness whose `createBridge` runs the genuine #248 bridge against a
 * recording frame + deliverable host instead of a live iframe. Pass
 * `harness.createBridge` / `harness.location` as `ChooserPreviewHost`'s test
 * seams.
 */
export function makeChooserPreviewBridgeHarness(
  // `about:blank` keeps happy-dom from trying to FETCH the preview route (the
  // bridge talks to the recording frame, not this element); the origin is
  // still an exact, non-wildcard value delivered messages must match.
  location: ComposerPreviewLocation = { src: "about:blank", targetOrigin: "https://chooser-preview.test" },
): ChooserPreviewBridgeHarness {
  const frame = recordingFrame();
  const host = deliverableHost();

  const createBridge: typeof createComposerPreviewBridge = (options) =>
    createComposerPreviewBridge({ ...options, frame: frame.frame, hostWindow: host });

  return {
    createBridge,
    location,
    posts: frame.posts,
    deliverReady: () =>
      host.deliver({
        data: chooserPreviewReadyPayload(),
        origin: location.targetOrigin,
        source: frame.contentWindow,
      }),
  };
}
