import { computed, For, getScope, type ReadonlySignal, type Ref, type Scope } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../components/reactive";

/** A live boolean for `Show`. */
export const when = (test: () => unknown): ReadonlySignal<boolean> => computed(() => Boolean(test()));

/**
 * Runs `fn` when the tuple returned by `source` changes (shallow, `Object.is`),
 * like a Preact effect with a dependency list. Reads inside `fn` may retrigger
 * the effect, but the guard returns before `fn` runs again, so only `source`
 * stays tracked.
 */
export function watch<T extends readonly unknown[]>(scope: Scope, source: () => T, fn: (value: T) => void): void {
  let last: T | null = null;
  scope.effect(() => {
    const value = source();
    if (last && last.length === value.length && last.every((entry, index) => Object.is(entry, value[index]))) return;
    last = value;
    fn(value);
  });
}

export interface LiveOption { value: string; label: string; disabled?: boolean }
export interface LiveSelectProps {
  options: MaybeSignal<readonly LiveOption[]>;
  value: MaybeSignal<string>;
  onChange(value: string): void;
  disabled?: MaybeSignal<boolean>;
  class?: string;
  "aria-label"?: string;
}

/**
 * A select whose options follow state. zudo-react takes only static options,
 * so the select is rebuilt when its option list changes. A value change on the
 * same options writes the DOM directly, so the user's own selection keeps focus.
 */
export function LiveSelect(props: LiveSelectProps) {
  const revisions = computed(() => {
    const options = read(props.options);
    return [{ key: JSON.stringify(options), options }];
  });
  return <For each={revisions} by={(revision) => revision.key}>{(revision) => <SelectRevision {...props} options={revision.value.options} />}</For>;
}

function SelectRevision(props: LiveSelectProps & { options: readonly LiveOption[] }) {
  const element: Ref<HTMLSelectElement> = { current: null };
  const initial = read(props.value);
  getScope().effect(() => {
    const value = read(props.value);
    if (element.current && element.current.value !== value) element.current.value = value;
  });
  const disabled = computed(() => Boolean(read(props.disabled)));
  return <select ref={element} class={props.class} aria-label={props["aria-label"]} disabled={disabled} on:change={(event) => props.onChange(event.currentTarget.value)}>
    {props.options.map((option) => <option value={option.value} selected={option.value === initial} disabled={option.disabled}>{option.label}</option>)}
  </select>;
}
