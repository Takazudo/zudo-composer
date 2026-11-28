import { getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";
import { cx } from "../ui/class-names";

export interface RecordTitleProps {
  value: MaybeSignal<string>;
  /** Called with the trimmed name, only when it actually changed. */
  onCommit: (next: string) => void;
  /** Accessible name of the field, e.g. "Composition name". */
  label: string;
  placeholder?: string;
  disabled?: MaybeSignal<boolean>;
  class?: string;
}

/**
 * The editor toolbar's inline-editable record name: commit on Enter or blur,
 * cancel on Escape, and a blank entry reverts rather than renaming to nothing.
 *
 * Escape and Enter both blur synchronously; the draft is a signal, so the
 * trailing blur reads the reverted or committed text, never a stale copy.
 * `lastCommitted` makes that trailing blur idempotent, so a parent that renames
 * asynchronously (or rejects the rename outright) is never told twice.
 */
export function RecordTitle({ value, onCommit, label, placeholder, disabled, class: className }: RecordTitleProps) {
  const inputRef: Ref<HTMLInputElement> = { current: null };
  const draft = signal(read(value));
  let lastCommitted = read(value);

  // The external name is the only trigger: a rename that happened elsewhere.
  // The effect's first run can land after the author has started typing, so
  // only an actual change of the external name resets the draft.
  let seen = lastCommitted;
  getScope().effect(() => {
    const external = read(value);
    if (Object.is(external, seen)) return;
    seen = external;
    lastCommitted = external;
    draft.value = external;
  });

  function commit() {
    const next = draft.value.trim();
    if (!next) {
      draft.value = read(value);
      return;
    }
    draft.value = next;
    if (next === lastCommitted) return;
    lastCommitted = next;
    onCommit(next);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") draft.value = read(value);
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
        modelValue={draft}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        on:keydown={handleKeyDown}
        on:blur={commit}
      />
    </div>
  );
}
