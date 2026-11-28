import { computed, getScope, signal, type ReadonlySignal, type Scope, type Signal } from "@takazudo/zfb/zudo-react";

/**
 * A prop that may be a plain value or a live signal. Components run once, so a
 * prop that has to follow its caller's state must arrive as a signal; a plain
 * value is a constant for the component's lifetime.
 */
export type MaybeSignal<T> = T | ReadonlySignal<T>;

export function isSignal<T>(value: MaybeSignal<T>): value is ReadonlySignal<T> {
  return typeof value === "object" && value !== null && "$$zudoReactive" in value;
}

/** The current value; reading it inside `computed`/`effect` tracks the signal. */
export function read<T>(value: MaybeSignal<T>): T {
  return isSignal(value) ? value.value : value;
}

/** A readonly signal over either form, for bindings that need one. */
export function toSignal<T>(value: MaybeSignal<T>): ReadonlySignal<T> {
  return isSignal(value) ? value : computed(() => value);
}

// zudo-react's `computed` has no equality cutoff: every upstream write
// re-runs a derivation, and one that builds a fresh object hands each
// identity-keyed consumer (`Rebuild`, `Keyed`, `For`) a new value — a remount
// that drops focus. These helpers keep a derived identity stable across writes
// that did not change its inputs. Call them during component setup.

/** Identity for scalars; one level of identity comparison for arrays and plain objects. */
export function shallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    const other = right as readonly unknown[];
    return left.length === other.length && left.every((value, index) => Object.is(value, other[index]));
  }
  if (Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * A `computed` that keeps its previous value while `equals` holds (by default
 * {@link shallowEqual}: a tuple or plain object keeps its identity while every
 * entry is the same value).
 */
export function memo<const T>(read: () => T, equals: (left: T, right: T) => boolean = shallowEqual): ReadonlySignal<T> {
  let last: { value: T } | null = null;
  return computed(() => {
    const next = read();
    if (last !== null && equals(last.value, next)) return last.value;
    last = { value: next };
    return next;
  });
}

/** A derived value recomputed only when an entry of `inputs()` changes identity. */
export function derive<const I extends readonly unknown[], O>(inputs: () => I, build: (...values: I) => O): ReadonlySignal<O> {
  let last: { inputs: I; value: O } | null = null;
  return computed(() => {
    const next = inputs();
    if (last !== null && shallowEqual(last.inputs, next)) return last.value;
    last = { inputs: next, value: build(...next) };
    return last.value;
  });
}

/** A computed whose identity changes only when `key` of its value does. */
export function keyedBy<T>(read: () => T, key: (value: T) => string): ReadonlySignal<T> {
  let last: { key: string; value: T } | null = null;
  return computed(() => {
    const value = read();
    const next = key(value);
    if (last && last.key === next) return last.value;
    last = { key: next, value };
    return value;
  });
}

/**
 * A writable control model that follows an external value. The control writes
 * the model as the author types; a change of the external value (a save, an
 * edit elsewhere) resets it.
 */
export function followModel<T>(external: () => T): Signal<T> {
  const model = signal(external());
  let seen = model.value;
  getScope().effect(() => {
    const next = external();
    if (Object.is(next, seen)) return;
    seen = next;
    model.value = next;
  });
  return model;
}

/**
 * Calls `apply` whenever `source` changes after setup. The comparison is against
 * the last value seen, never against the control's own draft, so the effect
 * tracks only the external value and a keystroke cannot re-trigger it.
 */
export function followExternal<T>(scope: Scope, source: ReadonlySignal<T>, apply: (next: T) => void, equals: (a: T, b: T) => boolean = Object.is): void {
  let seen = source.value;
  scope.effect(() => {
    const next = source.value;
    if (equals(next, seen)) return;
    seen = next;
    apply(next);
  });
}

/** A writable draft for a `modelValue` control that is reset only by an external change of `source`. */
export function externalDraft(scope: Scope, source: ReadonlySignal<string>): Signal<string> {
  const draft = signal(source.value);
  followExternal(scope, source, (next) => { draft.value = next; });
  return draft;
}
