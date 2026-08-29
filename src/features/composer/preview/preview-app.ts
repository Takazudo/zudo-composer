"use client";

// The client-only app that runs INSIDE the Composer preview iframe.
//
// It is the trusted side of the boundary: it imports the Composer runtime
// registry (#244) itself, so the real component functions are resolved HERE and
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
// (owned by #247), and keeping this JSX-free keeps it testable.

import { h } from "preact";
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { InsertionTarget } from "../headless-api";
import type { ComposerComponentProvider } from "../active-pack";
import { createPreviewClient, type PreviewClient } from "./client";
import type { GuardFailure, MessagePoster, MessageTarget, SerializedRect } from "./protocol";
import { CompositionCanvas, focusByToken } from "./renderer";
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

export default function ComposerPreviewApp({ provider }: ComposerPreviewAppProps): JSX.Element {
  const [state, setState] = useState<PreviewState>(INITIAL_PREVIEW_STATE);
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [framed] = useState(isFramed);
  const clientRef = useRef<PreviewClient | null>(null);

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
        setState(next);
        // A valid snapshot means the bridge is healthy again.
        setError(null);
      },
      // Host answered a request-node-menu / request-insert-menu once its menu
      // closed (issue #256) — restore focus to the exact control that opened
      // it. Not a state transition, so it never touches `setState`.
      onRestoreFocus: (focusToken) => focusByToken(focusToken),
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

  // Mirror the host's active theme onto THIS document. `colors.css` keys
  // `color-scheme` off `:root[data-theme]`, which is what makes every
  // `light-dark()` token in the restored palette resolve to the right mode.
  useEffect(() => {
    document.documentElement.dataset.theme = state.session.theme;
  }, [state.session.theme]);

  const onSelect = useCallback((nodeId: string | null) => {
    clientRef.current?.emitSelect(nodeId);
  }, []);

  const onRequestAdd = useCallback((target: InsertionTarget) => {
    clientRef.current?.emitRequestAdd(target);
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
      // (issue #288); the client forwards it verbatim as `documentRevision`
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
