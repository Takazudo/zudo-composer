// The Composer preview RENDERER: a `CompositionDocument` (pure JSON, received
// over the bridge) → real, production zudo-react components.
//
// Written with `h()` rather than JSX so the module keeps its `.ts` name: the
// preview route graph is checked by file name (see the Mapping preview
// boundary test), and nothing here needs JSX to stay readable.
//
// ── Trust boundary ───────────────────────────────────────────────────────────
// The document that arrives over the bridge is DATA. The component FUNCTIONS
// come from the injected trusted provider inside the iframe. A `componentId`
// is only ever used as a Map key — never as
// a module specifier, never evaluated.
//
// ── DOM identity (hard acceptance criterion) ─────────────────────────────────
// Toggling hover or selection must NEVER remount a component's DOM node. The
// canvas runs ONCE and follows its inputs through signals:
//
//   1. HOVER IS PURE CSS. There is no hover state at all — the chrome is
//      revealed by `.zc-node:hover > .zc-chrome`.
//   2. SELECTION AND MODE ARE BINDINGS. `data-zc-selected`, the chrome and the
//      insert points follow signals; the component body is a separate keyed
//      region they never touch, so Edit ⇄ Preview touches only the chrome.
//   3. EVERY NODE IS KEYED. Each slot is a keyed `For` (node wrappers by their
//      owner-qualified runtime key), and each body is a one-item `Keyed`
//      region keyed by `nodeRenderKey(runtimeKey, propsRevision)`. Pack
//      components receive plain values and run once, so a node REMOUNTS only
//      when its own props (or a single slot's emptiness) change; a sibling's
//      edit, a selection or a mode switch leaves it alone. Slot children reach
//      a container as a live region, so a child edit never remounts its
//      parent.
//
// Selection itself is a bare attribute swap (`data-zc-selected`) styled with
// `outline`, which is out-of-flow: it neither remounts nor reflows the node.

import { renderAssetDownloadMarkdown } from "../../../components/asset-download-markdown";
import {
  computed,
  ErrorBoundary,
  For,
  getScope,
  h,
  Show,
  signal,
  type Child,
  type ReadonlySignal,
  type Ref,
} from "@takazudo/zfb/zudo-react";
import { DragGripIcon, EllipsisIcon, PlusIcon } from "../../../components/icons";
import { toSignal, type MaybeSignal } from "../../../components/reactive";
import { Keyed, nodeRenderKey } from "../../../runtime";
import type {
  CompositionDocument,
  CompositionNode,
  InsertionTarget,
  JsonObject,
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
import { createProseInlineSession } from "./prose-inline-session";
import {
  RESERVED_PROP_KEYS,
  serializeRect,
  type PreviewLinkedSourceContext,
  type PreviewSession,
  type SerializedRect,
} from "./protocol";
import { slotFlow, type SlotFlow } from "./slot-flow";


// ── Menu focus tokens (issue Takazudo/zudo-sg#256) ──────────────────────────────────────────
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

/**
 * Read the deterministic token from the control currently focused in the
 * preview document. `document.activeElement` remains populated after focus
 * moves to the host page, so `hasFocus()` is part of this guard: without it a
 * later host-driven render could steal focus back into this iframe.
 */
export function activeFocusToken(): string | null {
  if (!document.hasFocus()) return null;
  return document.activeElement?.getAttribute(FOCUS_TOKEN_ATTR) || null;
}

// ── Inline text editing (issue Takazudo/zudo-sg#257) ────────────────────────────────────────
//
// A flag alone can't target the right text node: real components render
// decorations (`CtaButton` an arrow, `SectionHeading` an eyebrow/heading/intro).
// So the trusted, non-serializable `adapters.inlineEditor` (kept only in the
// provider runtime adapter) resolves the editable element inside a rendered
// component. MVP: at most ONE inline-editable field per component.
//
// The three verified prototype rules the session code below follows exactly:
//   - the editing element carries NO rendered text child (its content is set
//     imperatively via ref) so an unrelated re-render can never reset the caret;
//   - its body is KEYED differently in edit vs read mode, so exiting the session
//     remounts it and cannot leave a duplicate (imperatively-inserted) text node;
//   - `dblclick` inside an active session STOPS propagation (word-select must not
//     bubble to the canvas and restart the session, reverting the typing).
//
// The DOM helpers this session uses (`readEditableValue`, `placeCaretAtEnd`,
// `effectiveFieldValue`, …) live in `inline-edit-dom.ts` — epic Takazudo/zudo-sg#368 added a
// SECOND, explicit-save session (`prose-inline-session.ts`) that has to derive
// those answers identically, and one shared implementation is what keeps the
// Takazudo/zudo-sg#288 ground-check sound. This session's own behaviour is unchanged by that
// move, and the two sessions never share state.

/** An active on-canvas editing session — LOCAL renderer state, never persisted. */
interface InlineSessionState {
  nodeId: string;
  /** The edited node's component, captured at entry so the session never re-reads the document. */
  componentId: string;
  fieldKey: string;
  multiline: boolean;
  /** The value the field held when the session opened. Set imperatively. */
  initialValue: string;
  /**
   * The document revision on screen when the session was ENTERED (issue Takazudo/zudo-sg#288).
   * Carried on the session and stamped on the eventual commit INSTEAD OF the
   * revision on screen at commit time — a mid-edit render that bumps the
   * revision must make a later commit fail the host's staleness gate, not
   * re-stamp itself as fresh just because it happened to be sent after that
   * render landed.
   */
  startRevision: number;
}

/**
 * zudo-react's own trusted spellings: `rawHtml` is its unsanitized HTML sink
 * and `on:*` its listener syntax. Neither may come from document data.
 */
const ZUDO_REACT_RESERVED_PROP = /^(?:rawHtml$|on:)/u;

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
    if (RESERVED_PROP_KEYS.has(name) || ZUDO_REACT_RESERVED_PROP.test(name)) continue;
    out[name] = value;
  }
  return out;
}

export interface CompositionCanvasProps {
  /** The document on screen. A signal follows the host's renders in place. */
  document: MaybeSignal<CompositionDocument>;
  /** Canonical consumer identity for owner-qualified runtime keys. */
  localRecordId: MaybeSignal<string>;
  /** Optional resolved, read-only Global-template source/outlet context. */
  linked?: MaybeSignal<PreviewLinkedSourceContext | null>;
  /** The trusted provider view retaining real component functions. */
  provider: ComposerComponentProvider;
  session: MaybeSignal<PreviewSession>;
  /**
   * The document revision on screen (issue Takazudo/zudo-sg#288). An inline-edit session
   * captures this at the moment it is ENTERED and carries it forward as its
   * `startRevision`, stamping it on the eventual commit instead of whatever
   * revision happens to be on screen when the user finishes typing — see
   * `onCommitInlineEdit`. Optional (default `0`) so mounts/tests that never
   * inline-edit need not supply it.
   */
  revision?: MaybeSignal<number>;
  /** A node (or the empty canvas, `null`) was activated in Edit mode. */
  onSelect: (nodeId: string | null) => void;
  /** An insert point was activated. Carries Takazudo/zudo-sg#245's insert-at-index target and the button's rect. */
  onRequestAdd: (target: InsertionTarget, rect?: SerializedRect) => void;
  /** Explicit linked-source navigation — never a source-node selection. */
  onOpenSource?: (sourceRecordId: string) => void;
  /** The SELECTED node's chrome "⋯" was activated (issue Takazudo/zudo-sg#256). */
  onRequestNodeMenu: (nodeId: string, rect: SerializedRect, focusToken: string) => void;
  /** An insert point's "⋯" was activated (issue Takazudo/zudo-sg#256). */
  onRequestInsertMenu: (target: InsertionTarget, rect: SerializedRect, focusToken: string) => void;
  /**
   * An inline-editing session committed a value (issue Takazudo/zudo-sg#257). `documentRevision`
   * is the SESSION-START revision (issue Takazudo/zudo-sg#288) — the `revision` prop's value
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
   * A cross-slot drag & drop completed on the canvas (issue Takazudo/zudo-sg#258). `copy` is
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

function ownerSegment(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)!.toString(16).padStart(6, "0")).join("");
}

function runtimeKey(owner: RuntimeOwner, recordId: string, nodeId: string): string {
  return `${owner}:${ownerSegment(recordId)}:node:${ownerSegment(nodeId)}`;
}

/** One entry of a rendered slot: an insert point or a node wrapper. */
type SlotItem =
  | {
      kind: "insert";
      key: string;
      target: InsertionTarget;
      label: string;
      flow: SlotFlow;
      empty: boolean;
      isEnd: boolean;
    }
  | {
      kind: "node";
      /** Injective across a local/source collision, safe for keyed regions and DOM identity. */
      key: string;
      node: CompositionNode;
      owner: RuntimeOwner;
    };

interface BodyInputs {
  key: string;
  proseEditing: boolean;
  emptySingles: ReadonlySet<string>;
}

type NodeItem = Extract<SlotItem, { kind: "node" }>;
type InsertItem = Extract<SlotItem, { kind: "insert" }>;

/**
 * Renders a whole Composition. Every node gets a stable wrapper carrying its id;
 * in Edit mode it also gets out-of-flow chrome and an insert point at EVERY
 * addable index of EVERY declared slot.
 */
export function CompositionCanvas(props: CompositionCanvasProps): Child {
  const {
    provider,
    onSelect,
    onRequestAdd,
    onOpenSource,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onCommitInlineEdit,
    onDropNode,
    onNodeError,
  } = props;
  const scope = getScope();
  const documentSignal = toSignal(props.document);
  const localRecordId = toSignal(props.localRecordId);
  const linkedSignal = toSignal(props.linked ?? null);
  const sessionSignal = toSignal(props.session);
  const revisionSignal = toSignal(props.revision ?? 0);
  const mode = computed(() => sessionSignal.value.mode);
  const selectedId = computed(() => sessionSignal.value.selectedId);

  const entryById = new Map(provider.runtimeEntries.map((entry) => [entry.manifest.id, entry]));
  const manifest = provider.catalog;
  /** Opaque by the same verdict the body is drawn with. */
  const isOpaque = (node: CompositionNode): boolean =>
    !entryById.has(node.componentId) || classifyNode(node, manifest).opaque;

  // A node's props revision: bumped whenever the inputs its body is built from
  // change, so the body's `nodeRenderKey` remounts it — and only then.
  const propsRevisions = new Map<string, { signature: string; revision: number }>();
  const propsRevision = (key: string, signature: string): number => {
    const known = propsRevisions.get(key);
    if (known?.signature === signature) return known.revision;
    const revision = (known?.revision ?? 0) + 1;
    propsRevisions.set(key, { signature, revision });
    return revision;
  };

  // ── Inline editing session (issue Takazudo/zudo-sg#257) ───────────────────────────────────
  // LOCAL renderer state; never travels over the bridge and never mutates the
  // document until a commit routes through the host's `updateProps`.
  const canvasRef: Ref<HTMLDivElement> = { current: null };
  let editable: HTMLElement | null = null;
  let finishing = false;

  const inlineSession = signal<InlineSessionState | null>(null);
  // Mirrored for the imperative event listeners (attached to a real component
  // DOM node, outside the renderer), which must see the live session without
  // subscribing to it.
  let sessionNow: InlineSessionState | null = null;
  const setSession = (next: InlineSessionState | null): void => {
    sessionNow = next;
    inlineSession.value = next;
  };

  const commitInline = (): void => {
    const active = sessionNow;
    if (!active || finishing) return;
    finishing = true;
    const el = editable;
    const value = el
      ? readNormalizedEditableValue(el, active.multiline, active.initialValue)
      : active.initialValue;
    // A NO-OP commit (value unchanged from session start) must not reach the
    // host: it mutates nothing, yet still advances the document revision. That
    // is not merely wasteful — a spurious commit-of-the-seed (a blur fired the
    // instant the session opened, before any typing, which then re-enters a
    // fresh session) would bump `lastDocRevisionRef` and make the user's real
    // follow-up commit fail the host's SESSION-START staleness gate (issue
    // Takazudo/zudo-sg#288), silently dropping the edit. Skipping unchanged values keeps the
    // session-start revision contract sound across a re-entered session.
    if (value !== active.initialValue) {
      // Stamped with the SESSION-START revision (issue Takazudo/zudo-sg#288) — see `InlineSessionState`.
      onCommitInlineEdit?.(active.nodeId, active.fieldKey, value, active.startRevision);
    }
    setSession(null);
  };

  const cancelInline = (): void => {
    if (!sessionNow || finishing) return;
    finishing = true;
    setSession(null);
  };

  const enterInlineSession = (nodeId: string): boolean => {
    if (sessionNow) return false;
    const targetNode = findNodeById(documentSignal.value.root, nodeId);
    if (!targetNode) return false;
    const entry = entryById.get(targetNode.componentId);
    const editableField = inlineEditableForEntry(entry);
    if (!editableField || !entry) return false;
    // A `markdown-source` field belongs to the explicit-save prose session
    // (Takazudo/zudo-sg#375), which is entered FIRST by `enterAnyInlineSession` below. This
    // guard is what keeps the auto-commit path from ever claiming one.
    if (editableField.mode !== "plain") return false;
    const initialValue = effectiveFieldValue(targetNode, entry, editableField.field);
    setSession({
      nodeId,
      componentId: targetNode.componentId,
      fieldKey: editableField.field,
      multiline: editableField.multiline,
      initialValue,
      startRevision: revisionSignal.value,
    });
    return true;
  };

  // ── Explicit-save prose session (issue Takazudo/zudo-sg#375, epic Takazudo/zudo-sg#368) ───────────────────
  // The PARALLEL path for `inlineEdit.mode: "markdown-source"` fields. It owns
  // its own state machine, its own editable surface, and its own iframe-side
  // chrome; the auto-commit session above is untouched by it.
  const prose = createProseInlineSession(scope, {
    document: documentSignal,
    structure: computed(() => [linkedSignal.value, localRecordId.value]),
    entryById,
    revision: revisionSignal,
    mode,
    canvasRef,
    // The same verdict the node body is drawn with — an opaque node shows its
    // preserved payload read-only and is never editable.
    isOpaque,
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
  const edit = computed(() => mode.value === "edit" || prose.editModeOverride.value);

  /** Either session holds the canvas — the imperative handlers below check both. */
  const anySessionActive = (): boolean => sessionNow !== null || prose.activeRef.current;

  // Set up (and tear down) the imperative contentEditable when a session opens.
  // The effect runs after the keyed-body remount has committed the fresh
  // (empty-field) component DOM, so the caret lands in the element the user
  // sees. Content is set imperatively here — never as a rendered child.
  const sessionKey = computed(() => {
    const active = inlineSession.value;
    return active ? `${active.nodeId}\u0000${active.fieldKey}` : null;
  });
  scope.effect(() => {
    if (sessionKey.value === null) return undefined;
    const active = sessionNow;
    if (!active) return undefined;
    finishing = false;

    const wrapper = canvasRef.current?.querySelector<HTMLElement>(
      `[data-zc-owner="local"][data-zc-node-id="${escapeAttrValue(active.nodeId)}"]`,
    );
    const componentRoot = wrapper
      ? (Array.from(wrapper.children).find((c) => !c.classList.contains("zc-chrome")) as
          | HTMLElement
          | undefined)
      : undefined;
    const resolve = inlineEditableForEntry(entryById.get(active.componentId))?.resolveElement;
    const el = componentRoot && resolve ? resolve(componentRoot) : null;
    if (!el) {
      // The adapter could not resolve a text region — abandon rather than trap
      // the user in a broken editor.
      setSession(null);
      return undefined;
    }
    editable = el;

    const ownerDoc = el.ownerDocument;
    el.setAttribute(INLINE_EDITING_ATTR, "");
    el.setAttribute("contenteditable", active.multiline ? "true" : "plaintext-only");
    // Protect decoration islands (e.g. CtaButton's aria-hidden arrow) so a caret
    // can't wander into them and so `readEditableValue` can exclude them.
    el.querySelectorAll<HTMLElement>('[aria-hidden="true"]').forEach((d) =>
      d.setAttribute("contenteditable", "false"),
    );
    // Content set IMPERATIVELY, and BEFORE any decoration so the label sits ahead
    // of a trailing arrow. The component rendered this field empty, so the
    // renderer never manages (or resets) this text node.
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
      if (editable === el) editable = null;
    };
  });

  // Switching to Preview mid-edit COMMITS the draft (defined, tested behavior).
  // The keyed body is not remounted by a mere mode change, so the live editable
  // is still attached here and `commitInline` reads its current text.
  let previousMode: PreviewSession["mode"] | null = null;
  scope.effect(() => {
    const current = mode.value;
    const previous = previousMode;
    previousMode = current;
    if (previous !== null && previous !== "preview" && current === "preview" && sessionNow) {
      commitInline();
    }
  });

  // Cancel the session outright when the GROUND MOVES under it (issue Takazudo/zudo-sg#288):
  // an incoming render mid-edit that changes the value of the field actually
  // being edited means a concurrent change landed while the user was typing —
  // the session is abandoned rather than let the user keep typing into a
  // field whose eventual commit is either doomed to fail the host's revision
  // gate or, worse, could coincidentally match. Cancelling remounts the keyed
  // body (see `NodeView`), so the editor never sits there showing text that
  // no longer reflects the document. A render that leaves this field alone
  // (an edit elsewhere in the document) does NOT cancel — the session and the
  // stale-but-correctly-gated commit path (see `commitInline`) both survive
  // that case unchanged. Keyed on `document` identity alone: `mode`-only
  // session updates keep the SAME document reference (`applyInbound`,
  // `snapshot-store.ts`), so this effect only ever fires for an actual render.
  let previousDocument: CompositionDocument | null = null;
  scope.effect(() => {
    const document = documentSignal.value;
    const previous = previousDocument;
    previousDocument = document;
    const active = sessionNow;
    if (!active || previous === null || previous === document) return;
    const targetNode = findNodeById(document.root, active.nodeId);
    const entry = targetNode ? entryById.get(targetNode.componentId) : undefined;
    const currentValue = effectiveFieldValue(targetNode, entry, active.fieldKey);
    if (!targetNode || currentValue !== active.initialValue) cancelInline();
  });

  // ── Drag & drop (issue Takazudo/zudo-sg#258) ──────────────────────────────────────────────
  // LOCAL renderer state; only the resulting `{ sourceNodeId, target, copy }`
  // ever crosses the bridge (the host revalidates + applies). The three verified
  // Chromium footguns the code below fixes EXACTLY (see the prototype README):
  //   - `dragstart` calls `setData` SYNCHRONOUSLY and DEFERS every state mutation
  //     (a synchronous state change in dragstart cancels the native drag in Chromium);
  //   - while dragging, insert-point CHILDREN are `pointer-events: none` (CSS,
  //     keyed off `data-zc-dragging`) — a child-crossing `dragleave` has a null
  //     `relatedTarget` in Chromium DnD and would otherwise wipe the highlight;
  //   - `dragend` clears the drag state UNCONDITIONALLY (a drop OR a cancel).
  const dragSourceId = signal<string | null>(null);
  const dropKey = signal<string | null>(null);

  const beginDrag = (sourceNodeId: string): void => {
    dragSourceId.value = sourceNodeId;
  };
  const endDrag = (): void => {
    dragSourceId.value = null;
    dropKey.value = null;
  };

  // The dragged node's own subtree ids — every insert point inside them is an
  // INVALID target (dropping there would orphan the subtree; the host's cycle
  // guard would reject it anyway, so the highlight simply excludes them).
  const draggedIds = computed(() => {
    const sourceId = dragSourceId.value;
    if (!sourceId) return null;
    const source = findNodeById(documentSignal.value.root, sourceId);
    if (!source) return null;
    const ids = new Set<string>();
    const walk = (n: CompositionNode): void => {
      ids.add(n.id);
      for (const children of Object.values(n.slots)) for (const child of children ?? []) walk(child);
    };
    walk(source);
    return ids;
  });

  const dragActive = computed(() => dragSourceId.value !== null);

  /** A drop target is valid unless it sits inside the dragged subtree. */
  const isValidDropTarget = (target: InsertionTarget): boolean =>
    dragActive.value && !(target.parentId !== null && (draggedIds.value?.has(target.parentId) ?? false));

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
      nodeId === selectedId.value &&
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
   * One slot's rendered entries. In Edit mode an insert point is emitted at
   * EVERY addable index — before the first child, between each pair, and after
   * the last (the round-2 insert-at-index contract; never append-only).
   *
   * A `single` slot that already holds its one child has no addable index, so it
   * gets no insert point.
   */
  function slotItems(
    children: readonly CompositionNode[],
    target: InsertionTarget | undefined,
    label: string,
    flow: SlotFlow,
    single: boolean,
    owner: RuntimeOwner,
    recordId: string,
    editing: boolean,
  ): SlotItem[] {
    const nodeItem = (node: CompositionNode): SlotItem => ({
      kind: "node",
      key: runtimeKey(owner, recordId, node.id),
      node,
      owner,
    });
    // Source-owned slots have no target at all. The one exception is the
    // resolved outlet, which deliberately receives the LOCAL virtual-root
    // target even though it is projected inside a source component.
    if (!editing || !target) return children.map(nodeItem);

    const out: SlotItem[] = [];
    const addable = !single || children.length === 0;
    for (let index = 0; index <= children.length; index += 1) {
      if (addable) {
        const at = { ...target, index };
        // The LAST addable index (index === children.length) is the slot's
        // END point (issue Takazudo/zudo-sg#283) — an empty slot's only index (0) is always
        // also its end, so `empty` never disagrees with `isEnd`.
        out.push({
          kind: "insert",
          key: `insert:${dropKeyFor(at)}`,
          target: at,
          label,
          flow,
          empty: children.length === 0,
          isEnd: index === children.length,
        });
      }
      const child = children[index];
      if (child) out.push(nodeItem(child));
    }
    return out;
  }

  /** A slot's live region: retained keys keep their DOM, scope and focus. */
  function SlotRegion(regionProps: { items: ReadonlySignal<readonly SlotItem[]> }): Child {
    return h(For<SlotItem>, {
      each: regionProps.items,
      by: (item: SlotItem) => item.key,
      children: (item: ReadonlySignal<SlotItem>) =>
        item.value.kind === "insert"
          ? h(InsertPoint, { item: item as ReadonlySignal<InsertItem> })
          : h(NodeView, { item: item as ReadonlySignal<NodeItem> }),
    });
  }

  /**
   * One insert point: the direct "+" add button PLUS a companion "⋯" that
   * opens the richer insert MENU (issue Takazudo/zudo-sg#256's "Add component…" AND "Paste
   * here", both always present). Two SIBLING `<button>`s inside a
   * non-interactive wrapper — never nested buttons.
   *
   * `isEnd` (issue Takazudo/zudo-sg#283) is true for the LAST insert point of a slot
   * (`index === children.length`) — the one this issue enlarges into a
   * labeled button (min-height 2rem, ≥3rem empty) with the dots companion
   * overlapping its trailing edge, porting the prototype's `.insert-end`
   * geometry. Every OTHER insert point (between two children, or before the
   * first) keeps the original slim dashed-bar markup untouched — an `empty`
   * slot's sole insert point is always ALSO the end point (there is nothing
   * to be "between"), so the two flags never disagree.
   */
  function InsertPoint(pointProps: { item: ReadonlySignal<InsertItem> }): Child {
    const { item } = pointProps;
    const position = computed(() => {
      const { empty, label, target } = item.value;
      return empty ? `empty ${label}` : `${label}, position ${target.index + 1}`;
    });
    const dropKeyStr = computed(() => dropKeyFor(item.value.target));
    // The END point (Takazudo/zudo-sg#283) gets the enlarged `.zc-insert-end-btn` geometry —
    // full-width in column flow, compact/auto-width in row flow — with the
    // dots companion absolutely overlapping its trailing edge
    // (`.zc-insert-menu--end`). Every other insert point keeps the ORIGINAL
    // `.zc-insert-group--${flow}` / `.zc-insert--${flow}` markup untouched.
    // Toning (neutral dashed at rest, accent only on hover/focus-visible) is
    // shared via the base `.zc-insert` class either way — this issue changes
    // geometry, never color.
    const groupClass = computed(() => {
      const { isEnd, flow } = item.value;
      return isEnd ? `zc-insert-group zc-insert-end--${flow}` : `zc-insert-group zc-insert-group--${flow}`;
    });
    const addButtonClass = computed(() => {
      const { isEnd, flow, empty } = item.value;
      return isEnd ? `zc-insert zc-insert-end-btn${empty ? " zc-insert--empty" : ""}` : `zc-insert zc-insert--${flow}`;
    });
    const menuButtonClass = computed(() => (item.value.isEnd ? "zc-insert-menu zc-insert-menu--end" : "zc-insert-menu"));
    const isEnd = computed(() => item.value.isEnd);
    // Drop-target wiring (issue Takazudo/zudo-sg#258). The GROUP is the drop zone; its children
    // go inert during a drag (CSS, keyed off the canvas's `data-zc-dragging`),
    // so a child-crossing `dragleave` (null `relatedTarget`) can't wipe the
    // highlight. `dragover.preventDefault()` is what tells the browser this is a
    // valid drop point at all — omit it on invalid targets and the browser
    // refuses the drop there. Outside a drag every handler is inert.
    return h(
      "div",
      {
        class: groupClass,
        "data-zc-drop-valid": computed(() => (dragActive.value && isValidDropTarget(item.value.target) ? "" : null)),
        "data-zc-drop-active": computed(() => (dropKey.value === dropKeyStr.value ? "" : null)),
        "on:dragenter": (event: DragEvent) => {
          if (!isValidDropTarget(item.value.target)) return;
          event.preventDefault();
          dropKey.value = dropKeyStr.value;
        },
        "on:dragover": (event: DragEvent) => {
          if (!isValidDropTarget(item.value.target)) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
          if (dropKey.value !== dropKeyStr.value) dropKey.value = dropKeyStr.value;
        },
        "on:dragleave": () => {
          if (!dragActive.value) return;
          if (dropKey.value === dropKeyStr.value) dropKey.value = null;
        },
        "on:drop": (event: DragEvent) => {
          if (!dragActive.value) return;
          const sourceNodeId = event.dataTransfer?.getData("text/plain") || dragSourceId.value;
          const target = item.value.target;
          if (!sourceNodeId || !isValidDropTarget(target)) return;
          event.preventDefault();
          // `dragend` still fires after this and clears the drag state
          // unconditionally — so the emit stays here, the cleanup stays there.
          onDropNode?.(sourceNodeId, target, event.altKey);
        },
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
          "data-zc-insert": dropKeyStr,
          // "Add component" (the END button's visible label) must be a SUBSTRING
          // of the accessible name — WCAG 2.5.3 Label in Name — so speech input
          // ("click Add component") resolves. The article "a" broke that match.
          "aria-label": computed(() => `Add component to ${position.value}`),
          "on:click": (event: MouseEvent) =>
            onRequestAdd(item.value.target, serializeRect((event.currentTarget as HTMLElement).getBoundingClientRect())),
        },
        h(PlusIcon, { class: "zc-insert-plus", width: 12, height: 12 }),
        // The visible "Add component" label is END-only (issue Takazudo/zudo-sg#283) — the
        // between-children bar stays icon-only, same as before.
        h(Show, { when: isEnd, children: () => h("span", null, "Add component") }),
      ),
      h(
        "button",
        {
          type: "button",
          class: menuButtonClass,
          "data-zc-affordance": "",
          "data-zc-focus-token": computed(() => insertMenuFocusToken(item.value.target)),
          "aria-label": computed(() => `Insert options for ${position.value}`),
          "on:click": (event: MouseEvent) => {
            event.stopPropagation();
            const rect = serializeRect((event.currentTarget as HTMLElement).getBoundingClientRect());
            const target = item.value.target;
            onRequestInsertMenu(target, rect, insertMenuFocusToken(target));
          },
        },
        // 12px (icon ladder xs) — matches the host kebabs and the node-chrome
        // ellipsis below; 14 was off the 12/16/20/24 --spacing-icon-* ladder.
        h(EllipsisIcon, { width: 12, height: 12 }),
      ),
    );
  }

  /**
   * An unknown / unsupported-version / structurally-invalid node. It stays
   * SELECTABLE and its payload is shown verbatim, never dropped — the document
   * keeps it and Takazudo/zudo-sg#245's recovery contract keeps it round-trippable.
   */
  function renderOpaque(node: CompositionNode): Child {
    const diagnostic = classifyNode(node, manifest);
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
        diagnostic.reasons.map((reason) => h("li", null, reason.message)),
      ),
      h(
        "details",
        { class: "zc-opaque-payload" },
        h("summary", { "data-zc-affordance": "" }, "Preserved payload"),
        h("pre", null, JSON.stringify(node, null, 2)),
      ),
    );
  }

  /** What a node's slot holds right now: projected outlet, local target and the owning record. */
  function slotSource(item: NodeItem, slotId: string) {
    const { node, owner } = item;
    const linked = linkedSignal.value;
    const projected =
      owner === "global-template" &&
      linked !== null &&
      node.id === linked.outlet.target.parentId &&
      slotId === linked.outlet.target.slotId;
    if (projected) {
      return {
        children: documentSignal.value.root,
        target: { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 } as InsertionTarget,
        owner: "local" as RuntimeOwner,
        recordId: localRecordId.value,
      };
    }
    return {
      children: node.slots[slotId] ?? [],
      target: owner === "local" ? ({ parentId: node.id, slotId, index: 0 } as InsertionTarget) : undefined,
      owner,
      recordId: owner === "local" ? localRecordId.value : (linked?.sourceRecordId ?? ""),
    };
  }

  /** The real component, with slot regions projected onto its real props. */
  function renderComponent(item: ReadonlySignal<NodeItem>, entry: ComposerRuntimeEntry, emptySingles: ReadonlySet<string>): Child {
    const { node } = item.value;
    const definition = entry.manifest;
    const runtime = entry.runtime;
    // Defaults first, then the document's own props — the document always wins.
    // (`defaults`/`slots` are optional on a raw definition; see `manifestFor`.)
    const componentProps: Record<string, unknown> = {
      ...(definition.defaults ?? {}),
      ...safeProps(node.props),
    };
    // While inline-editing THIS node's field, render it with an EMPTY field:
    // the live text is owned imperatively (see the session effect), so nothing
    // the renderer does can reset the caret. Exiting re-keys the body,
    // remounting it with the real value and leaving no duplicate text node.
    const active = inlineSession.value;
    if (item.value.owner === "local" && active?.nodeId === node.id) componentProps[active.fieldKey] = "";

    for (const slot of definition.slots ?? []) {
      const single = slot.cardinality === "single";
      const items = computed(() => {
        const current = item.value;
        const source = slotSource(current, slot.id);
        return slotItems(source.children, source.target, slot.label, slotFlow(current.node), single, source.owner, source.recordId, edit.value);
      });
      // A `single` slot takes the region ITSELF (not a 1-element array) so a
      // component that expects one child in a named prop gets exactly that —
      // and `undefined` when empty, never a truthy value that would defeat a
      // component's own `left ?? fallback`. Its emptiness is part of the
      // node's render key, so it is always current.
      componentProps[slot.prop] = single && emptySingles.has(slot.id)
        ? undefined
        : h(SlotRegion, { items });
    }

    return renderAssetDownloadMarkdown(definition, componentProps, (chunk) => runtime.adapters?.render
      ? runtime.adapters.render(chunk) as Child
      : h(runtime.component as never, chunk));
  }

  /** The node's body: the component (or its payload), isolated by its own boundary. */
  function NodeBody(bodyProps: { item: ReadonlySignal<NodeItem>; proseEditing: boolean; emptySingles: ReadonlySet<string> }): Child {
    const { item, proseEditing, emptySingles } = bodyProps;
    const { node, owner, key } = item.value;
    const isLocal = owner === "local";
    // While the prose session holds this node, its body IS the raw-markdown
    // editable — the component is not rendered at all (see the "the editing
    // surface is OURS" note in `prose-inline-session.ts`).
    const entry = entryById.get(node.componentId);
    const body = (): Child => proseEditing
      ? prose.renderEditor()
      : isOpaque(node) || !entry
        ? renderOpaque(node)
        : renderComponent(item, entry, emptySingles);
    return h(ErrorBoundary, {
      children: body,
      fallback: (error: unknown, reset: () => void) => h(NodeErrorFallback, {
        // Host diagnostics retain local canonical ids; a source failure is
        // deliberately owner-qualified so it cannot be mistaken for a
        // mutable consumer node with the same raw id.
        reportNodeId: isLocal ? node.id : key,
        componentId: node.componentId,
        error,
        reset,
      }),
    });
  }

  /**
   * Isolates a throwing component to its own node. A Composition can legitimately
   * hold props a component rejects (an older document, a hand-edited value, a prop
   * whose domain narrowed) — the whole canvas must not go blank because one node
   * threw. The failure is reported to the host, rendered in place as a RECOVERABLE
   * message, and retryable both by hand ("Retry") and automatically when the next
   * document arrives.
   */
  function NodeErrorFallback(fallbackProps: { reportNodeId: string; componentId: string; error: unknown; reset: () => void }): Child {
    const { reportNodeId, componentId, error, reset } = fallbackProps;
    const message = error instanceof Error ? error.message : String(error);
    onNodeError?.(reportNodeId, message);
    // A NEW DOCUMENT (not the revision: a session-only message keeps the same
    // document reference) retries the component; selection, theme and mode
    // changes leave the latched error alone.
    const resetToken = computed(() => [documentSignal.value, linkedSignal.value?.sourceDocument] as const);
    const [initialDocument, initialSource] = resetToken.value;
    getScope().effect(() => {
      const [document, source] = resetToken.value;
      if (document !== initialDocument || source !== initialSource) reset();
    });
    return h(
      "div",
      { class: "zc-node-error", role: "status" },
      h(
        "p",
        { class: "zc-node-error-title" },
        "This component failed to render: ",
        h("code", null, componentId),
      ),
      h("p", { class: "zc-node-error-detail" }, message),
      h(
        "button",
        {
          type: "button",
          class: "zc-node-error-retry",
          "data-zc-affordance": "",
          "on:click": () => reset(),
        },
        "Retry",
      ),
    );
  }

  /** One node's stable wrapper: chrome bindings plus its keyed body region. */
  function NodeView(viewProps: { item: ReadonlySignal<NodeItem> }): Child {
    const { item } = viewProps;
    const { owner, key } = item.value;
    const nodeId = item.value.node.id;
    const isLocal = owner === "local";
    const node = computed(() => item.value.node);
    const opaque = computed(() => isOpaque(node.value));
    const label = computed(() => entryById.get(node.value.componentId)?.manifest.title ?? node.value.componentId);
    const selected = computed(() => isLocal && selectedId.value === nodeId);
    const proseEditing = computed(() => isLocal && prose.mountedNodeId.value === nodeId);
    const plainEditing = computed(() => isLocal && inlineSession.value?.nodeId === nodeId);
    const emptySingles = computed(() => {
      const current = item.value;
      const empty = new Set<string>();
      const entry = entryById.get(current.node.componentId);
      for (const slot of entry?.manifest.slots ?? []) {
        if (slot.cardinality !== "single") continue;
        const source = slotSource(current, slot.id);
        if (source.children.length === 0 && !(edit.value && source.target)) empty.add(slot.id);
      }
      return empty;
    });
    // The body's inputs. A change to any of them is a new props revision.
    const body = computed((): BodyInputs => {
      const current = node.value;
      const editing = plainEditing.value || proseEditing.value;
      const singles = [...emptySingles.value].sort();
      const signature = JSON.stringify([
        current.componentId,
        current.componentVersion,
        current.props,
        opaque.value ? current : null,
        singles,
        plainEditing.value ? inlineSession.value?.fieldKey : null,
        proseEditing.value,
      ]);
      // Keyed DIFFERENTLY in edit vs read mode: entering/exiting EITHER
      // session remounts the body, so the imperatively-managed editing DOM is
      // fully discarded on exit and can never leave a duplicate text node.
      return {
        key: `${nodeRenderKey(key, propsRevision(key, signature))}|${editing ? "zc-body-editing" : "zc-body"}`,
        proseEditing: proseEditing.value,
        emptySingles: emptySingles.value,
      };
    });

    // The SELECTED node's chrome gains a "⋯" trigger (issue Takazudo/zudo-sg#256) — every
    // other node's chrome stays exactly the bare label it always was (an
    // unselected node's `.zc-chrome` has no other class and no child
    // elements). The label itself moves into its own `aria-hidden` span only
    // in the selected branch, so the trigger button — the only focusable thing
    // here — is never inside an `aria-hidden` ancestor.
    // The drag grip (issue Takazudo/zudo-sg#258): shown ONLY on the SELECTED, non-opaque node
    // (opaque nodes are not draggable — same-slot reorder via the tree stays
    // their only movement), and only when a drop sink is wired. `dragstart`
    // sets the transfer data SYNCHRONOUSLY and DEFERS the drag-state mutation.
    const grip = (): Child =>
      h(
        "button",
        {
          type: "button",
          class: "zc-chrome-grip",
          "data-zc-affordance": "",
          draggable: true,
          "aria-label": computed(() => `Drag ${label.value} to move it`),
          "on:dragstart": (event: DragEvent) => {
            event.dataTransfer?.setData("text/plain", nodeId);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
            // Defer ALL state mutation to a macrotask — a synchronous state
            // change here cancels the native drag in Chromium (verified).
            setTimeout(() => beginDrag(nodeId), 0);
          },
          "on:dragend": () => endDrag(),
        },
        h(DragGripIcon, { width: 12, height: 12 }),
      );
    const showGrip = computed(() => onDropNode !== undefined && !opaque.value);
    const selectedChrome = (): Child => [
      h(Show, { when: showGrip, children: grip }),
      h("span", { "aria-hidden": "true" }, label),
      h(
        "button",
        {
          type: "button",
          class: "zc-chrome-menu",
          "data-zc-affordance": "",
          "data-zc-focus-token": nodeMenuFocusToken(nodeId),
          "aria-label": computed(() => `Open menu for ${label.value}`),
          "on:click": (event: MouseEvent) => {
            event.stopPropagation();
            const rect = serializeRect((event.currentTarget as HTMLElement).getBoundingClientRect());
            onRequestNodeMenu(nodeId, rect, nodeMenuFocusToken(nodeId));
          },
        },
        h(EllipsisIcon, { width: 12, height: 12 }),
      ),
    ];

    return h(
      "div",
      {
        class: `zc-node${isLocal ? "" : " zc-node--source"}`,
        "data-zc-node-id": nodeId,
        "data-zc-owner": owner,
        "data-zc-runtime-key": key,
        "data-zc-selected": computed(() => (selected.value ? "" : null)),
        "data-zc-opaque": computed(() => (opaque.value ? "" : null)),
      },
      isLocal
        ? h(Show, {
            when: edit,
            children: () =>
              h(
                "span",
                { class: "zc-chrome", "aria-hidden": computed(() => (selected.value ? null : "true")) },
                h(Show, { when: selected, children: selectedChrome, fallback: () => label }),
              ),
          })
        : null,
      h(Keyed<BodyInputs>, {
        value: body,
        by: (value: BodyInputs) => value.key,
        children: (value: ReadonlySignal<BodyInputs>) => h(NodeBody, { item, proseEditing: value.value.proseEditing, emptySingles: value.value.emptySingles }),
      }),
      !isLocal
        ? h("span", { class: "zc-source-lock", "aria-hidden": "true" }, "Linked source · locked")
        : null,
    );
  }

  const linkedPresent = computed(() => linkedSignal.value !== null);
  const rootItems = computed(() =>
    slotItems(
      documentSignal.value.root,
      { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 },
      "the document",
      "vertical",
      false,
      "local",
      localRecordId.value,
      edit.value,
    ),
  );
  const sourceItems = computed(() => {
    const linked = linkedSignal.value;
    return linked
      ? slotItems(linked.sourceDocument.root, undefined, "linked source", "vertical", false, "global-template", linked.sourceRecordId, edit.value)
      : [];
  });
  const linkedShell = (): Child => [
    h(
      "div",
      { class: "zc-linked-frame", "data-zc-linked-frame": "", role: "status" },
      h("span", { class: "zc-linked-frame-title" }, "Linked Global template"),
      h("span", { class: "zc-linked-frame-detail" }, computed(() => linkedSignal.value?.sourceDocument.name ?? "")),
      h("span", { class: "zc-linked-frame-outlet" }, computed(() => {
        const outlet = linkedSignal.value?.outlet;
        return outlet ? `Outlet: ${outlet.label || outlet.id}` : "";
      })),
      h("span", { class: "zc-linked-frame-lock" }, "Locked"),
      h(
        "button",
        {
          type: "button",
          class: "zc-linked-frame-open",
          "data-zc-affordance": "",
          "on:click": () => {
            const linked = linkedSignal.value;
            if (linked) onOpenSource?.(linked.sourceRecordId);
          },
        },
        "Open source",
      ),
    ),
    h(
      "section",
      { class: "zc-linked-shell", "data-zc-linked-shell": "", "aria-label": "Linked Global template" },
      h(SlotRegion, { items: sourceItems }),
    ),
  ];

  return h(
    "div",
    {
      ref: canvasRef,
      class: "zc-canvas",
      "data-composer-canvas": "",
      // The EFFECTIVE mode, so a restored prose draft keeps the Edit-mode
      // styling that goes with the Edit-mode handlers wired below.
      "data-mode": computed(() => (edit.value ? "edit" : "preview")),
      // The CSS hook for the drag lifecycle (issue Takazudo/zudo-sg#258): while set, insert-point
      // children are `pointer-events: none` so a child-crossing `dragleave`
      // (null `relatedTarget` in Chromium) can't wipe the drop highlight.
      "data-zc-dragging": computed(() => (dragActive.value ? "" : null)),
      "on:click:capture": (event: MouseEvent) => (edit.value ? onClickCapture(event) : onPreviewClickCapture(event)),
      "on:keydown:capture": (event: KeyboardEvent) => {
        if (edit.value) onKeyDownCapture(event);
      },
      // Bubbling (not capture) so an active session's own `dblclick`
      // stopPropagation can keep word-select from restarting the session.
      "on:dblclick": (event: MouseEvent) => {
        if (edit.value) onDblClick(event);
      },
    },
    h(Show, {
      when: linkedPresent,
      children: linkedShell,
      fallback: () => h(SlotRegion, { items: rootItems }),
    }),
    // The prose session's Save button and confirmation dialog. Both are
    // `position: fixed` in the IFRAME viewport (which is the canvas area), so
    // their place in the tree is irrelevant to layout — the canvas is simply
    // the one element guaranteed to be mounted whenever a session can exist.
    prose.renderChrome(),
  );
}

function dropKeyFor(target: InsertionTarget): string {
  return `${target.parentId ?? ""}:${target.slotId}:${target.index}`;
}
