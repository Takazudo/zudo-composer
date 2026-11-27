import { getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";
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
  const draft = signal(value);
  const input: Ref<HTMLInputElement> = { current: null };
  let composing = false;
  getScope().onActivate(() => {
    const element = input.current;
    if (!element) return undefined;
    // Native listeners with explicit teardown, so composition tracking ends
    // exactly when the editor does.
    const start = () => { composing = true; };
    const end = () => { composing = false; };
    element.addEventListener("compositionstart", start);
    element.addEventListener("compositionend", end);
    element.focus();
    element.select();
    return () => {
      element.removeEventListener("compositionstart", start);
      element.removeEventListener("compositionend", end);
    };
  });
  return <Input elementRef={input} size="sm" modelValue={draft} aria-label={label}
    on:keydown={(event: KeyboardEvent) => {
      event.stopPropagation();
      if (composing || isComposingKey(event)) return;
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Enter") {
        event.preventDefault();
        if (draft.value.trim()) onCommit(draft.value.trim());
      }
    }} />;
}
