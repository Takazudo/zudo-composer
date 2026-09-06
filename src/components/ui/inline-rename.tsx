import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Input } from "./form-controls";

/** Also checks the legacy composition key code emitted by some IME engines. */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export interface InlineRenameProps {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/** Focus/select on mount; explicit Enter commits, Escape cancels; blur preserves edits. */
export function InlineRename({ value, label, onCommit, onCancel }: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    // Use native names, independent of Preact's DOM-property case inference.
    const start = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    element.focus();
    element.select();
    return () => {
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
    };
  }, []);
  return <Input elementRef={input} size="sm" value={draft} aria-label={label}
    onInput={(event) => setDraft(event.currentTarget.value)}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (composing.current || isComposingKey(event)) return;
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Enter") {
        event.preventDefault();
        if (draft.trim()) onCommit(draft.trim());
      }
    }} />;
}
