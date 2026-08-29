"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The parent-side canvas: the preview `<iframe>` host + its bridge lifecycle
// (issue #251). This is the ONE place #248's secure bridge is driven for the
// main canvas — instance-scoped, so wave 6 (#254) can mount a SECOND host for
// the chooser's live per-entry preview without any shared singleton.
//
// Lifecycle contract (all delegated to #248's `createComposerPreviewBridge`):
//   - build the base-aware URL + exact origin once; spread the sandboxed,
//     titled iframe props;
//   - the bridge retains the newest snapshot and, on ready/late-ready/reload,
//     replays it at a fresh revision — so the effect below only has to send the
//     current snapshot whenever it changes;
//   - a DOCUMENT change is a full `render`; a session-only change
//     (mode/theme/selection) is a lighter `updateSession`. One document
//     snapshot drives the preview — there is no second source mapping.
//
// Inbound: a canvas node click arrives as `select` (Edit mode only — the
// renderer never selects in Preview); an insert point arrives as `request-add`
// carrying #245's index-bearing `InsertionTarget`. Before opening the shared
// chooser we FOCUS the iframe, so it is captured as the chooser's trigger and
// focus returns to it on close (issue #251 scope item 3). Recoverable renderer
// errors surface as a dismissible banner above the canvas.
//
// ── Menu relay (issue #256) ──────────────────────────────────────────────────
// `request-node-menu` / `request-insert-menu` carry a rect in the IFRAME's
// own coordinates plus an opaque `focusToken`. This is the ONE place that
// TRANSLATES that rect by the iframe element's own offset within this host
// document (`frame.getBoundingClientRect()`) before handing it to
// `onRequestNodeMenu`/`onRequestInsertMenu` — viewport CLAMPING itself is left
// to `ComposerMenu` (one clamp implementation, shared by every menu origin;
// see that component's header). The `restoreFocus` thunk each callback also
// receives closes the loop: it posts a `restore-focus` response carrying the
// SAME `focusToken` back over the bridge, which the iframe uses to refocus
// its own control — the host never reaches into the iframe's DOM directly.
//
// "Add component…" (selected from a canvas-relayed insert menu) does NOT use
// that generic restore — it reuses the EXISTING `onRequestAdd` focus sequence
// (focus the iframe first, so the shared chooser captures IT as the trigger)
// via the `addComponent` thunk passed to `onRequestInsertMenu`.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { CompositionDocument, InsertionTarget } from "../../../composer/browser";
import type { ComposerCanvasViewport } from "../chrome/controller-model";
import type { ComposerComponentProvider } from "../active-pack";
import {
  buildComposerPreviewUrl,
  composerPreviewFrameProps,
  createComposerPreviewBridge,
  localPreviewSnapshot,
  type ComposerPreviewBridge,
  type ComposerPreviewLocation,
  type ComposerPreviewSnapshot,
  type MessageTarget,
  type PreviewSession,
  type SerializedRect,
} from "../preview";
import { COMPOSER_VIEWPORT_WIDTHS } from "./viewport";

/** Translate an iframe-local rect into HOST viewport coordinates (issue #256). */
function translateRect(rect: SerializedRect, frame: HTMLIFrameElement | null): SerializedRect {
  const frameBox = frame?.getBoundingClientRect();
  return {
    x: rect.x + (frameBox?.left ?? 0),
    y: rect.y + (frameBox?.top ?? 0),
    width: rect.width,
    height: rect.height,
  };
}

export interface ComposerCanvasHostProps {
  componentProvider: ComposerComponentProvider;
  document: CompositionDocument;
  /** Separate render-only linked source context; the controller remains local. */
  snapshot?: ComposerPreviewSnapshot;
  session: PreviewSession;
  viewport: ComposerCanvasViewport;
  /** A canvas node (or the empty canvas, `null`) was selected in Edit mode. */
  onSelect: (nodeId: string | null) => void;
  /** An insert point was activated — carries #245's index-bearing target. */
  onRequestAdd: (target: InsertionTarget) => void;
  /** Explicit navigation for the linked source affordance. */
  onOpenSource?: (sourceRecordId: string) => void;
  /** The selected node's chrome "⋯" was activated — rect already translated to host coordinates (issue #256). */
  onRequestNodeMenu: (nodeId: string, rect: SerializedRect, restoreFocus: () => void) => void;
  /** An insert point's "⋯" was activated — rect already translated to host coordinates (issue #256). */
  onRequestInsertMenu: (
    target: InsertionTarget,
    rect: SerializedRect,
    restoreFocus: () => void,
    addComponent: () => void,
  ) => void;
  /**
   * A canvas inline edit committed and PASSED the revision check (issue #257).
   * The host has already dropped any stale edit, so this only ever fires for a
   * fresh one — route it straight through `updateProps` (the one mutation path).
   */
  onCommitInlineEdit: (nodeId: string, fieldKey: string, value: string) => void;
  /**
   * A canvas drag & drop completed and PASSED the revision check (issue #258).
   * The host has already dropped any stale drop, so this only fires for a fresh
   * one — route it through the controller's `drop` action (the one mutation
   * path), which atomically revalidates and applies the move/copy.
   */
  onDropNode: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;

  // ── Test seams (production defaults) ──────────────────────────────────────
  /** Override the bridge factory. Defaults to #248's real bridge. */
  createBridge?: typeof createComposerPreviewBridge;
  /** Override the resolved iframe location. Defaults to the base-aware URL. */
  location?: ComposerPreviewLocation;
  /** Override the window hosting the `message` listener. Defaults to `window`. */
  hostWindow?: MessageTarget;
}

export function ComposerCanvasHost(props: ComposerCanvasHostProps): JSX.Element {
  const {
    document: doc,
    componentProvider,
    snapshot: snapshotProp,
    session,
    viewport,
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
    createBridge = createComposerPreviewBridge,
    location: locationProp,
    hostWindow,
  } = props;

  const snapshot = useMemo(
    () => snapshotProp ?? localPreviewSnapshot(doc, doc.id),
    [doc, snapshotProp],
  );

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<ComposerPreviewBridge | null>(null);
  const prevSnapshotRef = useRef<ComposerPreviewSnapshot | null>(null);
  // Revision of the newest DOCUMENT snapshot sent (updated on `render`, NOT on a
  // session-only `updateSession`). An inline-edit commit stamped BELOW this was
  // authored against a document the host has since superseded → stale → dropped.
  const lastDocRevisionRef = useRef(-1);
  // The bridge is created ONCE; its callbacks read the latest props through
  // this ref so a controller state change never needs to re-create the bridge
  // (which would drop readiness and re-add a listener).
  const handlersRef = useRef({
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
  });
  handlersRef.current = {
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
  };

  const [renderError, setRenderError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [, setReady] = useState(false);

  const location = useMemo(
    () => locationProp ?? buildComposerPreviewUrl(),
    [locationProp],
  );
  const frameProps = useMemo(() => composerPreviewFrameProps(location), [location]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const bridge = createBridge({
      frame,
      location,
      hostWindow: hostWindow ?? window,
      pack: {
        packId: componentProvider.manifest.packId,
        packVersion: componentProvider.manifest.packVersion,
      },
      onReady: () => setReady(true),
      onSelect: (nodeId) => handlersRef.current.onSelect(nodeId),
      onRequestAdd: (target) => {
        // Focus the iframe BEFORE the chooser opens so it becomes the chooser's
        // captured trigger — focus then returns here on close.
        frameRef.current?.focus();
        handlersRef.current.onRequestAdd(target);
      },
      onOpenSource: (sourceRecordId) => handlersRef.current.onOpenSource?.(sourceRecordId),
      onRequestNodeMenu: (nodeId, rect, focusToken) => {
        handlersRef.current.onRequestNodeMenu(nodeId, translateRect(rect, frameRef.current), () =>
          bridgeRef.current?.restoreFocus(focusToken),
        );
      },
      onRequestInsertMenu: (target, rect, focusToken) => {
        handlersRef.current.onRequestInsertMenu(
          target,
          translateRect(rect, frameRef.current),
          () => bridgeRef.current?.restoreFocus(focusToken),
          () => {
            // Same focus sequence as a direct request-add: focus the iframe
            // FIRST so the shared chooser captures it as its trigger.
            frameRef.current?.focus();
            handlersRef.current.onRequestAdd(target);
          },
        );
      },
      onCommitInlineEdit: (nodeId, fieldKey, value, documentRevision) => {
        // The host VALIDATES the revision here (issue #257): a commit authored
        // against a document snapshot the host has already superseded is
        // DROPPED with an honest status, never silently applied. Only a fresh
        // commit reaches `updateProps` — the single mutation path.
        if (documentRevision < lastDocRevisionRef.current) {
          setStaleNotice(
            "Your inline edit was not applied — the canvas changed while you were typing. Please try again.",
          );
          return;
        }
        setStaleNotice(null);
        handlersRef.current.onCommitInlineEdit(nodeId, fieldKey, value);
      },
      onDropNode: (sourceNodeId, target, copy, documentRevision) => {
        // Same revision gate as an inline-edit commit (issue #258): a drop
        // authored against a document snapshot the host has already superseded
        // is DROPPED with an honest status. The controller then does the ATOMIC
        // model revalidation (slot/cardinality/cycle/root/opaque-policy) — this
        // is only the stale-revision half of "host revalidates before applying".
        if (documentRevision < lastDocRevisionRef.current) {
          setStaleNotice(
            "Your drag was not applied — the canvas changed while you were dragging. Please try again.",
          );
          return;
        }
        setStaleNotice(null);
        handlersRef.current.onDropNode(sourceNodeId, target, copy);
      },
      onError: (message, recoverable) => {
        if (recoverable) setRenderError(message);
      },
      onRejected: (reason, detail) => {
        if (reason === "pack-mismatch") {
          setFatalError(`Component pack mismatch. ${detail ?? "The host and preview loaded different packs."}`);
        }
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
    // Production: these are all stable. If a test swaps the factory/location the
    // snapshot effect below re-sends on the next document/session change.
  }, [componentProvider.manifest.packId, componentProvider.manifest.packVersion, createBridge, location, hostWindow]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    if (prevSnapshotRef.current !== snapshot) {
      prevSnapshotRef.current = snapshot;
      setRenderError(null);
      // A fresh document clears any stale-edit notice and advances the revision
      // an inline commit is validated against.
      setStaleNotice(null);
      lastDocRevisionRef.current = bridge.render(snapshot, session);
    } else {
      bridge.updateSession(session);
    }
  }, [session, snapshot]);

  const width = COMPOSER_VIEWPORT_WIDTHS[viewport];
  const frameStyle = width === null ? undefined : { width: `${width}px`, maxWidth: "100%" };

  return (
    <div class="sg-composer-canvas-host" data-sg-viewport={viewport}>
      {fatalError !== null && (
        <div class="sg-composer-canvas-error" role="alert" data-composer-preview-fatal="pack-mismatch">
          <span>Preview cannot start: {fatalError}</span>
        </div>
      )}
      {renderError !== null && (
        <div class="sg-composer-canvas-error" role="status">
          <span>Preview error: {renderError}</span>
          <button
            type="button"
            class="sg-composer-toolbar-button"
            onClick={() => setRenderError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {staleNotice !== null && (
        <div class="sg-composer-canvas-error" role="status">
          <span>{staleNotice}</span>
          <button
            type="button"
            class="sg-composer-toolbar-button"
            onClick={() => setStaleNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <div class="sg-composer-canvas-frame" style={frameStyle}>
        <iframe ref={frameRef} class="sg-composer-preview-iframe" {...frameProps} />
      </div>
    </div>
  );
}
