import { signal, type ReadonlySignal, type Scope, type Signal } from "@takazudo/zfb/zudo-react";
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
