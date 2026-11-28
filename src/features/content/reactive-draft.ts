import { computed, signal, type ReadonlySignal, type Scope, type Signal } from "@takazudo/zfb/zudo-react";
import { storeSignal } from "../../runtime";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

/** The controller's state as a signal owned by `scope`; the subscription lives as long as the scope. */
export function controllerState(scope: Scope, controller: Pick<ContentAuthoringController, "state" | "subscribe">): ReadonlySignal<ContentAuthoringState> {
  return storeSignal(scope, {
    getSnapshot: () => controller.state,
    subscribe: (listener) => controller.subscribe(() => listener()),
  });
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

/**
 * A computed that keeps returning the same object while `key` of the new value
 * is unchanged, so a keyed rebuild (`Rebuild`, `DataTable` rows) follows only
 * structural changes and leaves focused controls mounted.
 */
export function stableComputed<T>(read: () => T, key: (value: T) => string): ReadonlySignal<T> {
  let last: { key: string; value: T } | null = null;
  return computed(() => {
    const value = read();
    const next = key(value);
    if (last && last.key === next) return last.value;
    last = { key: next, value };
    return value;
  });
}
