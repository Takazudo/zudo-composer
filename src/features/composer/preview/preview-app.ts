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
// Written with `h()` rather than JSX for the same reason as `renderer.ts`: the
// preview route graph is checked by file name, so the module keeps its `.ts`
// name.

import { computed, getScope, h, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { diagnoseDocument } from "../../../composer/model/validate";
import type { InsertionTarget } from "../headless-api";
import type { ComposerComponentProvider } from "../active-pack";
import {
  isEditableEventTarget,
  matchesUndoRedoShortcut,
} from "../keyboard-shortcuts";
import { createPreviewClient, type PreviewClient } from "./client";
import { createReviewAnnotator } from "./review-annotations";
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

export type ComposerPreviewAppProps = { provider: ComposerComponentProvider };

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

export default function ComposerPreviewApp({ provider }: ComposerPreviewAppProps): Child {
  const scope = getScope();
  const state = signal<PreviewState>(INITIAL_PREVIEW_STATE);
  const error = signal<string | null>(null);
  const fatalError = signal<string | null>(null);
  const framed = isFramed();
  let failedRevision: number | null = null;
  let client: PreviewClient | null = null;
  let annotator: ReturnType<typeof createReviewAnnotator> | null = null;
  // A valid parent snapshot may replace the selected node's DOM ancestry (the
  // linked consumer/source view can revalidate while history is applying), so
  // keyed chrome alone cannot guarantee that the focused control survives.
  // Capture only immediately before accepting a newer snapshot and consume it
  // once the corresponding commit has completed.
  let acceptedFocusToken: string | null = null;

  scope.onActivate(() => {
    if (!framed) return undefined;

    const hostWindow = window as unknown as MessageTarget;
    const parentWindow = window.parent as unknown as MessagePoster;
    const origin = window.location.origin;

    const created = createPreviewClient({
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
        // was in flight, this deliberately records no token and the effect
        // below will not pull focus back into the iframe.
        acceptedFocusToken = activeFocusToken();
        failedRevision = null;
        state.value = next;
        // A valid snapshot means the bridge is healthy again.
        error.value = null;
      },
      // Host answered a request-node-menu / request-insert-menu once its menu
      // closed (issue Takazudo/zudo-sg#256) — restore focus to the exact control that opened
      // it. Not a state transition, so it never touches `state`.
      onRestoreFocus: (focusToken) => focusByToken(focusToken),
      onFocusAnnotation: (_key, id) => annotator?.focus(id),
      isAuthoringClean: () => !document.querySelector('[data-zc-inline-editing], [data-zc-prose-editing], [data-zc-prose-chrome], [contenteditable]:not([contenteditable="false"])'),
      onRejected: (reason: GuardFailure, detail) => {
        // A wrong-source / wrong-origin message is just noise: ANY page in ANY
        // tab can postMessage this window. Reacting to it would raise a false
        // alarm and — worse — turn this preview into a postMessage amplifier.
        // Drop it silently; only a malformed message from our OWN parent is a
        // real bug worth surfacing.
        if (reason === "pack-mismatch") {
          fatalError.value =
            `Component pack mismatch. ${detail ?? "The host and preview loaded different component packs."}`;
          return;
        }
        if (reason !== "invalid-payload") return;
        const message =
          "The Composer sent a message this preview could not understand. The last valid composition is still shown.";
        error.value = message;
        created.emitError(detail ? `${message} (${detail})` : message, true);
      },
    });
    client = created;
    annotator = createReviewAnnotator(window, () => document.querySelector("[data-composer-preview-root]"), (key, results) => created.emitReviewAnnotated(key, results));

    created.emitReady();

    return () => {
      created.dispose();
      client = null;
      annotator?.dispose();
      annotator = null;
    };
  });

  // Every derived value below is read inside an effect; signals here notify on
  // every accepted message, so each effect compares what it actually depends on.
  let focusRevision = INITIAL_PREVIEW_STATE.revision;
  scope.effect(() => {
    const revision = state.value.revision;
    if (revision === focusRevision) return;
    focusRevision = revision;
    const focusToken = acceptedFocusToken;
    acceptedFocusToken = null;
    if (focusToken !== null) focusByToken(focusToken);
  });

  scope.effect(() => {
    const { revision, selectNative, nativeReview } = state.value;
    void revision;
    if (!selectNative || nativeReview) return undefined;
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-zc-owner="local"][data-zc-node-id]')];
    for (const node of nodes) { node.tabIndex = 0; node.setAttribute("role", "button"); node.setAttribute("aria-label", `Select native target ${node.dataset.zcNodeId}`); }
    const select = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key)) return;
      const node = (event.target as Element | null)?.closest<HTMLElement>('[data-zc-owner="local"][data-zc-node-id]');
      if (!node) {
        if ((event.target as Element | null)?.closest("a, [data-zc-owner=source]")) {
          event.preventDefault(); event.stopImmediatePropagation();
          client?.emitError("This target belongs to a source template. Use Structure to edit its owner.");
        }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      client?.emitSelect(node.dataset.zcNodeId ?? null);
    };
    document.addEventListener("click", select, true); document.addEventListener("keydown", select, true);
    return () => { for (const node of nodes) { node.removeAttribute("tabindex"); node.removeAttribute("role"); node.removeAttribute("aria-label"); } document.removeEventListener("click", select, true); document.removeEventListener("keydown", select, true); };
  });

  // The rendered-candidate check runs once per (revision, review/page, document, linked, error) input set.
  let checkInputs: readonly unknown[] | null = null;
  let checkActive: { active: boolean } | null = null;
  scope.onCleanup(() => { if (checkActive) checkActive.active = false; });
  scope.effect(() => {
    const current = state.value;
    const inputs = [current.revision, current.nativeReview, current.nativePage, current.document, current.linked, error.value, fatalError.value] as const;
    if (checkInputs && inputs.every((value, index) => Object.is(value, checkInputs![index]))) return;
    checkInputs = inputs;
    if (checkActive) checkActive.active = false;
    checkActive = null;
    if ((!current.nativeReview && !current.nativePage) || !current.document || error.value || fatalError.value) return;
    const run = { active: true };
    checkActive = run;
    const revision = current.revision;
    const check = async () => {
      const documents = [current.document!, ...(current.linked ? [current.linked.sourceDocument] : [])];
      if (documents.some(value => !diagnoseDocument(value, provider.catalog).canExport)) throw new Error("Candidate has unsupported or invalid components.");
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const images = [...document.querySelectorAll<HTMLImageElement>("[data-composer-preview-root] img")];
      await Promise.all(images.map(image => new Promise<void>((resolve, reject) => {
        if (image.complete) return image.naturalWidth ? resolve() : reject(new Error("Candidate image dependency is unavailable."));
        // A lazy image outside the viewport never starts loading; verify its exact source off-DOM instead of altering page markup.
        if (image.loading === "lazy") {
          const unavailable = () => reject(new Error("Candidate image dependency is unavailable."));
          const deadline = new Promise<never>((_, fail) => setTimeout(() => fail(new Error("timeout")), 10_000));
          const picture = image.parentElement?.tagName === "PICTURE" ? image.parentElement : null;
          if (picture) {
            // The rendered candidate depends on the browser's source choice; every declared source must be reachable.
            const urls = [...picture.querySelectorAll("source[srcset]"), image].flatMap(element => (element.getAttribute("srcset") ?? element.getAttribute("src") ?? "").split(",").map(candidate => candidate.trim().split(/\s+/)[0]).filter((url): url is string => !!url).slice(0, 1));
            return void Promise.race([Promise.all(urls.map(url => fetch(new URL(url, document.baseURI), { credentials: "same-origin" }).then(response => { if (!response.ok) throw new Error(String(response.status)); }))), deadline]).then(() => resolve(), unavailable);
          }
          const probe = new Image();
          if (image.srcset) { probe.srcset = image.srcset; probe.sizes = image.sizes; }
          probe.src = image.currentSrc || image.src;
          return void Promise.race([probe.decode(), deadline]).then(() => resolve(), unavailable);
        }
        const done = (ok: boolean) => { clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed); if (ok) resolve(); else reject(new Error("Candidate image dependency is unavailable.")); };
        const loaded = () => done(true), failed = () => done(false);
        const timer = setTimeout(failed, 10_000); image.addEventListener("load", loaded); image.addEventListener("error", failed);
      })));
      // Host fonts are part of the reviewed rendering; a failed face is not a successful render.
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts) {
        await Promise.race([fonts.ready, new Promise(resolve => setTimeout(resolve, 10_000))]);
        if ([...fonts].some(face => face.status === "error")) throw new Error("A page font failed to load.");
      }
      if (run.active && !scope.abortSignal.aborted && failedRevision !== revision && client?.state.revision === revision) client.emitRendered();
    };
    void check().catch(cause => { if (run.active && !scope.abortSignal.aborted) { failedRevision = revision; client?.emitError(cause instanceof Error ? cause.message : "Candidate render failed."); } });
  });

  // Review annotations follow the committed DOM of exactly this revision; stale marks are cleared first.
  let annotationInputs: readonly unknown[] | null = null;
  scope.effect(() => {
    const { revision, review } = state.value;
    if (annotationInputs && Object.is(annotationInputs[0], revision) && Object.is(annotationInputs[1], review)) return undefined;
    annotationInputs = [revision, review];
    let active = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (active && !scope.abortSignal.aborted) annotator?.apply(review); }));
    return () => { active = false; };
  });

  // Mirror the host's active theme onto THIS document. `colors.css` keys
  // `color-scheme` off `:root[data-theme]`, which is what makes every
  // `light-dark()` token in the restored palette resolve to the right mode.
  scope.effect(() => {
    const theme = state.value.session.theme;
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  });

  scope.onActivate(() => {
    if (!framed) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const direction = canvasHistoryRequest(
        event,
        state.value.session.mode,
        document.querySelector(`[${INLINE_EDITING_ATTR}]`) !== null,
      );
      if (direction === null) return;
      event.preventDefault();
      if (direction === "undo") client?.emitRequestUndo();
      else client?.emitRequestRedo();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const onSelect = (nodeId: string | null): void => {
    client?.emitSelect(nodeId);
  };

  const onRequestAdd = (target: InsertionTarget, rect?: SerializedRect): void => {
    client?.emitRequestAdd(target, rect);
  };

  const onOpenSource = (sourceRecordId: string): void => {
    client?.emitOpenSource(sourceRecordId);
  };

  const onRequestNodeMenu = (nodeId: string, rect: SerializedRect, focusToken: string): void => {
    client?.emitRequestNodeMenu(nodeId, rect, focusToken);
  };

  const onRequestInsertMenu = (target: InsertionTarget, rect: SerializedRect, focusToken: string): void => {
    client?.emitRequestInsertMenu(target, rect, focusToken);
  };

  const onCommitInlineEdit = (nodeId: string, fieldKey: string, value: string, documentRevision: number): void => {
    // The renderer supplies its inline session's SESSION-START revision
    // (issue Takazudo/zudo-sg#288); the client forwards it verbatim as `documentRevision`
    // and the host validates it before routing through `updateProps`.
    client?.emitCommitInlineEdit(nodeId, fieldKey, value, documentRevision);
  };

  const onDropNode = (sourceNodeId: string, target: InsertionTarget, copy: boolean): void => {
    // The client stamps the revision on screen (`documentRevision`); the host
    // validates it and revalidates the whole move/copy before applying.
    client?.emitDropNode(sourceNodeId, target, copy);
  };

  const onNodeError = (nodeId: string, message: string): void => {
    failedRevision = client?.state.revision ?? null;
    client?.emitError(`Node "${nodeId}" failed to render: ${message}`, true);
  };

  // Opened directly rather than embedded: there is no Composer to talk to, so
  // say so instead of sitting on "Waiting for a composition…" forever.
  if (!framed) {
    return h(
      "p",
      { class: "zc-empty" },
      "This is the Composer's preview canvas. It only renders inside the Composer.",
    );
  }

  const showBanner = computed(() => error.value !== null && fatalError.value === null);
  const banner = h(Show, {
    when: showBanner,
    children: () => h(
      "div",
      { class: "zc-error", role: "alert" },
      h("p", { class: "zc-error-title" }, "Preview problem"),
      h("p", { class: "zc-error-detail" }, computed(() => error.value ?? "")),
      h(
        "button",
        {
          type: "button",
          class: "zc-error-dismiss",
          "data-zc-affordance": "",
          "on:click": () => { error.value = null; },
        },
        "Dismiss",
      ),
    ),
  });

  // The canvas stays mounted across snapshots and follows them through
  // signals; the last drawn values hold while the branch is being disposed.
  let lastDocument = INITIAL_PREVIEW_STATE.document;
  let lastRecordId = "";
  const canvasDocument = computed(() => (lastDocument = state.value.document ?? lastDocument)!);
  const canvasRecordId = computed(() => (lastRecordId = state.value.localRecordId ?? lastRecordId));
  const hasFatal = computed(() => fatalError.value !== null);
  const hasCanvas = computed(() => state.value.document !== null && state.value.localRecordId !== null);
  const hasDocument = computed(() => state.value.document !== null);

  const canvas = (): Child => h(CompositionCanvas, {
    document: canvasDocument,
    localRecordId: canvasRecordId,
    linked: computed(() => state.value.linked),
    provider,
    session: computed(() => state.value.session),
    revision: computed(() => state.value.revision),
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
    onNodeError,
  });

  const body = h(Show, {
    when: hasFatal,
    children: () => h(
      "div",
      { class: "zc-error", role: "alert", "data-composer-preview-fatal": "pack-mismatch" },
      h("p", { class: "zc-error-title" }, "Preview cannot start"),
      h("p", { class: "zc-error-detail" }, computed(() => fatalError.value ?? "")),
    ),
    fallback: () => h(Show, {
      when: hasCanvas,
      children: canvas,
      fallback: () => h(Show, {
        when: hasDocument,
        children: () => h("p", { class: "zc-error", role: "alert" }, "Preview received a composition without a local record identity."),
        fallback: () => h("p", { class: "zc-empty" }, "Waiting for a composition…"),
      }),
    }),
  });

  return h("div", { "data-composer-preview-root": "" }, banner, body);
}

ComposerPreviewApp.displayName = "ComposerPreviewApp";
