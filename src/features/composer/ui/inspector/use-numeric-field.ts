// Controlled-numeric-field model for the inspector (issue Takazudo/zudo-sg#249).
//
// Numeric drafts must never commit `NaN` or flip the prop's JS type. While
// the user is mid-edit ("-", "", "12.") the draft is free text and is NOT
// committed; `onCommit` fires only once the draft parses to a finite number
// inside `[min, max]`. An invalid draft surfaces a labelled inline error
// instead of silently reverting, and blur reverts the visible text to the
// last committed value so the field never strands the user on invalid text
// after they look away. See use-text-field.ts for the matching
// caret-retention rationale — this model uses the same focused-guard pattern.

//
// A number input takes no `modelValue`, so the visible text is written to the
// element explicitly (`writeDom`) whenever the draft is reset from outside.

import { signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";

export interface NumericFieldOptions {
  value: ReadonlySignal<number>;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
  /** Writes reset text into the control (number inputs are not model-bound). */
  writeDom?: (text: string) => void;
}

export interface NumericFieldModel {
  /** The visible draft; it may be invalid text while the field is focused. */
  draft: ReadonlySignal<string>;
  error: ReadonlySignal<string | null>;
  onInput: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

type DraftValidation = { ok: true; value: number } | { ok: false; message: string };

function validateDraft(
  text: string,
  min: number | undefined,
  max: number | undefined,
  step: number | undefined,
): DraftValidation {
  if (text.trim() === "") return { ok: false, message: "Enter a number" };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { ok: false, message: "Must be a finite number" };
  if (min !== undefined && parsed < min) return { ok: false, message: `Must be at least ${min}` };
  if (max !== undefined && parsed > max) return { ok: false, message: `Must be at most ${max}` };
  if (step !== undefined) {
    const units = (parsed - (min ?? 0)) / step;
    if (Math.abs(units - Math.round(units)) >= 1e-9) {
      return { ok: false, message: `Must use increments of ${step}` };
    }
  }
  return { ok: true, value: parsed };
}

/** Owned by `scope`. */
export function createNumericField(scope: Scope, { value, min, max, step, onCommit, writeDom }: NumericFieldOptions): NumericFieldModel {
  const draft = signal(String(value.value));
  const error = signal<string | null>(null);
  let focused = false;
  // The last value handed to `onCommit` that the `value` prop has not yet
  // caught up with. With a DEBOUNCED commit channel (issue Takazudo/zudo-sg#291) the incoming
  // `value` lags the keystream, so deduping against `value` alone would
  // swallow a correction typed inside the debounce window (e.g. "55" then
  // backspace to "5" — 5 equals the stale prop, but 55 is what's pending).
  let inFlight: number | null = null;
  let committed = value.value;

  const reset = (next: number) => {
    const text = String(next);
    draft.value = text;
    error.value = null;
    writeDom?.(text);
  };

  // Only an actual change of the incoming value counts, as with the text field.
  scope.effect(() => {
    const next = value.value;
    if (Object.is(next, committed)) return;
    // The document caught up (our commit landed) or moved externally — either
    // way the fresh `value` is the truth to dedupe against again.
    committed = next;
    inFlight = null;
    if (focused) return;
    reset(next);
  });

  return {
    draft,
    error,
    onInput: (text) => {
      draft.value = text;
      const result = validateDraft(text, min, max, step);
      if (result.ok) {
        error.value = null;
        // Never commit a value equal to what's already there (or already in
        // flight) — avoids a redundant document mutation (and redundant
        // autosave) on every keystroke that doesn't change the parsed number.
        if (result.value !== (inFlight ?? committed)) {
          inFlight = result.value;
          onCommit(result.value);
        }
      } else {
        error.value = result.message;
      }
    },
    onFocus: () => {
      focused = true;
    },
    onBlur: () => {
      focused = false;
      const result = validateDraft(draft.value, min, max, step);
      if (!result.ok) reset(committed);
    },
  };
}
