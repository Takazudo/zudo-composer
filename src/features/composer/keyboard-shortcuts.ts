// Pure keyboard-shortcut detectors shared by the Composer host chrome and the
// preview iframe app.
//
// This module is deliberately JSX-free and imports nothing: the preview bundle
// reaches these detectors without pulling any host chrome — or Preact hooks —
// into its graph through `app/use-composer-keyboard`.

/** True when a keystroke is being typed into an editable control. */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Match the Composer's cross-platform undo/redo shortcuts without changing
 * the event or consulting any application state.
 *
 * `Ctrl+Y` is retained as the Windows/Linux redo spelling; on macOS the
 * standard spelling is `Cmd+Shift+Z`, just as it is for the corresponding
 * Ctrl shortcut on other platforms.
 */
export function matchesUndoRedoShortcut(event: KeyboardEvent): "undo" | "redo" | null {
  // Alt changes the meaning of these combinations in browser/platform
  // shortcuts, so it must never be treated as a Composer command modifier.
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;

  switch (event.key.toLowerCase()) {
    case "z":
      return event.shiftKey ? "redo" : "undo";
    case "y":
      return event.ctrlKey && !event.shiftKey ? "redo" : null;
    default:
      return null;
  }
}
