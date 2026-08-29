// Controlled-text-field hook for the inspector (issue #249).
//
// A naive `<input value={node.props[prop]} onInput={...}>` re-derives its
// `value` from the incoming document on every render. Editing a DIFFERENT
// field elsewhere in the tree still re-renders this one (new `document`
// object, same string for THIS prop), and simply re-assigning an input's
// `value` while it has focus resets the caret to the end — the "steals
// focus/caret" bug the epic calls out. This hook keeps an internal draft
// that mirrors the incoming `value` only while the field is NOT focused, so
// a user's local edit (and caret position) survives sibling rerenders.
//
// The field row (inspector-field.tsx) additionally `key`s each control by
// `${selectedId}:${field.prop}`, so switching the SELECTED node still
// remounts cleanly instead of reusing stale focus/draft state left over from
// a different node.
//
// This hook still calls `onCommit` on EVERY keystroke — since issue #291 the
// wired callback is the controller's DEBOUNCED channel
// (`updatePropsDebounced`), so the expensive dispatch (whole-document
// stringify + localStorage + preview render) coalesces per typing pause
// while the draft here stays per-keystroke responsive.

import { useEffect, useRef, useState } from "preact/hooks";

export interface UseTextFieldOptions {
  value: string;
  onCommit: (value: string) => void;
}

export interface UseTextFieldResult {
  draft: string;
  onInput: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

export function useTextField({ value, onCommit }: UseTextFieldOptions): UseTextFieldResult {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(value);
  }, [value]);

  return {
    draft,
    onInput: (next) => {
      setDraft(next);
      onCommit(next);
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
    },
  };
}
