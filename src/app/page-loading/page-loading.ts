import type { Scope } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../components/reactive";

const PENDING_ATTRIBUTE = "data-cms-nav-pending";

export interface PageActivity {
  inFlight(): number;
  subscribe(listener: () => void): () => void;
}

export interface PageLoading {
  /** Marks one pending navigation-shaped operation. The returned release is idempotent. */
  begin(source?: Element | null): () => void;
  /** Holds the overlay after a committed navigation until the destination's data requests drain. */
  settle(source?: Element | null): void;
  isLoading(): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface PageLoadingOptions {
  /** How long activity must stay at zero before a settle releases. */
  quietMs?: number;
  /** The scrim covers the route's first load only; per-item lazy reads after
   * this show their own inline states instead of the full-screen overlay. */
  maxSettleMs?: number;
}

export function createPageLoading(activity: PageActivity, { quietMs = 150, maxSettleMs = 1_500 }: PageLoadingOptions = {}): PageLoading {
  let active = 0;
  const marks = new Map<Element, number>();
  const listeners = new Set<() => void>();
  const settles = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const mark = (source: Element) => { marks.set(source, (marks.get(source) ?? 0) + 1); source.setAttribute(PENDING_ATTRIBUTE, ""); };
  const unmark = (source: Element) => {
    const count = (marks.get(source) ?? 1) - 1;
    if (count > 0) { marks.set(source, count); return; }
    marks.delete(source); source.removeAttribute(PENDING_ATTRIBUTE);
  };
  const begin = (source?: Element | null) => {
    active++;
    if (source) mark(source);
    notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      if (source) unmark(source);
      notify();
    };
  };
  return {
    begin,
    settle(source) {
      const release = begin(source);
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { clearTimeout(quiet); clearTimeout(cap); stop(); settles.delete(finish); release(); };
      const check = () => {
        clearTimeout(quiet);
        if (activity.inFlight() === 0) quiet = setTimeout(() => { if (activity.inFlight() === 0) finish(); }, quietMs);
      };
      const stop = activity.subscribe(check);
      const cap = setTimeout(finish, maxSettleMs);
      settles.add(finish);
      check();
    },
    isLoading: () => active > 0,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { for (const finish of [...settles]) finish(); },
  };
}

/**
 * Holds the page-loading overlay while `active` is true, for loads that do not
 * go through `authoringFetch`. The hold follows a signal and ends with `scope`;
 * a `null` loading service (no shell) makes it a no-op.
 */
export function holdPageLoadingWhile(scope: Scope, loading: PageLoading | null, active: MaybeSignal<boolean>): void {
  if (!loading) return;
  scope.effect(() => (read(active) ? loading.begin() : undefined));
}
