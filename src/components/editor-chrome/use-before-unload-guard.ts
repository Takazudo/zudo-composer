import { useEffect } from "preact/hooks";

/**
 * Native unload protection for a dirty record.
 *
 * Generalised from `src/features/composer/chrome/navigation-guard.ts`, which
 * took a getter because it was installed imperatively. A hook can read the flag
 * straight from render, so the listener is attached only while the record is
 * actually dirty — a clean editor adds no `beforeunload` handler at all, which
 * is what keeps bfcache eligible.
 */
export function useBeforeUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge < 119 and legacy Firefox ignore preventDefault and gate the
      // dialog on a non-empty `returnValue`; the string itself is never shown.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
}
