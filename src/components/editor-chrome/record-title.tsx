import { useEffect, useRef, useState } from "preact/hooks";
import { cx } from "../ui/class-names";

export interface RecordTitleProps {
  value: string;
  /** Called with the trimmed name, only when it actually changed. */
  onCommit: (next: string) => void;
  /** Accessible name of the field, e.g. "Composition name". */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
}

/**
 * The editor toolbar's inline-editable record name: commit on Enter or blur,
 * cancel on Escape, and a blank entry reverts rather than renaming to nothing.
 *
 * Two refs carry the weight. `draftRef` mirrors the draft because Escape and
 * Enter both blur synchronously, so the blur handler would otherwise read the
 * pre-update draft off its own render closure and commit the cancelled text.
 * `lastCommitted` makes the trailing blur idempotent, so a parent that renames
 * asynchronously (or rejects the rename outright) is never told twice.
 */
export function RecordTitle({ value, onCommit, label, placeholder, disabled, class: className }: RecordTitleProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const lastCommitted = useRef(value);

  function writeDraft(next: string) {
    draftRef.current = next;
    setDraft(next);
  }

  useEffect(() => {
    lastCommitted.current = value;
    writeDraft(value);
    // `writeDraft` is stable in behaviour; the external name is the only trigger.
  }, [value]);

  function commit() {
    const next = draftRef.current.trim();
    if (!next) {
      writeDraft(value);
      return;
    }
    writeDraft(next);
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onCommit(next);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") writeDraft(value);
    else return;
    event.preventDefault();
    inputRef.current?.blur();
  }

  return (
    <div class={cx("cms-record-title", className)}>
      <input
        ref={inputRef}
        class="cms-record-title__input"
        type="text"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(event) => writeDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
