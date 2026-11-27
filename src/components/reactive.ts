import { computed, type ReadonlySignal } from "@takazudo/zfb/zudo-react";

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
