// Test harness for driving the REAL #248 preview bridge from an integration
// test without a live iframe: a recording frame (captures posts) + a
// deliverable host window (injects inbound messages). Mirrors the fakes in
// `preview/__tests__/bridge.test.ts`, but packaged so the central integration
// (#251) can wire the genuine `createComposerPreviewBridge` — proving ready/
// reload replay, stale-event handling, and inbound routing end-to-end through
// the canvas host, not against a mock bridge.

import {
  createComposerPreviewBridge,
  type ComposerPreviewLocation,
  type MessageEventLike,
  type MessageTarget,
  type PreviewFrameLike,
} from "../../preview";

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

export interface TestBridgeHarness {
  /** Drop-in for the `createBridge` prop — wraps the real bridge. */
  createBridge: typeof createComposerPreviewBridge;
  location: ComposerPreviewLocation;
  /** Everything the (fake) iframe was posted, newest last. */
  posts: { message: unknown; targetOrigin: string }[];
  /** The window value inbound messages must claim as their `source`. */
  source: unknown;
  /** Inject an inbound message (already origin/source-stamped for you if omitted). */
  deliver(data: unknown, over?: { origin?: string; source?: unknown }): void;
}

/**
 * Build a harness whose `createBridge` runs the genuine #248 bridge but talks to
 * a recording frame + deliverable host instead of a live iframe. Pass
 * `harness.createBridge` and `harness.location` to the canvas host / integration.
 */
export function makeTestBridge(
  // `about:blank` src keeps happy-dom from trying to FETCH the preview route
  // (the bridge talks to the recording frame, not this element); the origin is
  // still an exact, non-wildcard value the delivered messages must match.
  location: ComposerPreviewLocation = { src: "about:blank", targetOrigin: "https://composer.test" },
): TestBridgeHarness {
  const frame = recordingFrame();
  const host = deliverableHost();

  const createBridge: typeof createComposerPreviewBridge = (options) =>
    createComposerPreviewBridge({ ...options, frame: frame.frame, hostWindow: host });

  return {
    createBridge,
    location,
    posts: frame.posts,
    source: frame.contentWindow,
    deliver: (data, over) =>
      host.deliver({
        data,
        origin: over?.origin ?? location.targetOrigin,
        source: over && "source" in over ? over.source : frame.contentWindow,
      }),
  };
}
