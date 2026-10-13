"use client";

// The client-only app that runs INSIDE the Composer preview iframe.
//
// It is the trusted side of the boundary: it imports the Composer runtime
// provider locally, so the real component functions are resolved HERE and
// never travel over the bridge. What crosses the bridge is JSON only.
//
// Boot order matters. The listener is installed BEFORE `ready` is announced, so
// the parent's answering snapshot can never arrive before anything is listening.
// Because `ready` is emitted on every load, a late load or a reload replays the
// parent's newest snapshot (see `bridge.ts`) — and the freshly booted state
// starts at revision `-1`, so it accepts it.
//
// Written with `h()` rather than JSX for the same reason as `renderer.ts`: a
// root-`src` `.tsx` module cannot be imported by the current vitest config
// (owned by the Composer host), and keeping this JSX-free keeps it testable.

import { h } from "preact";
import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { diagnoseDocument } from "../../../composer/model/validate";
import type { InsertionTarget } from "../headless-api";
import type { ComposerComponentProvider } from "../active-pack";
import {
  isEditableEventTarget,
  matchesUndoRedoShortcut,
} from "../keyboard-shortcuts";
import { createPreviewClient, type PreviewClient } from "./client";
import { INLINE_EDITING_ATTR } from "./inline-edit-dom";
import type { GuardFailure, MessagePoster, MessageTarget, SerializedRect } from "./protocol";
import { activeFocusToken, CompositionCanvas, focusByToken } from "./renderer";
import { INITIAL_PREVIEW_STATE, type PreviewState } from "./snapshot-store";

/**
 * True when this document is actually embedded. `/composer/preview` is a real
 * route, so it can be opened directly in a tab — and then `window.parent === window`,
 * which means the page is its OWN expected message source and every message it
 * posts to "the parent" is delivered straight back to itself. Without this
 * guard, `emitReady()` → schema rejection (a `ready` is not a parent→preview
 * message) → an error post → another rejection → … spins forever.
 */
function isFramed(): boolean {
  return window.parent !== window;
}

export interface ComposerPreviewAppProps { provider: ComposerComponentProvider }

/**
 * Match a history request owned by canvas chrome. Inline sessions and native
 * editable controls retain their own browser undo stack.
 */
export function canvasHistoryRequest(
  event: KeyboardEvent,
  mode: PreviewState["session"]["mode"],
  inlineEditActive: boolean,
): "undo" | "redo" | null {
  if (mode === "preview" || inlineEditActive || isEditableEventTarget(event.target)) return null;
  return matchesUndoRedoShortcut(event);
}

export default function ComposerPreviewApp({ provider }: ComposerPreviewAppProps): JSX.Element {
  const [state, setState] = useState<PreviewState>(INITIAL_PREVIEW_STATE);
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [framed] = useState(isFramed);
  const failedRevision = useRef<number | null>(null);
  const clientRef = useRef<PreviewClient | null>(null);
  // A valid parent snapshot may replace the selected node's DOM ancestry (the
  // linked consumer/source view can revalidate while history is applying), so
  // keyed chrome alone cannot guarantee that the focused control survives.
  // Capture only immediately before accepting a newer snapshot and consume it
  // once the corresponding Preact commit has completed.
  const acceptedFocusTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!framed) return;

    const hostWindow = window as unknown as MessageTarget;
    const parentWindow = window.parent as unknown as MessagePoster;
    const origin = window.location.origin;

    const client = createPreviewClient({
      hostWindow,
      parentWindow,
      // The parent frame is the ONLY window this preview will take orders from.
      expectedSource: window.parent,
      // Same-origin by construction: anything else is a foreign frame.
      expectedOrigin: origin,
      // Exact target origin — never "*".
      targetOrigin: origin,
      pack: {
        packId: provider.manifest.packId,
        packVersion: provider.manifest.packVersion,
      },
      onState: (next) => {
        // `onState` is called only after the client's strict revision guard
        // accepts the message. If focus moved to the host while the message
        // was in flight, this deliberately records no token and the layout
        // effect below will not pull focus back into the iframe.
        acceptedFocusTokenRef.current = activeFocusToken();
        failedRevision.current = null;
        setState(next);
        // A valid snapshot means the bridge is healthy again.
        setError(null);
      },
      // Host answered a request-node-menu / request-insert-menu once its menu
      // closed (issue Takazudo/zudo-sg#256) — restore focus to the exact control that opened
      // it. Not a state transition, so it never touches `setState`.
      onRestoreFocus: (focusToken) => focusByToken(focusToken),
      isAuthoringClean: () => !document.querySelector('[data-zc-inline-editing], [data-zc-prose-editing], [data-zc-prose-chrome], [contenteditable]:not([contenteditable="false"])'),
      onRejected: (reason: GuardFailure, detail) => {
        // A wrong-source / wrong-origin message is just noise: ANY page in ANY
        // tab can postMessage this window. Reacting to it would raise a false
        // alarm and — worse — turn this preview into a postMessage amplifier.
        // Drop it silently; only a malformed message from our OWN parent is a
        // real bug worth surfacing.
        if (reason === "pack-mismatch") {
          setFatalError(
            `Component pack mismatch. ${detail ?? "The host and preview loaded different component packs."}`,
          );
          return;
        }
        if (reason !== "invalid-payload") return;
        const message =
          "The Composer sent a message this preview could not understand. The last valid composition is still shown.";
        setError(message);
        client.emitError(detail ? `${message} (${detail})` : message, true);
      },
    });
    clientRef.current = client;

    client.emitReady();

    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [framed, provider.manifest.packId, provider.manifest.packVersion]);

  useLayoutEffect(() => {
    const focusToken = acceptedFocusTokenRef.current;
    acceptedFocusTokenRef.current = null;
    if (focusToken !== null) focusByToken(focusToken);
  }, [state.revision]);

  useEffect(() => {
    if (!state.selectNative || state.nativeReview) return;
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-zc-owner="local"][data-zc-node-id]')];
    for (const node of nodes) { node.tabIndex = 0; node.setAttribute("role", "button"); node.setAttribute("aria-label", `Select native target ${node.dataset.zcNodeId}`); }
    const select = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return;
      const node = (event.target as Element | null)?.closest<HTMLElement>('[data-zc-owner="local"][data-zc-node-id]');
      if (!node) {
        if ((event.target as Element | null)?.closest("a, [data-zc-owner=source]")) {
          event.preventDefault(); event.stopImmediatePropagation();
          clientRef.current?.emitError("This target belongs to a source template. Use Structure to edit its owner.");
        }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      clientRef.current?.emitSelect(node.dataset.zcNodeId ?? null);
    };
    document.addEventListener("click", select, true); document.addEventListener("keydown", select, true);
    return () => { for (const node of nodes) { node.removeAttribute("tabindex"); node.removeAttribute("role"); node.removeAttribute("aria-label"); } document.removeEventListener("click", select, true); document.removeEventListener("keydown", select, true); };
  }, [state.revision, state.selectNative, state.nativeReview]);

  useEffect(() => {
    if (!state.nativeReview || !state.document || error || fatalError) return;
    let active = true;
    const revision = state.revision;
    const check = async () => {
      const documents = [state.document!, ...(state.linked ? [state.linked.sourceDocument] : [])];
      if (documents.some(value => !diagnoseDocument(value, provider.catalog).canExport)) throw new Error("Candidate has unsupported or invalid components.");
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const images = [...document.querySelectorAll<HTMLImageElement>("[data-composer-preview-root] img")];
      await Promise.all(images.map(image => new Promise<void>((resolve, reject) => {
        if (image.complete) return image.naturalWidth ? resolve() : reject(new Error("Candidate image dependency is unavailable."));
        const done = (ok: boolean) => { clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed); if (ok) resolve(); else reject(new Error("Candidate image dependency is unavailable.")); };
        const loaded = () => done(true), failed = () => done(false);
        const timer = setTimeout(failed, 10_000); image.addEventListener("load", loaded); image.addEventListener("error", failed);
      })));
      if (active && failedRevision.current !== revision && clientRef.current?.state.revision === revision) clientRef.current.emitRendered();
    };
    void check().catch(cause => { if (active) { failedRevision.current = revision; clientRef.current?.emitError(cause instanceof Error ? cause.message : "Candidate render failed."); } });
    return () => { active = false; };
  }, [state.revision, state.nativeReview, state.document, state.linked, provider, error, fatalError]);

  // Mirror the host's active theme onto THIS document. `colors.css` keys
  // `color-scheme` off `:root[data-theme]`, which is what makes every
  // `light-dark()` token in the restored palette resolve to the right mode.
  useEffect(() => {
    document.documentElement.dataset.theme = state.session.theme;
  }, [state.session.theme]);

  useEffect(() => {
    if (!framed) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const direction = canvasHistoryRequest(
        event,
        state.session.mode,
        document.querySelector(`[${INLINE_EDITING_ATTR}]`) !== null,
      );
      if (direction === null) return;
      event.preventDefault();
      if (direction === "undo") clientRef.current?.emitRequestUndo();
      else clientRef.current?.emitRequestRedo();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [framed, state.session.mode]);

  const onSelect = useCallback((nodeId: string | null) => {
    clientRef.current?.emitSelect(nodeId);
  }, []);

  const onRequestAdd = useCallback((target: InsertionTarget, rect?: SerializedRect) => {
    clientRef.current?.emitRequestAdd(target, rect);
  }, []);

  const onOpenSource = useCallback((sourceRecordId: string) => {
    clientRef.current?.emitOpenSource(sourceRecordId);
  }, []);

  const onRequestNodeMenu = useCallback((nodeId: string, rect: SerializedRect, focusToken: string) => {
    clientRef.current?.emitRequestNodeMenu(nodeId, rect, focusToken);
  }, []);

  const onRequestInsertMenu = useCallback(
    (target: InsertionTarget, rect: SerializedRect, focusToken: string) => {
      clientRef.current?.emitRequestInsertMenu(target, rect, focusToken);
    },
    [],
  );

  const onCommitInlineEdit = useCallback(
    (nodeId: string, fieldKey: string, value: string, documentRevision: number) => {
      // The renderer supplies its inline session's SESSION-START revision
      // (issue Takazudo/zudo-sg#288); the client forwards it verbatim as `documentRevision`
      // and the host validates it before routing through `updateProps`.
      clientRef.current?.emitCommitInlineEdit(nodeId, fieldKey, value, documentRevision);
    },
    [],
  );

  const onDropNode = useCallback((sourceNodeId: string, target: InsertionTarget, copy: boolean) => {
    // The client stamps the revision on screen (`documentRevision`); the host
    // validates it and revalidates the whole move/copy before applying.
    clientRef.current?.emitDropNode(sourceNodeId, target, copy);
  }, []);

  const onNodeError = useCallback((nodeId: string, message: string) => {
    failedRevision.current = clientRef.current?.state.revision ?? null;
    clientRef.current?.emitError(`Node "${nodeId}" failed to render: ${message}`, true);
  }, []);

  // Opened directly rather than embedded: there is no Composer to talk to, so
  // say so instead of sitting on "Waiting for a composition…" forever.
  if (!framed) {
    return h(
      "p",
      { class: "zc-empty" },
      "This is the Composer's preview canvas. It only renders inside the Composer.",
    );
  }

  const banner =
    error === null || fatalError !== null
      ? null
      : h(
          "div",
          { class: "zc-error", role: "alert" },
          h("p", { class: "zc-error-title" }, "Preview problem"),
          h("p", { class: "zc-error-detail" }, error),
          h(
            "button",
            {
              type: "button",
              class: "zc-error-dismiss",
              "data-zc-affordance": "",
              onClick: () => setError(null),
            },
            "Dismiss",
          ),
        );

  const body = fatalError !== null
    ? h(
        "div",
        { class: "zc-error", role: "alert", "data-composer-preview-fatal": "pack-mismatch" },
        h("p", { class: "zc-error-title" }, "Preview cannot start"),
        h("p", { class: "zc-error-detail" }, fatalError),
      )
    : state.document && state.localRecordId
    ? h(CompositionCanvas, {
        document: state.document,
        localRecordId: state.localRecordId,
        linked: state.linked,
        provider,
        session: state.session,
        revision: state.revision,
        onSelect,
        onRequestAdd,
        onOpenSource,
        onRequestNodeMenu,
        onRequestInsertMenu,
        onCommitInlineEdit,
        onDropNode,
        onNodeError,
      })
    : state.document
      ? h("p", { class: "zc-error", role: "alert" }, "Preview received a composition without a local record identity.")
      : h("p", { class: "zc-empty" }, "Waiting for a composition…");

  return h("div", { "data-composer-preview-root": "" }, banner, body);
}

ComposerPreviewApp.displayName = "ComposerPreviewApp";
