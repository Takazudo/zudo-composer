"use client";

// The parent-side canvas: the preview `<iframe>` host + its bridge lifecycle
// This is the one place the secure bridge is driven for the main canvas —
// instance-scoped so the chooser can mount a second host for
// the chooser's live per-entry preview without any shared singleton.
//
// Lifecycle contract (all delegated to Takazudo/zudo-sg#248's `createComposerPreviewBridge`):
//   - build the canonical URL + exact origin once; spread the sandboxed,
//     titled iframe props;
//   - the bridge retains the newest snapshot and, on ready/late-ready/reload,
//     replays it at a fresh revision — so the effect below only has to send the
//     current snapshot whenever its identity changes;
//   - a DOCUMENT change is a full `render`; a session-only change
//     (mode/theme/selection) is a lighter `updateSession`. One document
//     snapshot drives the preview — there is no second source mapping.
//
// Inbound: a canvas node click arrives as `select` (Edit mode only — the
// renderer never selects in Preview); an insert point arrives as `request-add`
// carrying Takazudo/zudo-sg#245's index-bearing `InsertionTarget`. Before opening the shared
// chooser we FOCUS the iframe, so it is captured as the chooser's trigger and
// focus returns to it on close (issue Takazudo/zudo-sg#251 scope item 3). Recoverable renderer
// errors surface as a dismissible banner above the canvas.
//
// ── Menu relay (issue Takazudo/zudo-sg#256) ──────────────────────────────────────────────────
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
//
// ── Quick insert (issue #639) ───────────────────────────────────────────────
// Both a direct Add and the insert menu's "Add component…" first offer the
// request to `onRequestQuickInsert` with the translated rect. It returns true
// when it opened inline chips for a restricted slot; otherwise the chooser
// opens exactly as before. A direct Add has no focus token, so its popover
// restores focus by focusing the iframe, which keeps its own active control.

import { computed, getScope, Show, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { CompositionDocument, InsertionTarget } from "../../../composer/browser";
import type { VersionedAssetStore } from "../../../assets/library";
import type { ChooserTab } from "../ui/chooser/composer-chooser";
import type { ComposerCanvasViewport } from "../chrome/controller-model";
import type { ComposerComponentProvider } from "../active-pack";
import { ErrorIcon, InfoIcon, WarningIcon, XMarkIcon } from "../../../components/icons";
import { toSignal, type MaybeSignal } from "../../../components/reactive";
import { Button } from "../../../components/ui";
import { assetResolvedPreviewSnapshot } from "../preview/assets-snapshot";
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

/** Translate an iframe-local rect into HOST viewport coordinates (issue Takazudo/zudo-sg#256). */
function translateRect(rect: SerializedRect, frame: HTMLIFrameElement | null): SerializedRect {
  const frameBox = frame?.getBoundingClientRect();
  return {
    x: rect.x + (frameBox?.left ?? 0),
    y: rect.y + (frameBox?.top ?? 0),
    width: rect.width,
    height: rect.height,
  };
}

export interface CanvasQuickInsertRequest {
  target: InsertionTarget;
  /** The pressed control's rect, already translated to host coordinates. */
  rect: SerializedRect;
  restoreFocus: () => void;
  /** Open the shared chooser for the same target, with the iframe focused as its trigger. */
  openChooser: (initialTab?: ChooserTab) => void;
}

export interface ComposerCanvasHostProps {
  componentProvider: ComposerComponentProvider;
  document: MaybeSignal<CompositionDocument>;
  /** Separate render-only linked source context; the controller remains local. */
  snapshot?: MaybeSignal<ComposerPreviewSnapshot | undefined>;
  /** Compared by identity: pass a stable object per distinct session. */
  session: MaybeSignal<PreviewSession>;
  viewport: MaybeSignal<ComposerCanvasViewport>;
  /** A canvas node (or the empty canvas, `null`) was selected in Edit mode. */
  onSelect: (nodeId: string | null) => void;
  /** An insert point was activated — carries Takazudo/zudo-sg#245's index-bearing target. */
  onRequestAdd: (target: InsertionTarget, initialTab?: ChooserTab) => void;
  /** Offered every canvas add first; returns true when it opened a quick-insert popover instead of the chooser. */
  onRequestQuickInsert?: (request: CanvasQuickInsertRequest) => boolean;
  /** Explicit navigation for the linked source affordance. */
  onOpenSource?: (sourceRecordId: string) => void;
  /** The selected node's chrome "⋯" was activated — rect already translated to host coordinates (issue Takazudo/zudo-sg#256). */
  onRequestNodeMenu: (nodeId: string, rect: SerializedRect, restoreFocus: () => void) => void;
  /** An insert point's "⋯" was activated — rect already translated to host coordinates (issue Takazudo/zudo-sg#256). */
  onRequestInsertMenu: (
    target: InsertionTarget,
    rect: SerializedRect,
    restoreFocus: () => void,
    addComponent: () => void,
  ) => void;
  /**
   * A canvas inline edit committed and PASSED the revision check (issue Takazudo/zudo-sg#257).
   * The host has already dropped any stale edit, so this only ever fires for a
   * fresh one — route it straight through `updateProps` (the one mutation path).
   */
  onCommitInlineEdit: (nodeId: string, fieldKey: string, value: string) => void;
  /**
   * A canvas drag & drop completed and PASSED the revision check (issue Takazudo/zudo-sg#258).
   * The host has already dropped any stale drop, so this only fires for a fresh
   * one — route it through the controller's `drop` action (the one mutation
   * path), which atomically revalidates and applies the move/copy.
   */
  onDropNode: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;
  /** Forward a guarded iframe shortcut to the controller's undo action. */
  onRequestUndo?: () => void;
  /** Forward a guarded iframe shortcut to the controller's redo action. */
  onRequestRedo?: () => void;
  /** The workspace's versioned Asset store, for resolving managed Asset references. */
  assetStore?: VersionedAssetStore;

  // ── Test seams (production defaults) ──────────────────────────────────────
  /** Override the bridge factory. Defaults to Takazudo/zudo-sg#248's real bridge. */
  createBridge?: typeof createComposerPreviewBridge;
  /** Override the resolved iframe location. Defaults to the canonical route. */
  location?: ComposerPreviewLocation;
  /** Override the window hosting the `message` listener. Defaults to `window`. */
  hostWindow?: MessageTarget;
}

export function ComposerCanvasHost(props: ComposerCanvasHostProps): Child {
  const {
    document: documentProp,
    componentProvider,
    snapshot: snapshotProp,
    session: sessionProp,
    viewport: viewportProp,
    onSelect,
    onRequestAdd,
    onRequestQuickInsert,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
    onRequestUndo,
    onRequestRedo,
    assetStore,
    createBridge = createComposerPreviewBridge,
    location: locationProp,
    hostWindow,
  } = props;
  const scope = getScope();
  const doc = toSignal(documentProp);
  const suppliedSnapshot = toSignal(snapshotProp);
  const session = toSignal(sessionProp);
  const viewport = toSignal(viewportProp);

  let lastAuthoredInput: { doc: CompositionDocument; supplied: ComposerPreviewSnapshot | undefined } | null = null;
  let lastAuthored: ComposerPreviewSnapshot | null = null;
  const authoredSnapshot = computed(() => {
    const currentDoc = doc.value;
    const supplied = suppliedSnapshot.value;
    if (!lastAuthoredInput || lastAuthoredInput.doc !== currentDoc || lastAuthoredInput.supplied !== supplied) {
      lastAuthoredInput = { doc: currentDoc, supplied };
      lastAuthored = supplied ?? localPreviewSnapshot(currentDoc, currentDoc.id);
    }
    return lastAuthored;
  });
  const asset = assetResolvedPreviewSnapshot(scope, authoredSnapshot, componentProvider.catalog, {
    store: assetStore,
    enabled: computed(() => session.value.mode === "preview"),
  });
  const snapshot = computed(() => asset.value.snapshot);
  const assetError = computed(() => asset.value.error);

  const frameRef: Ref<HTMLIFrameElement> = { current: null };
  let bridge: ComposerPreviewBridge | null = null;
  let prevSnapshot: ComposerPreviewSnapshot | null = null;
  let prevSession: PreviewSession | null = null;
  // Revision of the newest DOCUMENT snapshot sent (updated on `render`, NOT on a
  // session-only `updateSession`). An inline-edit commit stamped BELOW this was
  // authored against a document the host has since superseded → stale → dropped.
  let lastDocRevision = -1;

  const renderError = signal<string | null>(null);
  const fatalError = signal<string | null>(null);
  const staleNotice = signal<string | null>(null);

  const location = locationProp ?? buildComposerPreviewUrl();
  const frameProps = composerPreviewFrameProps(location);

  // Sends the current snapshot, or only the session when the snapshot is the
  // one already sent.
  const send = (): void => {
    const current = snapshot.value;
    const currentSession = session.value;
    if (!bridge || !current) return;
    if (prevSnapshot !== current) {
      prevSnapshot = current;
      prevSession = currentSession;
      renderError.value = null;
      // A fresh document clears any stale-edit notice and advances the revision
      // an inline commit is validated against.
      staleNotice.value = null;
      lastDocRevision = bridge.render(current, currentSession);
    } else if (prevSession !== currentSession) {
      prevSession = currentSession;
      bridge.updateSession(currentSession);
    }
  };

  scope.onActivate(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const requestAdd = (
      target: InsertionTarget,
      rect: SerializedRect | undefined,
      restoreFocus: () => void,
    ): void => {
      const openChooser = (initialTab?: ChooserTab) => {
        // Focus the iframe BEFORE the chooser opens so it becomes the chooser's
        // captured trigger — focus then returns here on close.
        frameRef.current?.focus();
        if (initialTab) onRequestAdd(target, initialTab);
        else onRequestAdd(target);
      };
      if (rect && onRequestQuickInsert?.({ target, rect: translateRect(rect, frameRef.current), restoreFocus, openChooser })) return;
      openChooser();
    };
    const created = createBridge({
      frame,
      location,
      hostWindow: hostWindow ?? window,
      pack: {
        packId: componentProvider.manifest.packId,
        packVersion: componentProvider.manifest.packVersion,
      },
      onReady: () => undefined,
      onSelect: (nodeId) => onSelect(nodeId),
      onRequestAdd: (target, _revision, rect) => {
        requestAdd(target, rect, () => frameRef.current?.focus());
      },
      onOpenSource: (sourceRecordId) => onOpenSource?.(sourceRecordId),
      onRequestNodeMenu: (nodeId, rect, focusToken) => {
        onRequestNodeMenu(nodeId, translateRect(rect, frameRef.current), () =>
          bridge?.restoreFocus(focusToken),
        );
      },
      onRequestInsertMenu: (target, rect, focusToken) => {
        onRequestInsertMenu(
          target,
          translateRect(rect, frameRef.current),
          () => bridge?.restoreFocus(focusToken),
          () => requestAdd(target, rect, () => bridge?.restoreFocus(focusToken)),
        );
      },
      onCommitInlineEdit: (nodeId, fieldKey, value, documentRevision) => {
        // The host VALIDATES the revision here (issue Takazudo/zudo-sg#257): a commit authored
        // against a document snapshot the host has already superseded is
        // DROPPED with an honest status, never silently applied. Only a fresh
        // commit reaches `updateProps` — the single mutation path.
        if (documentRevision < lastDocRevision) {
          staleNotice.value = "Your inline edit was not applied — the canvas changed while you were typing. Please try again.";
          return;
        }
        staleNotice.value = null;
        onCommitInlineEdit(nodeId, fieldKey, value);
      },
      onDropNode: (sourceNodeId, target, copy, documentRevision) => {
        // Same revision gate as an inline-edit commit (issue Takazudo/zudo-sg#258): a drop
        // authored against a document snapshot the host has already superseded
        // is DROPPED with an honest status. The controller then does the ATOMIC
        // model revalidation (slot/cardinality/cycle/root/opaque-policy) — this
        // is only the stale-revision half of "host revalidates before applying".
        if (documentRevision < lastDocRevision) {
          staleNotice.value = "Your drag was not applied — the canvas changed while you were dragging. Please try again.";
          return;
        }
        staleNotice.value = null;
        onDropNode(sourceNodeId, target, copy);
      },
      onRequestUndo: () => {
        if (session.value.mode === "edit") onRequestUndo?.();
      },
      onRequestRedo: () => {
        if (session.value.mode === "edit") onRequestRedo?.();
      },
      onError: (message, recoverable) => {
        if (recoverable) renderError.value = message;
      },
      onRejected: (reason, detail) => {
        if (reason === "pack-mismatch") {
          fatalError.value = `Component pack mismatch. ${detail ?? "The host and preview loaded different packs."}`;
        }
      },
    });
    bridge = created;
    send();
    return () => {
      created.dispose();
      bridge = null;
    };
  });

  scope.effect(() => {
    void snapshot.value;
    void session.value;
    send();
  });

  const frameStyle = computed(() => {
    const width = COMPOSER_VIEWPORT_WIDTHS[viewport.value];
    return width === null ? "" : { width: `${width}px`, "max-width": "100%" };
  });
  const hasSnapshot = computed(() => snapshot.value !== null);

  return (
    <div class="sg-composer-canvas-host" data-sg-viewport={viewport}>
      <Show when={computed(() => fatalError.value !== null)}>
        {() => (
          <div class="sg-composer-canvas-error" role="alert" data-composer-preview-fatal="pack-mismatch">
            <span>
              <ErrorIcon size="sm" class="sg-composer-canvas-error__icon" />
              <span>{computed(() => `Preview cannot start: ${fatalError.value ?? ""}`)}</span>
            </span>
          </div>
        )}
      </Show>
      <Show when={computed(() => renderError.value !== null)}>
        {() => (
          <div class="sg-composer-canvas-error" role="status">
            <span>
              <WarningIcon size="sm" class="sg-composer-canvas-error__icon" />
              <span>{computed(() => `Preview error: ${renderError.value ?? ""}`)}</span>
            </span>
            <Button size="sm" on:click={() => { renderError.value = null; }}>
              <XMarkIcon size="sm" />
              Dismiss
            </Button>
          </div>
        )}
      </Show>
      <Show when={computed(() => staleNotice.value !== null)}>
        {() => (
          <div class="sg-composer-canvas-error" role="status">
            <span>
              <InfoIcon size="sm" class="sg-composer-canvas-error__icon" />
              <span>{computed(() => staleNotice.value ?? "")}</span>
            </span>
            <Button size="sm" on:click={() => { staleNotice.value = null; }}>
              <XMarkIcon size="sm" />
              Dismiss
            </Button>
          </div>
        )}
      </Show>
      <div class="sg-composer-canvas-frame" style={frameStyle}>
        <Show when={computed(() => Boolean(assetError.value))}>
          {() => <p role="alert">{computed(() => assetError.value ?? "")}</p>}
        </Show>
        <iframe
          ref={frameRef}
          hidden={computed(() => !hasSnapshot.value)}
          style={computed(() => (hasSnapshot.value ? "" : { display: "none" }))}
          class="sg-composer-preview-iframe"
          {...frameProps}
        />
      </div>
    </div>
  );
}
