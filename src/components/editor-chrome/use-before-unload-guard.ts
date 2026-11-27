import type { Scope } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";

/**
 * Native unload protection for a dirty record, owned by `scope`.
 *
 * Generalised from `src/features/composer/chrome/navigation-guard.ts`, which
 * took a getter because it was installed imperatively. Following a signal, the
 * listener is attached only while the record is actually dirty — a clean
 * editor adds no `beforeunload` handler at all, which is what keeps bfcache
 * eligible — and it is detached when `scope` is disposed.
 */
export function guardBeforeUnload(scope: Scope, dirty: MaybeSignal<boolean>): void {
  scope.effect(() => {
    if (!read(dirty)) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge < 119 and legacy Firefox ignore preventDefault and gate the
      // dialog on a non-empty `returnValue`; the string itself is never shown.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });
}
