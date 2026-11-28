// Controlled-text-field model for the inspector (issue Takazudo/zudo-sg#249).
//
// A naive `<input value={node.props[prop]} onInput={...}>` re-derives its
// `value` from the incoming document on every update. Editing a DIFFERENT
// field elsewhere in the tree still updates this one (new `document`
// object, same string for THIS prop), and simply re-assigning an input's
// `value` while it has focus resets the caret to the end — the "steals
// focus/caret" bug the epic calls out. This model keeps an internal draft
// that mirrors the incoming `value` only while the field is NOT focused, so
// a user's local edit (and caret position) survives sibling updates.
//
// The inspector (inspector-panel.tsx) additionally keys each field by
// `${selectedId}:${field.prop}`, so switching the SELECTED node still
// remounts cleanly instead of reusing stale focus/draft state left over from
// a different node.
//
// This model still calls `onCommit` on EVERY keystroke — since issue Takazudo/zudo-sg#291 the
// wired callback is the controller's DEBOUNCED channel
// (`updatePropsDebounced`), so the expensive dispatch (whole-document
// stringify + localStorage + preview render) coalesces per typing pause
// while the draft here stays per-keystroke responsive.

import { signal, type ReadonlySignal, type Scope, type Signal } from "@takazudo/zfb/zudo-react";

export interface TextFieldOptions {
  value: ReadonlySignal<string>;
  onCommit: (value: string) => void;
}

export interface TextFieldModel {
  /** Bind as the control's `modelValue`. */
  draft: Signal<string>;
  onInput: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** Owned by `scope`: the incoming value is mirrored into the draft while the field is not focused. */
export function createTextField(scope: Scope, { value, onCommit }: TextFieldOptions): TextFieldModel {
  const draft = signal(value.value);
  let focused = false;
  let seen = value.value;

  // Only an actual change of the incoming value counts: an unrelated update
  // upstream must not overwrite a draft whose commit is still in flight.
  scope.effect(() => {
    const next = value.value;
    if (Object.is(next, seen)) return;
    seen = next;
    if (focused) return;
    draft.value = next;
  });

  return {
    draft,
    onInput: (next) => {
      draft.value = next;
      onCommit(next);
    },
    onFocus: () => {
      focused = true;
    },
    onBlur: () => {
      focused = false;
    },
  };
}
