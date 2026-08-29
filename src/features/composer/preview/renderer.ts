// The Composer preview RENDERER: a `CompositionDocument` (pure JSON, received
// over the bridge) → real, production Preact components.
//
// Written with `h()` rather than JSX on purpose: the vitest config collects
// `src/**/__tests__/**/*.test.ts` and its esbuild pass runs under the root
// `tsconfig.json` (`jsx: "preserve"`), so a `.tsx` module under `src/` cannot be
// imported from a unit test. Keeping the renderer JSX-free makes the DOM
// identity, slot-projection, and edit/preview behaviour directly testable
// without touching the shared vitest config (owned by the parallel #247).
//
// ── Trust boundary ───────────────────────────────────────────────────────────
// The document that arrives over the bridge is DATA. The component FUNCTIONS
// come from the trusted registry (#244), which this module imports itself
// inside the iframe. A `componentId` is only ever used as a Map key — never as
// a module specifier, never evaluated.
//
// ── DOM identity (hard acceptance criterion) ─────────────────────────────────
// Toggling hover or selection must NEVER remount a component's DOM node. Two
// mechanisms guarantee that:
//
//   1. HOVER IS PURE CSS. There is no hover state in Preact at all — the chrome
//      is revealed by `.zc-node:hover > .zc-chrome`. A hover cannot trigger a
//      re-render, so it cannot trigger a diff.
//   2. EVERY CHILD OF `.zc-node` IS KEYED. The selection/label chrome is keyed
//      `zc-chrome` and the component body is wrapped in a Fragment keyed
//      `zc-body`. Preact's UNKEYED children diff matches by position and falls
//      back to type, and can cross-match a chrome `<span>` against a
//      component's own `<span>` — destroying and recreating the component's DOM
//      node (a verified failure mode in the #242 prototype). Keyed children
//      match by key, so adding/removing the chrome (Edit ⇄ Preview) touches only
//      the chrome.
//
// Selection itself is a bare attribute swap (`data-zc-selected`) styled with
// `outline`, which is out-of-flow: it neither remounts nor reflows the node.

import { Component, Fragment, h } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { EllipsisIcon, PlusIcon } from "../../../components/icons";
import type {
  CompositionDocument,
  CompositionNode,
  InsertionTarget,
  JsonObject,
  NodeDiagnostic,
} from "../headless-api";
import { VIRTUAL_ROOT_SLOT_ID, classifyNode } from "../headless-api";
import type { ComposerComponentProvider, ComposerRuntimeEntry } from "../active-pack";
import {
  INLINE_EDITING_ATTR,
  effectiveFieldValue,
  escapeAttrValue,
  findNodeById,
  inlineEditableForEntry,
  placeCaretAtEnd,
  readNormalizedEditableValue,
} from "./inline-edit-dom";
import { useProseInlineSession } from "./prose-inline-session";
import {
  RESERVED_PROP_KEYS,
  serializeRect,
  type PreviewLinkedSourceContext,
  type PreviewSession,
  type SerializedRect,
} from "./protocol";
import { slotFlow, type SlotFlow } from "./slot-flow";

// ── Menu focus tokens (issue #256) ──────────────────────────────────────────
//
// The attribute a menu trigger control carries so a later `restore-focus`
// message (see `preview-app.ts`) can find and refocus the EXACT control that
// requested the menu, even though the document may have re-rendered in the
// meantime. Deterministic (not random) — a re-render that recreates the same
// logical affordance recreates the same token, so a plain close (Escape /
// outside-click / scroll / resize dismiss, no document mutation) always finds
// a live match. A mutation that removes the affordance (e.g. Delete) simply
// leaves no match — `focusByToken` is a silent no-op then, never a throw.
const FOCUS_TOKEN_ATTR = "data-zc-focus-token";

export function nodeMenuFocusToken(nodeId: string): string {
  return `node-menu:${nodeId}`;
}

export function insertMenuFocusToken(target: InsertionTarget): string {
  return `insert-menu:${target.parentId ?? ""}:${target.slotId}:${target.index}`;
}

/** Focus the control a `restore-focus` message's token points at, if it still exists. */
export function focusByToken(token: string): void {
  document.querySelector<HTMLElement>(`[${FOCUS_TOKEN_ATTR}="${escapeAttrValue(token)}"]`)?.focus();
}

// ── Inline text editing (issue #257) ────────────────────────────────────────
//
// A flag alone can't target the right text node: real components render
// decorations (`CtaButton` an arrow, `SectionHeading` an eyebrow/heading/intro).
// So the trusted, non-serializable `adapters.inlineEditor` (kept only in the
// runtime registry — #244/#246) resolves the editable element inside a rendered
// component. MVP: at most ONE inline-editable field per component.
//
// The three verified prototype rules the session code below follows exactly:
//   - the editing element carries NO vdom text child (its content is set
//     imperatively via ref) so an unrelated re-render can never reset the caret;
//   - its body is KEYED differently in edit vs read mode, so exiting the session
//     remounts it and cannot leave a duplicate (imperatively-inserted) text node;
//   - `dblclick` inside an active session STOPS propagation (word-select must not
//     bubble to the canvas and restart the session, reverting the typing).
//
// The DOM helpers this session uses (`readEditableValue`, `placeCaretAtEnd`,
// `effectiveFieldValue`, …) live in `inline-edit-dom.ts` — epic #368 added a
// SECOND, explicit-save session (`prose-inline-session.ts`) that has to derive
// those answers identically, and one shared implementation is what keeps the
// #288 ground-check sound. This session's own behaviour is unchanged by that
// move, and the two sessions never share state.

/** An active on-canvas editing session — LOCAL renderer state, never persisted. */
interface InlineSessionState {
  nodeId: string;
  fieldKey: string;
  multiline: boolean;
  /** The value the field held when the session opened. Set imperatively. */
  initialValue: string;
  /**
   * The document revision on screen when the session was ENTERED (issue #288).
   * Carried on the session and stamped on the eventual commit INSTEAD OF the
   * revision on screen at commit time — a mid-edit render that bumps the
   * revision must make a later commit fail the host's staleness gate, not
   * re-stamp itself as fresh just because it happened to be sent after that
   * render landed.
   */
  startRevision: number;
}

/**
 * One manifest per registry array, built once. `runtimeEntryManifest` runs a zod
 * validation per entry, and the whole cohort would otherwise be re-validated on
 * every mount — which #254's ephemeral chooser preview pays repeatedly.
 */
/**
 * Drop any prop the protocol reserves before it can reach a real component.
 *
 * The bridge already REFUSES a document carrying one of these
 * (`compositionNodeSchema`), so this is defence in depth for the paths that do
 * not cross the bridge — a host that renders a locally-built document, a future
 * caller, a test. `dangerouslySetInnerHTML` is the one that matters: several
 * cohort components spread their rest props onto a DOM element.
 */
function safeProps(props: JsonObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (RESERVED_PROP_KEYS.has(name)) continue;
    out[name] = value;
  }
  return out;
}

export interface CompositionCanvasProps {
  document: CompositionDocument;
  /** Canonical consumer identity for owner-qualified runtime keys. */
  localRecordId: string;
  /** Optional resolved, read-only Global-template source/outlet context. */
  linked?: PreviewLinkedSourceContext | null;
  /** The TRUSTED runtime registry — retains real component functions. */
  provider: ComposerComponentProvider;
  session: PreviewSession;
  /**
   * The document revision on screen (issue #288). An inline-edit session
   * captures this at the moment it is ENTERED and carries it forward as its
   * `startRevision`, stamping it on the eventual commit instead of whatever
   * revision happens to be on screen when the user finishes typing — see
   * `onCommitInlineEdit`. Optional (default `0`) so mounts/tests that never
   * inline-edit need not supply it.
   */
  revision?: number;
  /** A node (or the empty canvas, `null`) was activated in Edit mode. */
  onSelect: (nodeId: string | null) => void;
  /** An insert point was activated. Carries #245's insert-at-index target. */
  onRequestAdd: (target: InsertionTarget) => void;
  /** Explicit linked-source navigation — never a source-node selection. */
  onOpenSource?: (sourceRecordId: string) => void;
  /** The SELECTED node's chrome "⋯" was activated (issue #256). */
  onRequestNodeMenu: (nodeId: string, rect: SerializedRect, focusToken: string) => void;
  /** An insert point's "⋯" was activated (issue #256). */
  onRequestInsertMenu: (target: InsertionTarget, rect: SerializedRect, focusToken: string) => void;
  /**
   * An inline-editing session committed a value (issue #257). `documentRevision`
   * is the SESSION-START revision (issue #288) — the `revision` prop's value
   * when the session was entered, not the revision on screen at commit time —
   * so a commit authored during a session a mid-edit render has since
   * superseded correctly fails the host's `documentRevision <
   * lastDocRevisionRef.current` staleness gate instead of silently re-stamping
   * itself as fresh. The host still validates it; the renderer only reports the
   * raw `{ nodeId, fieldKey, value, documentRevision }`. Optional so existing
   * mounts/tests that never inline-edit need not supply it.
   */
  onCommitInlineEdit?: (nodeId: string, fieldKey: string, value: string, documentRevision: number) => void;
  /**
   * A cross-slot drag & drop completed on the canvas (issue #258). `copy` is
   * true when Alt was held at drop. The renderer reports the raw
   * `{ sourceNodeId, target, copy }`; the host stamps the revision, revalidates
   * ATOMICALLY (slot/cardinality/cycle/root/opaque-policy), and applies through
   * the controller — the highlight the renderer draws is advisory only. Optional
   * so mounts/tests that never drag need not supply it (and no grip renders
   * without it).
   */
  onDropNode?: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;
  /** A node's component threw and was isolated behind its error boundary. */
  onNodeError?: (nodeId: string, message: string) => void;
}

type RuntimeOwner = "local" | "global-template";

interface RuntimeNodeInfo {
  owner: RuntimeOwner;
  /** Injective across a local/source collision, safe for Preact and DOM identity. */
  runtimeKey: string;
}

function ownerSegment(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)!.toString(16).padStart(6, "0")).join("");
}

function runtimeKey(owner: RuntimeOwner, recordId: string, nodeId: string): string {
  return `${owner}:${ownerSegment(recordId)}:node:${ownerSegment(nodeId)}`;
}

/**
 * Renders a whole Composition. Every node gets a stable wrapper carrying its id;
 * in Edit mode it also gets out-of-flow chrome and an insert point at EVERY
 * addable index of EVERY declared slot.
 */
export function CompositionCanvas(props: CompositionCanvasProps): JSX.Element {
  const {
    document,
    localRecordId,
    linked = null,
    provider,
    session,
    revision = 0,
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
    onNodeError,
  } = props;

  // Ownership is tracked by object identity, never a raw node id: a source and
  // consumer may both legitimately contain `node-1`. The controller/session
  // only ever names local ids; source branches get a distinct runtime key and
  // are filtered out before any mutation path below.
  const runtimeNodes = useMemo(() => {
    const nodes = new WeakMap<CompositionNode, RuntimeNodeInfo>();
    const register = (forest: readonly CompositionNode[], owner: RuntimeOwner, recordId: string): void => {
      for (const node of forest) {
        nodes.set(node, { owner, runtimeKey: runtimeKey(owner, recordId, node.id) });
        for (const children of Object.values(node.slots)) register(children, owner, recordId);
      }
    };
    register(document.root, "local", localRecordId);
    if (linked) register(linked.sourceDocument.root, "global-template", linked.sourceRecordId);
    return nodes;
  }, [document, linked, localRecordId]);

  const runtimeInfo = (node: CompositionNode): RuntimeNodeInfo =>
    runtimeNodes.get(node) ?? { owner: "local", runtimeKey: runtimeKey("local", localRecordId, node.id) };
  const localNode = (node: CompositionNode): boolean => runtimeInfo(node).owner === "local";
  const resetToken = useMemo(
    () => (linked ? [document, linked.sourceDocument] : document),
    [document, linked?.sourceDocument],
  );

  const entryById = useMemo(
    () => new Map(provider.runtimeEntries.map((entry) => [entry.manifest.id, entry])),
    [provider],
  );
  const manifest = provider.catalog;

  // ── Inline editing session (issue #257) ───────────────────────────────────
  // LOCAL renderer state; never travels over the bridge and never mutates the
  // document until a commit routes through the host's `updateProps`.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const editableRef = useRef<HTMLElement | null>(null);
  const finishingRef = useRef(false);
  const commitCbRef = useRef(onCommitInlineEdit);
  commitCbRef.current = onCommitInlineEdit;

  const [inlineSession, setInlineSessionState] = useState<InlineSessionState | null>(null);
  // Mirror in a ref so the imperative event listeners (attached to a real
  // component DOM node, outside Preact) always see the live session.
  const sessionRef = useRef<InlineSessionState | null>(null);
  const setSession = useCallback((next: InlineSessionState | null) => {
    sessionRef.current = next;
    setInlineSessionState(next);
  }, []);

  const commitInline = useCallback(() => {
    const active = sessionRef.current;
    if (!active || finishingRef.current) return;
    finishingRef.current = true;
    const el = editableRef.current;
    const value = el
      ? readNormalizedEditableValue(el, active.multiline, active.initialValue)
      : active.initialValue;
    // A NO-OP commit (value unchanged from session start) must not reach the
    // host: it mutates nothing, yet still advances the document revision. That
    // is not merely wasteful — a spurious commit-of-the-seed (a blur fired the
    // instant the session opened, before any typing, which then re-enters a
    // fresh session) would bump `lastDocRevisionRef` and make the user's real
    // follow-up commit fail the host's SESSION-START staleness gate (issue
    // #288), silently dropping the edit. Skipping unchanged values keeps the
    // session-start revision contract sound across a re-entered session.
    if (value !== active.initialValue) {
      // Stamped with the SESSION-START revision (issue #288) — see `InlineSessionState`.
      commitCbRef.current?.(active.nodeId, active.fieldKey, value, active.startRevision);
    }
    setSession(null);
  }, [setSession]);

  const cancelInline = useCallback(() => {
    if (!sessionRef.current || finishingRef.current) return;
    finishingRef.current = true;
    setSession(null);
  }, [setSession]);

  const enterInlineSession = useCallback(
    (nodeId: string): boolean => {
      if (sessionRef.current) return false;
      const targetNode = findNodeById(document.root, nodeId);
      if (!targetNode) return false;
      const entry = entryById.get(targetNode.componentId);
      const editable = inlineEditableForEntry(entry);
      if (!editable || !entry) return false;
      // A `markdown-source` field belongs to the explicit-save prose session
      // (#375), which is entered FIRST by `enterAnyInlineSession` below. This
      // guard is what keeps the auto-commit path from ever claiming one.
      if (editable.mode !== "plain") return false;
      const initialValue = effectiveFieldValue(targetNode, entry, editable.field);
      setSession({
        nodeId,
        fieldKey: editable.field,
        multiline: editable.multiline,
        initialValue,
        startRevision: revision,
      });
      return true;
    },
    [document, entryById, revision, setSession],
  );

  // ── Explicit-save prose session (issue #375, epic #368) ───────────────────
  // The PARALLEL path for `inlineEdit.mode: "markdown-source"` fields. It owns
  // its own state machine, its own editable surface, and its own iframe-side
  // chrome; the auto-commit session above is untouched by it.
  const prose = useProseInlineSession({
    document,
    entryById,
    revision,
    mode: session.mode,
    canvasRef,
    // The same verdict `renderNode` draws with — an opaque node shows its
    // preserved payload read-only and is never editable.
    isOpaque: (node) => !entryById.has(node.componentId) || classifyNode(node, manifest).opaque,
    onCommit: onCommitInlineEdit,
  });

  /**
   * The single entry point both gestures use. The prose session gets first
   * refusal (it accepts only `markdown-source` fields); everything else falls
   * through to the auto-commit session exactly as before.
   */
  const enterAnyInlineSession = (nodeId: string): boolean =>
    prose.tryEnter(nodeId) || enterInlineSession(nodeId);

  /**
   * Edit-mode chrome is drawn when the HOST says Edit — or while a prose draft
   * that a mode switch stashed has been restored, which needs Edit mode back
   * but has no protocol message to ask for it (see `prose-inline-session.ts`).
   */
  const edit = session.mode === "edit" || prose.editModeOverride;

  /** Either session holds the canvas — the imperative handlers below check both. */
  const anySessionActive = (): boolean => sessionRef.current !== null || prose.activeRef.current;

  // Set up (and tear down) the imperative contentEditable when a session opens.
  // A layout effect runs after the keyed-body remount has committed the fresh
  // (empty-field) component DOM but before paint, so the caret is placed with
  // no flicker. Content is set imperatively here — never via a vdom child.
  useLayoutEffect(() => {
    const active = sessionRef.current;
    if (!active) return;
    finishingRef.current = false;

    const wrapper = canvasRef.current?.querySelector<HTMLElement>(
      `[data-zc-owner="local"][data-zc-node-id="${escapeAttrValue(active.nodeId)}"]`,
    );
    const componentRoot = wrapper
      ? (Array.from(wrapper.children).find((c) => !c.classList.contains("zc-chrome")) as
          | HTMLElement
          | undefined)
      : undefined;
    const resolve = inlineEditableForEntry(
      entryById.get(findNodeById(document.root, active.nodeId)?.componentId ?? ""),
    )?.resolveElement;
    const el = componentRoot && resolve ? resolve(componentRoot) : null;
    if (!el) {
      // The adapter could not resolve a text region — abandon rather than trap
      // the user in a broken editor.
      setSession(null);
      return;
    }
    editableRef.current = el;

    const ownerDoc = el.ownerDocument;
    el.setAttribute(INLINE_EDITING_ATTR, "");
    el.setAttribute("contenteditable", active.multiline ? "true" : "plaintext-only");
    // Protect decoration islands (e.g. CtaButton's aria-hidden arrow) so a caret
    // can't wander into them and so `readEditableValue` can exclude them.
    el.querySelectorAll<HTMLElement>('[aria-hidden="true"]').forEach((d) =>
      d.setAttribute("contenteditable", "false"),
    );
    // Content set IMPERATIVELY, and BEFORE any decoration so the label sits ahead
    // of a trailing arrow. The component rendered this field with no vdom child,
    // so Preact never manages (or resets) this text node.
    el.insertBefore(ownerDoc.createTextNode(active.initialValue), el.firstChild);
    el.focus();
    placeCaretAtEnd(el);

    let composing = false;
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInline();
        return;
      }
      if (event.key === "Enter" && !active.multiline) {
        // IME-SAFE: a composition's confirming Enter (isComposing / keyCode 229)
        // commits the CANDIDATE, never the field — so Japanese input is never
        // truncated. Only a non-composing Enter commits the single-line field.
        if (composing || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        commitInline();
      }
    };
    const onBlur = (): void => {
      commitInline();
    };
    // Word-select inside an active session must NOT bubble to the canvas, or it
    // would restart the session and revert the typing (verified failure mode).
    const onDblClick = (event: MouseEvent): void => {
      event.stopPropagation();
    };

    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("blur", onBlur);
    el.addEventListener("dblclick", onDblClick);

    return () => {
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("dblclick", onDblClick);
      el.removeAttribute("contenteditable");
      el.removeAttribute(INLINE_EDITING_ATTR);
      if (editableRef.current === el) editableRef.current = null;
    };
  }, [inlineSession?.nodeId, inlineSession?.fieldKey]);

  // Switching to Preview mid-edit COMMITS the draft (defined, tested behavior).
  // The keyed body is not remounted by a mere mode change, so the live editable
  // is still attached here and `commitInline` reads its current text.
  const prevModeRef = useRef(session.mode);
  useLayoutEffect(() => {
    const previous = prevModeRef.current;
    prevModeRef.current = session.mode;
    if (previous !== "preview" && session.mode === "preview" && sessionRef.current) {
      commitInline();
    }
  }, [session.mode]);

  // Cancel the session outright when the GROUND MOVES under it (issue #288):
  // an incoming render mid-edit that changes the value of the field actually
  // being edited means a concurrent change landed while the user was typing —
  // the session is abandoned rather than let the user keep typing into a
  // field whose eventual commit is either doomed to fail the host's revision
  // gate or, worse, could coincidentally match. Cancelling remounts the keyed
  // body (see `renderNode`), so the editor never sits there showing text that
  // no longer reflects the document. A render that leaves this field alone
  // (an edit elsewhere in the document) does NOT cancel — the session and the
  // stale-but-correctly-gated commit path (see `commitInline`) both survive
  // that case unchanged. Keyed on `document` identity alone: `mode`-only
  // session updates keep the SAME document reference (`applyInbound`,
  // `snapshot-store.ts`), so this effect only ever fires for an actual render.
  const prevDocumentForGroundCheckRef = useRef(document);
  useLayoutEffect(() => {
    const previousDocument = prevDocumentForGroundCheckRef.current;
    prevDocumentForGroundCheckRef.current = document;
    const active = sessionRef.current;
    if (!active || previousDocument === document) return;
    const targetNode = findNodeById(document.root, active.nodeId);
    const entry = targetNode ? entryById.get(targetNode.componentId) : undefined;
    const currentValue = effectiveFieldValue(targetNode, entry, active.fieldKey);
    if (!targetNode || currentValue !== active.initialValue) cancelInline();
  }, [document]);

  // ── Drag & drop (issue #258) ──────────────────────────────────────────────
  // LOCAL renderer state; only the resulting `{ sourceNodeId, target, copy }`
  // ever crosses the bridge (the host revalidates + applies). The three verified
  // Chromium footguns the code below fixes EXACTLY (see the prototype README):
  //   - `dragstart` calls `setData` SYNCHRONOUSLY and DEFERS every state mutation
  //     (a synchronous setState in dragstart cancels the native drag in Chromium);
  //   - while dragging, insert-point CHILDREN are `pointer-events: none` (CSS,
  //     keyed off `data-zc-dragging`) — a child-crossing `dragleave` has a null
  //     `relatedTarget` in Chromium DnD and would otherwise wipe the highlight;
  //   - `dragend` clears the drag state UNCONDITIONALLY (a drop OR a cancel).
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const dropKeyRef = useRef<string | null>(null);
  const setDrop = useCallback((key: string | null) => {
    dropKeyRef.current = key;
    setDropKey(key);
  }, []);

  const beginDrag = useCallback((sourceNodeId: string) => {
    dragSourceRef.current = sourceNodeId;
    setDragSourceId(sourceNodeId);
  }, []);
  const endDrag = useCallback(() => {
    dragSourceRef.current = null;
    dropKeyRef.current = null;
    setDragSourceId(null);
    setDropKey(null);
  }, []);

  // The dragged node's own subtree ids — every insert point inside them is an
  // INVALID target (dropping there would orphan the subtree; the host's cycle
  // guard would reject it anyway, so the highlight simply excludes them).
  const draggedIds = useMemo(() => {
    if (!dragSourceId) return null;
    const source = findNodeById(document.root, dragSourceId);
    if (!source) return null;
    const ids = new Set<string>();
    const walk = (n: CompositionNode): void => {
      ids.add(n.id);
      for (const children of Object.values(n.slots)) for (const child of children ?? []) walk(child);
    };
    walk(source);
    return ids;
  }, [dragSourceId, document]);

  const dragActive = dragSourceId !== null;

  /** A drop target is valid unless it sits inside the dragged subtree. */
  const isValidDropTarget = useCallback(
    (target: InsertionTarget): boolean =>
      dragActive && !(target.parentId !== null && (draggedIds?.has(target.parentId) ?? false)),
    [dragActive, draggedIds],
  );

  /**
   * In Edit mode the canvas swallows every click in the CAPTURE phase before it
   * can reach a rendered `<a>`/`<button>`, so authoring a link never navigates
   * away and authoring a button never fires its handler. Editor affordances
   * (insert points, chrome buttons, the opaque payload disclosure) opt out with
   * `data-zc-affordance` and behave normally.
   */
  const swallow = (event: Event): boolean => {
    const target = event.target as Element | null;
    if (target?.closest("[data-zc-affordance]")) return false;
    // An active inline-editing region owns its own keys/clicks (Enter commits,
    // a multiline Enter inserts a newline, Space/caret keys type normally). The
    // capture-phase swallow must NOT stop those before they reach the editable.
    if (anySessionActive() && target?.closest(`[${INLINE_EDITING_ATTR}]`)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const onClickCapture = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    // A click INSIDE the active editable is caret placement — never swallow it.
    if (anySessionActive() && target?.closest(`[${INLINE_EDITING_ATTR}]`)) return;
    if (!swallow(event)) return;
    const host = target?.closest("[data-zc-node-id]");
    // A source wrapper may have the same raw id as a local wrapper. Only the
    // explicitly local owner can ever enter the controller selection path.
    if (host && host.getAttribute("data-zc-owner") !== "local") return;
    const nodeId = host?.getAttribute("data-zc-node-id") ?? null;
    // Click AGAIN on the already-selected node opens its inline editor (if it has
    // one); the first click on an unselected node just selects it.
    if (
      nodeId &&
      !anySessionActive() &&
      nodeId === session.selectedId &&
      enterAnyInlineSession(nodeId)
    ) {
      return;
    }
    onSelect(nodeId);
  };

  /** Double-click enters an inline session directly (the other entry path). */
  const onDblClick = (event: MouseEvent): void => {
    // An active session's own dblclick is stopped before it reaches here (see
    // the session's `onDblClick`); guard anyway so word-select never restarts it.
    if (anySessionActive()) return;
    const target = event.target as Element | null;
    if (target?.closest("[data-zc-affordance]")) return;
    const host = target?.closest("[data-zc-node-id]");
    if (host && host.getAttribute("data-zc-owner") !== "local") return;
    const nodeId = host?.getAttribute("data-zc-node-id") ?? null;
    if (nodeId && enterAnyInlineSession(nodeId)) event.preventDefault();
  };

  /** Keyboard activation is the other way a link/button fires. Swallow it too. */
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    swallow(event);
  };

  /**
   * PREVIEW mode: rendered controls activate normally — the event is NOT stopped,
   * so a component's own handlers run, buttons work, disclosures toggle.
   *
   * The one thing that must not happen is the preview NAVIGATING ITSELF away.
   * This document is the live runtime the parent drives; if an authored `<a href>`
   * unloads it, the parent has no way to bring it back, and "return to Edit with
   * state intact" (the fixed walkthrough) silently stops being true. So a link
   * that would replace this document has its default suppressed — and only that.
   */
  const onPreviewClickCapture = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const owner = target?.closest("[data-zc-node-id]")?.getAttribute("data-zc-owner");
    // A source shell is a visual reference, not a second live application in
    // the consumer. The dedicated "Open source" control is the only route out.
    if (owner === "global-template") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const anchor = target?.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href === "" || href.startsWith("#")) return; // in-page: harmless
    event.preventDefault();
  };

  /**
   * One insert point: the direct "+" add button PLUS a companion "⋯" that
   * opens the richer insert MENU (issue #256's "Add component…" AND "Paste
   * here", both always present). Two SIBLING `<button>`s inside a
   * non-interactive wrapper — never nested buttons.
   *
   * `isEnd` (issue #283) is true for the LAST insert point of a slot
   * (`index === children.length`) — the one this issue enlarges into a
   * labeled button (min-height 2rem, ≥3rem empty) with the dots companion
   * overlapping its trailing edge, porting the prototype's `.insert-end`
   * geometry. Every OTHER insert point (between two children, or before the
   * first) keeps the original slim dashed-bar markup untouched — an `empty`
   * slot's sole insert point is always ALSO the end point (there is nothing
   * to be "between"), so the two flags never disagree.
   */
  function insertPoint(
    target: InsertionTarget,
    label: string,
    flow: SlotFlow,
    empty: boolean,
    isEnd: boolean,
  ): JSX.Element {
    const position = empty ? `empty ${label}` : `${label}, position ${target.index + 1}`;
    const focusToken = insertMenuFocusToken(target);
    // Drop-target wiring (issue #258). The GROUP is the drop zone; its children
    // go inert during a drag (CSS, keyed off the canvas's `data-zc-dragging`),
    // so a child-crossing `dragleave` (null `relatedTarget`) can't wipe the
    // highlight. `dragover.preventDefault()` is what tells the browser this is a
    // valid drop point at all — omit it on invalid targets and the browser
    // refuses the drop there.
    const dropKeyStr = `${target.parentId ?? ""}:${target.slotId}:${target.index}`;
    const valid = isValidDropTarget(target);
    const dropHandlers = dragActive
      ? {
          onDragEnter: (event: DragEvent) => {
            if (!isValidDropTarget(target)) return;
            event.preventDefault();
            setDrop(dropKeyStr);
          },
          onDragOver: (event: DragEvent) => {
            if (!isValidDropTarget(target)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
            if (dropKeyRef.current !== dropKeyStr) setDrop(dropKeyStr);
          },
          onDragLeave: () => {
            if (dropKeyRef.current === dropKeyStr) setDrop(null);
          },
          onDrop: (event: DragEvent) => {
            const sourceNodeId =
              event.dataTransfer?.getData("text/plain") || dragSourceRef.current;
            if (!sourceNodeId || !isValidDropTarget(target)) return;
            event.preventDefault();
            // `dragend` still fires after this and clears the drag state
            // unconditionally — so the emit stays here, the cleanup stays there.
            onDropNode?.(sourceNodeId, target, event.altKey);
          },
        }
      : null;
    // The END point (#283) gets the enlarged `.zc-insert-end-btn` geometry —
    // full-width in column flow, compact/auto-width in row flow — with the
    // dots companion absolutely overlapping its trailing edge
    // (`.zc-insert-menu--end`). Every other insert point keeps the ORIGINAL
    // `.zc-insert-group--${flow}` / `.zc-insert--${flow}` markup untouched.
    // Toning (neutral dashed at rest, accent only on hover/focus-visible) is
    // shared via the base `.zc-insert` class either way — this issue changes
    // geometry, never color.
    const groupClass = isEnd
      ? `zc-insert-group zc-insert-end--${flow}`
      : `zc-insert-group zc-insert-group--${flow}`;
    const addButtonClass = isEnd
      ? `zc-insert zc-insert-end-btn${empty ? " zc-insert--empty" : ""}`
      : `zc-insert zc-insert--${flow}`;
    const menuButtonClass = isEnd ? "zc-insert-menu zc-insert-menu--end" : "zc-insert-menu";
    return h(
      "div",
      {
        key: dropKeyStr,
        class: groupClass,
        "data-zc-drop-valid": dragActive && valid ? "" : undefined,
        "data-zc-drop-active": dropKey === dropKeyStr ? "" : undefined,
        ...dropHandlers,
      },
      h(
        "button",
        {
          type: "button",
          class: addButtonClass,
          "data-zc-affordance": "",
          // Presentational/debug hook only — the click closes over the real target
          // object. Empty parent segment == the virtual root (a real node id is
          // never empty), so it cannot collide with a node literally named "root".
          "data-zc-insert": `${target.parentId ?? ""}:${target.slotId}:${target.index}`,
          // "Add component" (the END button's visible label) must be a SUBSTRING
          // of the accessible name — WCAG 2.5.3 Label in Name — so speech input
          // ("click Add component") resolves. The article "a" broke that match.
          "aria-label": `Add component to ${position}`,
          onClick: () => onRequestAdd(target),
        },
        h(PlusIcon, { class: "zc-insert-plus", width: 12, height: 12 }),
        // The visible "Add component" label is END-only (issue #283) — the
        // between-children bar stays icon-only, same as before.
        isEnd ? h("span", null, "Add component") : null,
      ),
      h(
        "button",
        {
          type: "button",
          class: menuButtonClass,
          "data-zc-affordance": "",
          "data-zc-focus-token": focusToken,
          "aria-label": `Insert options for ${position}`,
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            const rect = serializeRect((event.currentTarget as HTMLElement).getBoundingClientRect());
            onRequestInsertMenu(target, rect, focusToken);
          },
        },
        // 12px (icon ladder xs) — matches the host kebabs and the node-chrome
        // ellipsis below; 14 was off the 12/16/20/24 --spacing-icon-* ladder.
        h(EllipsisIcon, { width: 12, height: 12 }),
      ),
    );
  }

  /**
   * One slot's rendered children. In Edit mode an insert point is emitted at
   * EVERY addable index — before the first child, between each pair, and after
   * the last (the round-2 insert-at-index contract; never append-only).
   *
   * A `single` slot that already holds its one child has no addable index, so it
   * gets no insert point.
   */
  function renderSlotChildren(
    children: readonly CompositionNode[],
    target: InsertionTarget | undefined,
    label: string,
    flow: SlotFlow,
    single: boolean,
  ): ComponentChildren[] {
    // Source-owned slots have no target at all. The one exception is the
    // resolved outlet, which deliberately receives the LOCAL virtual-root
    // target even though it is projected inside a source component.
    if (!edit || !target) return children.map((child) => renderNode(child));

    const out: ComponentChildren[] = [];
    const addable = !single || children.length === 0;
    for (let index = 0; index <= children.length; index += 1) {
      if (addable) {
        // The LAST addable index (index === children.length) is the slot's
        // END point (issue #283) — an empty slot's only index (0) is always
        // also its end, so `empty` never disagrees with `isEnd`.
        out.push(
          insertPoint(
            { ...target, index },
            label,
            flow,
            children.length === 0,
            index === children.length,
          ),
        );
      }
      const child = children[index];
      if (child) out.push(renderNode(child));
    }
    return out;
  }

  /** The real component, with slot ids projected onto its real Preact props. */
  function renderComponent(node: CompositionNode, entry: ComposerRuntimeEntry): ComponentChildren {
    const definition = entry.manifest;
    const runtime = entry.runtime;
    // Defaults first, then the document's own props — the document always wins.
    // (`defaults`/`slots` are optional on a raw definition; see `manifestFor`.)
    const componentProps: Record<string, unknown> = {
      ...(definition.defaults ?? {}),
      ...safeProps(node.props),
    };
    // While inline-editing THIS node's field, render it with NO vdom text child:
    // the live text is owned imperatively (see the session layout effect), so a
    // re-render can never reset the caret. Exiting re-keys the body (below),
    // remounting it with the real value and leaving no duplicate text node.
    if (localNode(node) && inlineSession?.nodeId === node.id) componentProps[inlineSession.fieldKey] = "";
    const flow = slotFlow(node);
    const info = runtimeInfo(node);

    for (const slot of definition.slots ?? []) {
      const isProjectedOutlet =
        info.owner === "global-template" &&
        linked !== null &&
        node.id === linked.outlet.target.parentId &&
        slot.id === linked.outlet.target.slotId;
      const children = isProjectedOutlet ? document.root : (node.slots[slot.id] ?? []);
      const single = slot.cardinality === "single";
      const target = isProjectedOutlet
        ? { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }
        : info.owner === "local"
          ? { parentId: node.id, slotId: slot.id, index: 0 }
          : undefined;
      const rendered = renderSlotChildren(children, target, slot.label, flow, single);
      // A `single` slot takes the child ITSELF (not a 1-element array) so a
      // component that expects one VNode in a named prop gets exactly that —
      // and `undefined` when empty, never a truthy `[]` that would defeat a
      // component's own `left ?? fallback`.
      componentProps[slot.prop] = single ? rendered[0] : rendered;
    }

    return runtime.adapters?.render
      ? runtime.adapters.render(componentProps) as ComponentChildren
      : h(runtime.component as never, componentProps);
  }

  /**
   * An unknown / unsupported-version / structurally-invalid node. It stays
   * SELECTABLE and its payload is shown verbatim, never dropped — the document
   * keeps it and #245's recovery contract keeps it round-trippable.
   */
  function renderOpaque(node: CompositionNode, diagnostic: NodeDiagnostic): ComponentChildren {
    return h(
      "div",
      { class: "zc-opaque" },
      h(
        "p",
        { class: "zc-opaque-title" },
        "Unavailable component: ",
        h("code", null, node.componentId),
      ),
      h(
        "ul",
        { class: "zc-opaque-reasons" },
        diagnostic.reasons.map((reason, index) =>
          h("li", { key: `zc-reason-${index}` }, reason.message),
        ),
      ),
      h(
        "details",
        { class: "zc-opaque-payload" },
        h("summary", { "data-zc-affordance": "" }, "Preserved payload"),
        h("pre", null, JSON.stringify(node, null, 2)),
      ),
    );
  }

  function renderNode(node: CompositionNode): JSX.Element {
    const info = runtimeInfo(node);
    const isLocal = info.owner === "local";
    const entry = entryById.get(node.componentId);
    const diagnostic = classifyNode(node, manifest);
    const opaque = diagnostic.opaque || !entry;
    const label = entry?.manifest.title ?? node.componentId;
    const selected = isLocal && session.selectedId === node.id;
    // While the prose session holds this node, its body IS the raw-markdown
    // editable — the component is not rendered at all (see the "the editing
    // surface is OURS" note in `prose-inline-session.ts`).
    const proseEditing = isLocal && prose.mountedNodeId === node.id;

    const body: ComponentChildren = proseEditing
      ? prose.renderEditor()
      : opaque || !entry
        ? renderOpaque(node, diagnostic)
        : renderComponent(node, entry);

    // The SELECTED node's chrome gains a "⋯" trigger (issue #256) — every
    // other node's chrome stays exactly the bare label it always was (see
    // "the chrome is a keyed sibling" test: an unselected node's `.zc-chrome`
    // has no other class and no child elements). The label itself moves into
    // its own `aria-hidden` span only in the selected branch, so the trigger
    // button — the only focusable thing here — is never inside an
    // `aria-hidden` ancestor.
    // The drag grip (issue #258): shown ONLY on the SELECTED, non-opaque node
    // (opaque nodes are not draggable — same-slot reorder via the tree stays
    // their only movement), and only when a drop sink is wired. `dragstart`
    // sets the transfer data SYNCHRONOUSLY and DEFERS the drag-state mutation.
    const grip =
      isLocal && selected && onDropNode && !opaque
        ? h(
            "button",
            {
              key: "zc-chrome-grip",
              type: "button",
              class: "zc-chrome-grip",
              "data-zc-affordance": "",
              draggable: true,
              "aria-label": `Drag ${label} to move it`,
              onDragStart: (event: DragEvent) => {
                event.dataTransfer?.setData("text/plain", node.id);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
                const id = node.id;
                // Defer ALL state mutation to a macrotask — a synchronous
                // setState here cancels the native drag in Chromium (verified).
                setTimeout(() => beginDrag(id), 0);
              },
              onDragEnd: () => endDrag(),
            },
            h("span", { "aria-hidden": "true" }, "⠿"),
          )
        : null;

    const chromeContent: ComponentChildren = selected
      ? [
          grip,
          h("span", { key: "zc-chrome-label", "aria-hidden": "true" }, label),
          h(
            "button",
            {
              key: "zc-chrome-menu",
              type: "button",
              class: "zc-chrome-menu",
              "data-zc-affordance": "",
              "data-zc-focus-token": nodeMenuFocusToken(node.id),
              "aria-label": `Open menu for ${label}`,
              onClick: (event: MouseEvent) => {
                event.stopPropagation();
                const rect = serializeRect((event.currentTarget as HTMLElement).getBoundingClientRect());
                onRequestNodeMenu(node.id, rect, nodeMenuFocusToken(node.id));
              },
            },
            h(EllipsisIcon, { width: 12, height: 12 }),
          ),
        ]
      : label;

    return h(
      "div",
      {
        key: info.runtimeKey,
        class: `zc-node${isLocal ? "" : " zc-node--source"}`,
        "data-zc-node-id": node.id,
        "data-zc-owner": info.owner,
        "data-zc-runtime-key": info.runtimeKey,
        "data-zc-selected": selected ? "" : undefined,
        "data-zc-opaque": opaque ? "" : undefined,
      },
      // Both children are KEYED — see the DOM-identity note in the module header.
      edit && isLocal
        ? h(
            "span",
            { key: "zc-chrome", class: "zc-chrome", "aria-hidden": selected ? undefined : "true" },
            chromeContent,
          )
        : null,
      h(
        Fragment,
        // Keyed DIFFERENTLY in edit vs read mode: entering/exiting EITHER
        // session remounts the body, so the imperatively-managed editing DOM is
        // fully discarded on exit and can never leave a duplicate text node.
        {
          key:
            (isLocal && inlineSession?.nodeId === node.id) || proseEditing
              ? "zc-body-editing"
              : "zc-body",
        },
        h(
          NodeErrorBoundary,
          {
            // The owner-qualified key keeps a source failure boundary separate
            // from a colliding local node's boundary.
            nodeId: info.runtimeKey,
            // Host diagnostics retain local canonical ids; a source failure is
            // deliberately owner-qualified so it cannot be mistaken for a
            // mutable consumer node with the same raw id.
            reportNodeId: isLocal ? node.id : info.runtimeKey,
            componentId: node.componentId,
            // The DOCUMENT object, not the revision: a session-only message
            // (selection, theme, mode) keeps the same document reference, so
            // clicking around does not churn every latched error boundary.
            resetToken,
            onError: onNodeError,
          },
          body,
        ),
      ),
      !isLocal
        ? h(
            "span",
            { class: "zc-source-lock", "aria-hidden": "true" },
            "Linked source · locked",
          )
        : null,
    );
  }

  return h(
    "div",
    {
      ref: canvasRef,
      class: "zc-canvas",
      "data-composer-canvas": "",
      // The EFFECTIVE mode, so a restored prose draft keeps the Edit-mode
      // styling that goes with the Edit-mode handlers wired below.
      "data-mode": edit ? "edit" : "preview",
      // The CSS hook for the drag lifecycle (issue #258): while set, insert-point
      // children are `pointer-events: none` so a child-crossing `dragleave`
      // (null `relatedTarget` in Chromium) can't wipe the drop highlight.
      "data-zc-dragging": dragActive ? "" : undefined,
      onClickCapture: edit ? onClickCapture : onPreviewClickCapture,
      onKeyDownCapture: edit ? onKeyDownCapture : undefined,
      // Bubbling (not capture) so an active session's own `dblclick`
      // stopPropagation can keep word-select from restarting the session.
      onDblClick: edit ? onDblClick : undefined,
    },
    linked
      ? h(
          "div",
          { class: "zc-linked-frame", "data-zc-linked-frame": "", role: "status" },
          h("span", { class: "zc-linked-frame-title" }, "Linked Global template"),
          h("span", { class: "zc-linked-frame-detail" }, linked.sourceDocument.name),
          h("span", { class: "zc-linked-frame-outlet" }, `Outlet: ${linked.outlet.label || linked.outlet.id}`),
          h("span", { class: "zc-linked-frame-lock" }, "Locked"),
          h(
            "button",
            {
              type: "button",
              class: "zc-linked-frame-open",
              "data-zc-affordance": "",
              onClick: () => onOpenSource?.(linked.sourceRecordId),
            },
            "Open source",
          ),
        )
      : null,
    linked
      ? h(
          "section",
          { class: "zc-linked-shell", "data-zc-linked-shell": "", "aria-label": "Linked Global template" },
          renderSlotChildren(linked.sourceDocument.root, undefined, "linked source", "vertical", false),
        )
      : renderSlotChildren(
          document.root,
          { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 },
          "the document",
          "vertical",
          false,
        ),
    // The prose session's Save button and confirmation dialog. Both are
    // `position: fixed` in the IFRAME viewport (which is the canvas area), so
    // their place in the tree is irrelevant to layout — the canvas is simply
    // the one element guaranteed to be mounted whenever a session can exist.
    prose.renderChrome(),
  );
}

// ── Per-node error boundary ─────────────────────────────────────────────────

interface NodeErrorBoundaryProps {
  nodeId: string;
  reportNodeId?: string;
  componentId: string;
  /** Changing this clears a latched error — see `getDerivedStateFromProps`. */
  resetToken: unknown;
  onError?: (nodeId: string, message: string) => void;
  children?: ComponentChildren;
}

interface NodeErrorBoundaryState {
  error: string | null;
  token: unknown;
}

/**
 * Isolates a throwing component to its own node. A Composition can legitimately
 * hold props a component rejects (an older document, a hand-edited value, a prop
 * whose domain narrowed) — the whole canvas must not go blank because one node
 * threw. The failure is reported to the host, rendered in place as a RECOVERABLE
 * message, and retryable both by hand ("Retry") and automatically when the next
 * revision arrives.
 */
class NodeErrorBoundary extends Component<NodeErrorBoundaryProps, NodeErrorBoundaryState> {
  state: NodeErrorBoundaryState = { error: null, token: undefined };

  /**
   * Clears a latched error whenever a NEW DOCUMENT arrives, without remounting
   * the subtree — so fixing the offending prop in the inspector retries the
   * component, while an ordinary re-render (hover, selection, theme) leaves both
   * the error state AND the component's DOM node untouched.
   */
  static getDerivedStateFromProps(
    props: NodeErrorBoundaryProps,
    state: NodeErrorBoundaryState,
  ): Partial<NodeErrorBoundaryState> | null {
    if (props.resetToken !== state.token) return { error: null, token: props.resetToken };
    return null;
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setState({ error: message });
    this.props.onError?.(this.props.reportNodeId ?? this.props.nodeId, message);
  }

  render(): ComponentChildren {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return h(
      "div",
      { class: "zc-node-error", role: "status" },
      h(
        "p",
        { class: "zc-node-error-title" },
        "This component failed to render: ",
        h("code", null, this.props.componentId),
      ),
      h("p", { class: "zc-node-error-detail" }, error),
      h(
        "button",
        {
          type: "button",
          class: "zc-node-error-retry",
          "data-zc-affordance": "",
          onClick: () => this.setState({ error: null, token: this.props.resetToken }),
        },
        "Retry",
      ),
    );
  }
}
