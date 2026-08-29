// ── Explicit-commit prose editing session (issue #374, epic #368) ───────────
//
// A PURE, DOM-free state machine for canvas inline edits of a field whose
// contract declares `inlineEdit.mode: "markdown-source"` (#372). The renderer
// integration (#375) owns every DOM concern: it feeds stimuli in and executes
// the returned effects. Nothing here reads the DOM, the bridge, or a clock.
//
// This is a PARALLEL session path. The auto-commit inline session in
// `renderer.ts` (#257 / #288) — Enter commits, blur commits, Edit→Preview
// commits — stays exactly as it is and drives `inlineEdit.mode: "plain"`
// (the default). The two never share state.
//
// ── The contract ───────────────────────────────────────────────────────────
//
// NO IMPLICIT COMMITS, EVER. There is no auto-commit on blur, no Enter-to-
// commit, and the Edit→Preview auto-commit that the plain session performs
// does NOT apply here. Exactly two stimuli can produce a `commit` effect:
//   1. `save-click`   — the floating Save button (bottom-right, outside the
//                       editable area);
//   2. `dialog-choice { dialog: "leave", choice: "save" }` — the explicit Save
//                       option in the leave dialog.
// Both route through the SAME single `commit` output, so the integration has
// one commit function, not two. (Epic #368 records the interpretation: "saving
// only via that button" bans *implicit* commits; the leave dialog's explicit
// Save is per the user's own spec. Dropping it is a one-line change here plus
// its tests.)
//
// ESC and click-away PROMPT rather than silently losing or silently committing
// a draft:
//   - `escape` while dirty → the ESCAPE dialog: [Discard changes / Keep
//     editing]. No Save — ESC is a discard gesture and the dialog merely
//     confirms it. Dismissing that dialog with ESC means "keep editing", the
//     safe default (the integration maps dialog-ESC to the raw `escape` input,
//     which this machine treats as keep-editing while a dialog is open).
//   - `outside-intent` while dirty (mousedown elsewhere in the iframe, or
//     focus leaving to host chrome) → the LEAVE dialog: [Save / Discard /
//     Keep editing]. The triggering outside action is CONSUMED, not replayed:
//     after choosing, the user clicks their target again. Replaying it would
//     mean holding a DOM event across an async dialog and re-dispatching it
//     into a tree the choice may have just re-rendered.
//   - any leave stimulus while NOT dirty → silent exit, no prompt.
//
// A commit whose value is unchanged from session start is suppressed (the
// session just ends). That is not merely an optimisation: a no-op commit still
// advances the document revision host-side, which would make a later REAL
// commit fail the session-start staleness gate and silently drop the user's
// edit. Same reasoning as `commitInline` in `renderer.ts` (#288).
//
// ── The session-start revision ─────────────────────────────────────────────
//
// `startRevision` is captured ONCE, at session start, and carried on the draft
// verbatim into every `commit` effect — including a commit made from a stashed
// draft after a mode switch. It is never re-read or refreshed, so a render that
// lands mid-edit makes the eventual commit STALE by construction and the host's
// revision gate rejects it. Re-stamping a commit as fresh merely because it was
// sent after that render is exactly the bug #288 fixed.
//
// ── A doomed commit is never sent (the STALE dialog) ────────────────────────
//
// The corollary of that contract is that once a render has landed, this
// session's commit CANNOT succeed: the host drops it and answers with nothing.
// A `commit` effect also means "tear the editor down", so sending a doomed one
// destroys the draft in exchange for an edit that never lands — the user's text
// is simply gone. So the draft carries `stale`, set the moment a render arrives
// (see `external-value-change`), and an explicit save on a stale draft raises
// the STALE dialog — [Discard changes / Keep editing] — INSTEAD of committing.
// The draft survives either way, so the user can at least copy their text out.
// The fix is deliberately on this side of the gate rather than a refreshed
// `startRevision`: re-stamping would turn a visible failure into a silent
// overwrite of whatever the render brought.
//
// ── Two accepted limitations (documented, deliberate silent discards) ───────
//
// 1. EXTERNAL VALUE CHANGE on the field being edited (the #288 "ground moves
//    under you" case) discards a dirty draft SILENTLY, with no prompt. The
//    draft is unsaveable anyway — its session-start revision is now stale, so
//    the host's gate would reject a commit — and prompting would offer a Save
//    that cannot work. A render that leaves this field alone does not end the
//    session.
// 2. NODE REMOVED (the edited node is gone from the document) discards a dirty
//    draft SILENTLY. There is no longer a target to commit into, and the
//    prompt would be attached to a component that has left the canvas.
//
// Every OTHER way a dirty draft can be dropped goes through an explicit dialog
// choice. `__tests__/prose-session-machine.test.ts` asserts both properties
// exhaustively over the reachable state graph.

import type { PreviewMode } from "./protocol";

/**
 * The editing context, carried unchanged through every state. `initialValue`
 * is the on-screen value at session start (dirtiness is derived against it,
 * never tracked separately); `startRevision` is the document revision at
 * session start — see the header.
 */
export interface ProseDraft {
  readonly nodeId: string;
  readonly fieldKey: string;
  readonly initialValue: string;
  readonly value: string;
  readonly startRevision: number;
  /**
   * A render has landed since session start, so the host's revision gate would
   * reject a commit stamped with `startRevision` (#288) — see the header. Set
   * once and never cleared: nothing can make a superseded revision current
   * again.
   */
  readonly stale: boolean;
}

/**
 * Which dialog is open. `"escape"` offers [Discard / Keep editing];
 * `"leave"` offers [Save / Discard / Keep editing]; `"stale"` offers
 * [Discard / Keep editing] because saving is no longer possible at all.
 */
export type ProseDialogKind = "escape" | "leave" | "stale";

/**
 * `stashed` on a prompting state means the editable DOM is GONE (a mode switch
 * tore it down) and the draft survives only in this state. A prompt that ends
 * in "keep editing" from there needs the editor re-established, not merely
 * refocused, and the canvas put back into Edit mode — hence `restore-editing`.
 */
export type ProseSessionState =
  | { readonly kind: "idle" }
  | { readonly kind: "editing"; readonly draft: ProseDraft }
  | {
      readonly kind: "prompting-escape";
      readonly draft: ProseDraft;
      readonly stashed: boolean;
    }
  | {
      readonly kind: "prompting-leave";
      readonly draft: ProseDraft;
      readonly stashed: boolean;
    }
  | {
      readonly kind: "prompting-stale";
      readonly draft: ProseDraft;
      readonly stashed: boolean;
    };

/**
 * Stimuli. `dialog-choice` is discriminated by the dialog it answers so the
 * type system alone forbids a Save choice for the escape dialog, and a choice
 * answering a dialog that is not the open one is ignored at runtime (a stale
 * click from a dialog that was already superseded).
 */
export type ProseSessionInput =
  | {
      readonly type: "start";
      readonly nodeId: string;
      readonly fieldKey: string;
      readonly value: string;
      readonly startRevision: number;
    }
  | { readonly type: "input"; readonly value: string }
  | { readonly type: "escape" }
  | { readonly type: "save-click" }
  | { readonly type: "outside-intent" }
  /**
   * A RENDER landed. It carries the edited field's value in the incoming
   * snapshot so the ground-check below can tell whether the ground moved — but
   * its mere arrival already means the host has advanced the revision this
   * session's commit is gated against, so it also marks the draft `stale`.
   */
  | {
      readonly type: "external-value-change";
      readonly nodeId: string;
      readonly fieldKey: string;
      /** The field's value in the incoming document snapshot. */
      readonly value: string;
    }
  | { readonly type: "node-removed"; readonly nodeId: string }
  | { readonly type: "mode-switch"; readonly mode: PreviewMode }
  | {
      readonly type: "dialog-choice";
      readonly dialog: "escape";
      readonly choice: "discard" | "keep-editing";
    }
  | {
      readonly type: "dialog-choice";
      readonly dialog: "leave";
      readonly choice: "save" | "discard" | "keep-editing";
    }
  | {
      readonly type: "dialog-choice";
      readonly dialog: "stale";
      readonly choice: "discard" | "keep-editing";
    };

/**
 * What the integration must do. `commit` and `discard` are the two TERMINAL
 * effects — each also means "end the session and tear the editor down" — and
 * never appear together.
 */
export type ProseSessionEffect =
  /** Send `commit-inline-edit` stamped with `draft.startRevision`, then tear down. */
  | { readonly type: "commit"; readonly draft: ProseDraft }
  /** Tear down the editor and drop the draft. */
  | { readonly type: "discard" }
  /** Hold the draft value outside the DOM: the editable is about to be destroyed. */
  | { readonly type: "stash-draft"; readonly draft: ProseDraft }
  /**
   * The exact inverse of `stash-draft`, and only ever emitted for a stashed
   * draft: the canvas has LEFT Edit mode and the editable is gone, so the
   * integration must put the host back into Edit mode and re-mount the editor
   * from `draft.value` before the `refocus` that always follows it. Without
   * this the machine would re-enter `editing` while the canvas sat in Preview.
   */
  | { readonly type: "restore-editing"; readonly draft: ProseDraft }
  /** Put the caret back in the editor. */
  | { readonly type: "refocus" }
  | { readonly type: "show-dialog"; readonly dialog: ProseDialogKind }
  | { readonly type: "close-dialog" };

export interface ProseSessionTransition {
  readonly state: ProseSessionState;
  readonly effects: readonly ProseSessionEffect[];
}

/** The starting state: no session. */
export const idleProseSession: ProseSessionState = { kind: "idle" };

/** The live draft, or `null` when idle. */
export function proseSessionDraft(state: ProseSessionState): ProseDraft | null {
  return state.kind === "idle" ? null : state.draft;
}

/** Whether the session holds unsaved changes. Derived — never stored. */
export function proseSessionIsDirty(state: ProseSessionState): boolean {
  const draft = proseSessionDraft(state);
  return draft !== null && draft.value !== draft.initialValue;
}

/** A transition that asks the integration to do nothing. */
function noEffects(state: ProseSessionState): ProseSessionTransition {
  return { state, effects: [] };
}

/**
 * An EXPLICIT save — the only route to a `commit`. Three outcomes, in order:
 *
 *   - a no-op save (value unchanged from session start) just ends the session,
 *     because a commit that changes nothing still advances the document
 *     revision host-side (see the header);
 *   - a STALE draft raises the stale dialog and KEEPS the draft, because the
 *     commit would be rejected and the editor torn down with it (see the
 *     header). Re-raising the dialog that is already open is a no-op;
 *   - otherwise, commit.
 *
 * `openDialog` is the dialog currently on screen, or `null` when the save came
 * straight from the floating Save button.
 */
function saveTransition(
  draft: ProseDraft,
  stashed: boolean,
  openDialog: ProseDialogKind | null,
): ProseSessionTransition {
  const closing: readonly ProseSessionEffect[] =
    openDialog === null ? [] : [{ type: "close-dialog" }];
  if (draft.value === draft.initialValue) {
    return { state: idleProseSession, effects: [...closing, { type: "discard" }] };
  }
  if (draft.stale) {
    return {
      state: { kind: "prompting-stale", draft, stashed },
      effects: openDialog === "stale" ? [] : [{ type: "show-dialog", dialog: "stale" }],
    };
  }
  return { state: idleProseSession, effects: [...closing, { type: "commit", draft }] };
}

/** Whether a document stimulus targets the field this session is editing. */
function targetsDraft(
  draft: ProseDraft,
  event: { readonly nodeId: string; readonly fieldKey?: string },
): boolean {
  if (event.nodeId !== draft.nodeId) return false;
  return event.fieldKey === undefined || event.fieldKey === draft.fieldKey;
}

/**
 * The ground-moved check (#288): an incoming render only ends the session when
 * it changed the value of the field being edited. An edit elsewhere in the
 * document leaves the session alone.
 */
function groundMoved(
  draft: ProseDraft,
  event: Extract<ProseSessionInput, { type: "external-value-change" }>,
): boolean {
  return targetsDraft(draft, event) && event.value !== draft.initialValue;
}

function editingTransition(
  state: Extract<ProseSessionState, { kind: "editing" }>,
  input: ProseSessionInput,
): ProseSessionTransition {
  const { draft } = state;
  const dirty = draft.value !== draft.initialValue;

  switch (input.type) {
    // A session is already open; re-entry is the integration's to guard (it
    // mirrors `enterInlineSession`'s early return in `renderer.ts`).
    case "start":
      return noEffects(state);

    case "input":
      return noEffects({
        kind: "editing",
        draft: { ...draft, value: input.value },
      });

    case "escape":
      return dirty
        ? {
            state: { kind: "prompting-escape", draft, stashed: false },
            effects: [{ type: "show-dialog", dialog: "escape" }],
          }
        : { state: idleProseSession, effects: [{ type: "discard" }] };

    case "outside-intent":
      return dirty
        ? {
            state: { kind: "prompting-leave", draft, stashed: false },
            effects: [{ type: "show-dialog", dialog: "leave" }],
          }
        : { state: idleProseSession, effects: [{ type: "discard" }] };

    case "save-click":
      return saveTransition(draft, false, null);

    // Leaving Edit mode re-renders the canvas and destroys the editable, so a
    // dirty draft is stashed FIRST and the leave dialog then operates on the
    // stash. It still does not commit — that is the plain session's behaviour,
    // not this one's.
    case "mode-switch":
      if (input.mode !== "preview") return noEffects(state);
      return dirty
        ? {
            state: { kind: "prompting-leave", draft, stashed: true },
            effects: [
              { type: "stash-draft", draft },
              { type: "show-dialog", dialog: "leave" },
            ],
          }
        : { state: idleProseSession, effects: [{ type: "discard" }] };

    // Accepted limitation 1 (see header). A render that leaves the edited field
    // alone keeps the session — but it has still superseded the revision the
    // commit is gated against, so the draft becomes `stale`.
    case "external-value-change":
      return groundMoved(draft, input)
        ? { state: idleProseSession, effects: [{ type: "discard" }] }
        : noEffects({ kind: "editing", draft: { ...draft, stale: true } });

    // Accepted limitation 2 (see header).
    case "node-removed":
      return targetsDraft(draft, input)
        ? { state: idleProseSession, effects: [{ type: "discard" }] }
        : noEffects(state);

    // No dialog is open, so this is a stale answer to one that already closed.
    case "dialog-choice":
      return noEffects(state);
  }
}

function promptingTransition(
  state: Extract<
    ProseSessionState,
    { kind: "prompting-escape" | "prompting-leave" | "prompting-stale" }
  >,
  input: ProseSessionInput,
): ProseSessionTransition {
  const { draft, stashed } = state;
  const openDialog: ProseDialogKind =
    state.kind === "prompting-escape" ? "escape" : state.kind === "prompting-leave" ? "leave" : "stale";
  const keepEditing: ProseSessionTransition = {
    state: { kind: "editing", draft },
    effects: stashed
      ? [{ type: "close-dialog" }, { type: "restore-editing", draft }, { type: "refocus" }]
      : [{ type: "close-dialog" }, { type: "refocus" }],
  };

  switch (input.type) {
    case "start":
      return noEffects(state);

    // Keystrokes can still land while a non-modal dialog is open (an IME
    // composition confirming, say). Record them — a draft is never silently
    // rolled back — but leave the pending decision open.
    case "input":
      return noEffects({ ...state, draft: { ...draft, value: input.value } });

    // Dismissing a dialog with ESC means "keep editing": the safe default for
    // BOTH dialogs, since neither losing nor committing the draft may happen
    // without an explicit choice.
    case "escape":
      return keepEditing;

    // The floating Save button lives outside the dialog. If the user can reach
    // it, an explicit click is an explicit save — it routes through the same
    // single commit path rather than being dropped.
    case "save-click":
      return saveTransition(draft, stashed, openDialog);

    // The open dialog owns the pending decision: a further click outside is
    // consumed rather than stacking a second prompt.
    case "outside-intent":
      return noEffects(state);

    // The editable is being destroyed under an open dialog — stash, and let the
    // same dialog carry on against the stash.
    case "mode-switch":
      if (input.mode !== "preview" || stashed) return noEffects(state);
      // Unless there is nothing left to lose: typing can bring a draft back to
      // its start value WHILE the dialog is open, and a leave stimulus with a
      // clean draft always exits silently rather than keeping a moot prompt
      // (and a stash nobody needs) alive.
      if (draft.value === draft.initialValue) {
        return {
          state: idleProseSession,
          effects: [{ type: "close-dialog" }, { type: "discard" }],
        };
      }
      return {
        state: { ...state, stashed: true },
        effects: [{ type: "stash-draft", draft }],
      };

    // Accepted limitation 1 (see header) — the dialog goes with the session.
    // A render that spares the field still supersedes the commit's revision.
    case "external-value-change":
      return groundMoved(draft, input)
        ? {
            state: idleProseSession,
            effects: [{ type: "close-dialog" }, { type: "discard" }],
          }
        : noEffects({ ...state, draft: { ...draft, stale: true } });

    // Accepted limitation 2 (see header).
    case "node-removed":
      return targetsDraft(draft, input)
        ? {
            state: idleProseSession,
            effects: [{ type: "close-dialog" }, { type: "discard" }],
          }
        : noEffects(state);

    case "dialog-choice": {
      // A choice from a dialog that is not the open one is stale (e.g. the
      // escape dialog was superseded before its click was delivered).
      if (input.dialog !== openDialog) return noEffects(state);
      if (input.choice === "keep-editing") return keepEditing;
      if (input.choice === "discard") {
        return {
          state: idleProseSession,
          effects: [{ type: "close-dialog" }, { type: "discard" }],
        };
      }
      // The SAVE branch is reached only by naming it. Falling through to a
      // commit "because it was not one of the other two" would make an
      // unrecognised choice an IMPLICIT commit — the one thing this module
      // exists to forbid — so anything else is a no-op instead.
      if (input.dialog === "leave" && input.choice === "save") {
        return saveTransition(draft, stashed, openDialog);
      }
      return noEffects(state);
    }
  }
}

/**
 * The single transition function: `(state, stimulus) -> (state, effects)`.
 * Total and side-effect free; the caller executes the effects in order.
 */
export function proseSessionTransition(
  state: ProseSessionState,
  input: ProseSessionInput,
): ProseSessionTransition {
  switch (state.kind) {
    case "idle":
      return input.type === "start"
        ? noEffects({
            kind: "editing",
            draft: {
              nodeId: input.nodeId,
              fieldKey: input.fieldKey,
              initialValue: input.value,
              value: input.value,
              startRevision: input.startRevision,
              stale: false,
            },
          })
        : noEffects(state);

    case "editing":
      return editingTransition(state, input);

    case "prompting-escape":
    case "prompting-leave":
    case "prompting-stale":
      return promptingTransition(state, input);
  }
}
