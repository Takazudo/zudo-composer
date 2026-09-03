"use client";

// Guarded global keyboard handling for the central Composer app (issue Takazudo/zudo-sg#251).
//
//   - Delete / Backspace removes the currently selected node.
//   - Escape closes any open menu/dialog.
//   - Cmd/Ctrl+Z and the supported redo variants call the history callbacks.
//
// All shortcuts are GUARDED: they never fire while focus is in an input,
// textarea, select, or contentEditable surface. This lets native text-input
// undo (and the Content route's CodeMirror undo) keep working, while also
// ensuring typing a prop value never deletes the node. Delete/Backspace and
// undo/redo never mutate in Preview mode (Preview has no mutation
// affordances). Escape is allowed in Preview — it only closes transient UI.
//
// Kept as a tiny hook over the pure detectors in `../keyboard-shortcuts` so
// the whole guard matrix is unit-testable without a full app render; the
// canvas iframe imports the same detectors rather than maintaining a second
// shortcut matrix, and reaches them without this hook's Preact dependency.
//
// ── `menuOpen` (issue Takazudo/zudo-sg#256) ──────────────────────────────────────────────────
// A `ComposerMenu` owns its OWN Escape/outside/scroll/resize dismissal (see
// that component) — it must, to stay a self-contained, independently testable
// unit. It does NOT intercept Delete/Backspace, which would otherwise still
// bubble here and fire this hook's GLOBAL "remove the selected node" shortcut
// while a menu happens to be open — a double/wrong-node delete, since the
// menu's own subject is not necessarily `selectedId` (an insert menu has no
// node subject at all). `menuOpen: true` suppresses ONLY that structural
// shortcut; undo/redo are intentionally not suppressed because they have no
// node subject and therefore cannot act on the wrong node while a menu is
// open. Escape still runs `onEscape` too (harmless — nothing else is ever
// open at the same time as a menu) so this hook remains the single place
// Escape is wired, per the epic's "don't duplicate the shortcut" invariant.

import { useEffect } from "preact/hooks";
import type { ComposerMode } from "../chrome/controller-model";
import { isEditableEventTarget, matchesUndoRedoShortcut } from "../keyboard-shortcuts";

/** A minimal event-target surface, so tests can drive a stand-in element. */
export interface KeyboardHost {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

export interface ComposerKeyboardOptions {
  mode: ComposerMode;
  /** The currently selected node id, or `null` for the virtual-root context. */
  selectedId: string | null;
  /** Remove the selected node — wired to `controller.remove`. */
  onRemoveSelected: (nodeId: string) => void;
  /** Close open menus/dialogs (chooser, export). */
  onEscape: () => void;
  /** Undo the latest Composer history entry. */
  onUndo?: () => void;
  /** Redo the next Composer history entry. */
  onRedo?: () => void;
  /** Whether an undo entry is currently available. */
  canUndo?: boolean;
  /** Whether a redo entry is currently available. */
  canRedo?: boolean;
  /** A `ComposerMenu` (issue Takazudo/zudo-sg#256) is currently open — suppresses the global Delete/Backspace shortcut. */
  menuOpen?: boolean;
  /** Test seam — defaults to `document`. */
  host?: KeyboardHost;
}

export function useComposerKeyboard(options: ComposerKeyboardOptions): void {
  const {
    mode,
    selectedId,
    onRemoveSelected,
    onEscape,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    menuOpen = false,
    host,
  } = options;

  useEffect(() => {
    const target: KeyboardHost = host ?? document;

    function onKeyDown(event: KeyboardEvent): void {
      // Never hijack keystrokes aimed at an editable control.
      if (isEditableEventTarget(event.target)) return;

      if (event.key === "Escape") {
        onEscape();
        return;
      }

      // Structural mutation is Edit-only.
      if (mode === "preview") return;

      const undoRedo = matchesUndoRedoShortcut(event);
      if (undoRedo !== null) {
        const callback = undoRedo === "undo" ? onUndo : onRedo;
        const canRun = undoRedo === "undo" ? canUndo : canRedo;
        // A matching command with no callback is not handled here, so native
        // browser behavior remains available when this hook is used without
        // the optional history wiring.
        if (callback && canRun !== false) {
          event.preventDefault();
          callback();
        }
        return;
      }

      // An open ComposerMenu owns Delete via its own item, and its subject is
      // not necessarily `selectedId` — see the module header.
      if (menuOpen) return;

      if ((event.key === "Delete" || event.key === "Backspace") && selectedId !== null) {
        event.preventDefault();
        onRemoveSelected(selectedId);
      }
    }

    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [mode, selectedId, onRemoveSelected, onEscape, onUndo, onRedo, canUndo, canRedo, menuOpen, host]);
}
