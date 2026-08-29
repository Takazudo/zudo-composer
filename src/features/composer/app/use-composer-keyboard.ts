"use client";

// Guarded global keyboard handling for the central Composer app (issue Takazudo/zudo-sg#251).
//
//   - Delete / Backspace removes the currently selected node.
//   - Escape closes any open menu/dialog.
//
// Both are GUARDED: they never fire while focus is in an input, textarea,
// select, or contentEditable surface (so typing a prop value never deletes the
// node), and Delete/Backspace never mutates in Preview mode (Preview has no
// structural-mutation affordances at all). Escape is allowed in Preview — it
// only closes transient UI, it does not mutate the document.
//
// Kept as a tiny, pure-ish hook so the whole guard matrix is unit-testable
// without a full app render; menus reuse the Escape path.
//
// ── `menuOpen` (issue Takazudo/zudo-sg#256) ──────────────────────────────────────────────────
// A `ComposerMenu` owns its OWN Escape/outside/scroll/resize dismissal (see
// that component) — it must, to stay a self-contained, independently testable
// unit. It does NOT intercept Delete/Backspace, which would otherwise still
// bubble here and fire this hook's GLOBAL "remove the selected node" shortcut
// while a menu happens to be open — a double/wrong-node delete, since the
// menu's own subject is not necessarily `selectedId` (an insert menu has no
// node subject at all). `menuOpen: true` suppresses ONLY that structural
// shortcut; Escape still runs `onEscape` too (harmless — nothing else is ever
// open at the same time as a menu) so this hook remains the single place
// Escape is wired, per the epic's "don't duplicate the shortcut" invariant.

import { useEffect } from "preact/hooks";
import type { ComposerMode } from "../chrome/controller-model";

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
  /** A `ComposerMenu` (issue Takazudo/zudo-sg#256) is currently open — suppresses the global Delete/Backspace shortcut. */
  menuOpen?: boolean;
  /** Test seam — defaults to `document`. */
  host?: KeyboardHost;
}

/** True when a keystroke is being typed into an editable control. */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useComposerKeyboard(options: ComposerKeyboardOptions): void {
  const { mode, selectedId, onRemoveSelected, onEscape, menuOpen = false, host } = options;

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
  }, [mode, selectedId, onRemoveSelected, onEscape, menuOpen, host]);
}
