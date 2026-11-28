import { computed, getScope, signal, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import { storeSignal } from "../../runtime";
import type { MappingEditorController, MappingEditorState } from "./controller";

/**
 * A computed tuple that keeps its identity while every element is the same
 * value, so a `Rebuild` over it only remounts when one of its inputs changed.
 */
export function memo<const T extends readonly unknown[]>(read: () => T): ReadonlySignal<T> {
  let last: T | null = null;
  return computed(() => {
    const next = read();
    if (last && last.length === next.length && next.every((value, index) => Object.is(value, last![index]))) return last;
    last = next;
    return next;
  });
}

/**
 * A derived value recomputed only when one of its inputs changes identity.
 * zudo-react's `computed` has no equality cutoff, so a plain derived object is
 * rebuilt (and every identity-keyed consumer rebuilt with it) on each upstream
 * change; this keeps it stable across changes that did not touch its inputs.
 */
export function derive<const I extends readonly unknown[], O>(inputs: () => I, build: (...values: I) => O): ReadonlySignal<O> {
  const key = memo(inputs);
  let last: { key: I; value: O } | null = null;
  return computed(() => {
    const current = key.value;
    if (last && last.key === current) return last.value;
    last = { key: current, value: build(...current) };
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
 * edit elsewhere) resets it. Call during component setup.
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
 * Keeps an uncontrolled `<input>` (number, date, colour) in step with an
 * external value without a model: those controls take a static `value`, and
 * a draft the author is still typing is never overwritten while focused.
 */
export function writeDomValue(ref: { current: HTMLInputElement | null }, external: () => string): void {
  getScope().effect(() => {
    const next = external();
    const element = ref.current;
    if (!element || element.value === next || element === element.ownerDocument.activeElement) return;
    element.value = next;
  });
}

/** The controller as an external store: its `subscribe` replays the current state, which the signal absorbs. */
export function mappingStateSignal(controller: MappingEditorController): ReadonlySignal<MappingEditorState> {
  return storeSignal(getScope(), {
    getSnapshot: () => controller.state,
    subscribe: (listener) => controller.subscribe(() => listener()),
  });
}
