// Controlled-numeric-field hook for the inspector (issue #249).
//
// Numeric drafts must never commit `NaN` or flip the prop's JS type. While
// the user is mid-edit ("-", "", "12.") the draft is free text and is NOT
// committed; `onCommit` fires only once the draft parses to a finite number
// inside `[min, max]`. An invalid draft surfaces a labelled inline error
// instead of silently reverting, and blur reverts the visible text to the
// last committed value so the field never strands the user on invalid text
// after they look away. See use-text-field.ts for the matching
// caret-retention rationale — this hook uses the same focused-guard pattern.

import { useEffect, useRef, useState } from "preact/hooks";

export interface UseNumericFieldOptions {
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}

export interface UseNumericFieldResult {
  draft: string;
  error: string | null;
  onInput: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

type DraftValidation = { ok: true; value: number } | { ok: false; message: string };

function validateDraft(text: string, min: number | undefined, max: number | undefined): DraftValidation {
  if (text.trim() === "") return { ok: false, message: "Enter a number" };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { ok: false, message: "Must be a finite number" };
  if (min !== undefined && parsed < min) return { ok: false, message: `Must be at least ${min}` };
  if (max !== undefined && parsed > max) return { ok: false, message: `Must be at most ${max}` };
  return { ok: true, value: parsed };
}

export function useNumericField({ value, min, max, onCommit }: UseNumericFieldOptions): UseNumericFieldResult {
  const [draft, setDraft] = useState(() => String(value));
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);
  // The last value handed to `onCommit` that the `value` prop has not yet
  // caught up with. With a DEBOUNCED commit channel (issue #291) the incoming
  // `value` lags the keystream, so deduping against `value` alone would
  // swallow a correction typed inside the debounce window (e.g. "55" then
  // backspace to "5" — 5 equals the stale prop, but 55 is what's pending).
  const inFlightRef = useRef<number | null>(null);

  useEffect(() => {
    // The document caught up (our commit landed) or moved externally — either
    // way the fresh `value` is the truth to dedupe against again.
    inFlightRef.current = null;
    if (focusedRef.current) return;
    setDraft(String(value));
    setError(null);
  }, [value]);

  return {
    draft,
    error,
    onInput: (text) => {
      setDraft(text);
      const result = validateDraft(text, min, max);
      if (result.ok) {
        setError(null);
        // Never commit a value equal to what's already there (or already in
        // flight) — avoids a redundant document mutation (and redundant
        // autosave) on every keystroke that doesn't change the parsed number.
        if (result.value !== (inFlightRef.current ?? value)) {
          inFlightRef.current = result.value;
          onCommit(result.value);
        }
      } else {
        setError(result.message);
      }
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      const result = validateDraft(draft, min, max);
      if (!result.ok) {
        setDraft(String(value));
        setError(null);
      }
    },
  };
}
