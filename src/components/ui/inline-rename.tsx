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
    input.current?.focus();
    input.current?.select();
  }, []);
  return <Input elementRef={input} size="sm" value={draft} aria-label={label}
    onInput={(event) => setDraft(event.currentTarget.value)}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
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
