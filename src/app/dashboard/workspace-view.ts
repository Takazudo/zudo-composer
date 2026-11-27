import { batch, getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { WorkspaceAttention, WorkspaceCounts, WorkspaceRecent, WorkspaceSummary } from "../workspace-summary";

/**
 * One read of the workspace summary for the Dashboard.
 *
 * `counts()`, `recent()` and `attention()` share the summary's single memoised
 * provider read, so they are requested together and land together — asking for
 * them separately would only add update passes over the same data. Each one
 * already degrades per source, so `error` is reserved for the summary itself
 * rejecting, which leaves the page with nothing at all to show.
 */
export interface WorkspaceView {
  readonly counts: ReadonlySignal<WorkspaceCounts | null>;
  readonly recent: ReadonlySignal<WorkspaceRecent | null>;
  readonly attention: ReadonlySignal<WorkspaceAttention | null>;
  /** True while a read is in flight; the previous values stay on screen. */
  readonly loading: ReadonlySignal<boolean>;
  readonly error: ReadonlySignal<string | null>;
  /** Drops the summary's memoised reads and reads the providers again. */
  readonly reload: () => void;
}

/**
 * Call during component setup. The first read starts once the caller is
 * mounted, and a read that lands after the caller is gone, or after a newer
 * read started, is dropped.
 */
export function createWorkspaceView(summary: WorkspaceSummary | undefined): WorkspaceView {
  const scope = getScope();
  const counts = signal<WorkspaceCounts | null>(null);
  const recent = signal<WorkspaceRecent | null>(null);
  const attention = signal<WorkspaceAttention | null>(null);
  const loading = signal(summary !== undefined);
  const error = signal<string | null>(null);
  let generation = 0;

  function read(): void {
    if (!summary) return;
    const mine = ++generation;
    const current = () => mine === generation && !scope.abortSignal.aborted;
    loading.value = true;
    void Promise.all([summary.counts(), summary.recent(), summary.attention()])
      .then(([nextCounts, nextRecent, nextAttention]) => {
        if (!current()) return;
        batch(() => {
          counts.value = nextCounts;
          recent.value = nextRecent;
          attention.value = nextAttention;
          loading.value = false;
          error.value = null;
        });
      })
      .catch((cause: unknown) => {
        if (!current()) return;
        batch(() => {
          counts.value = null;
          recent.value = null;
          attention.value = null;
          loading.value = false;
          error.value = cause instanceof Error && cause.message ? cause.message : "This workspace could not be read.";
        });
      });
  }

  scope.onActivate(() => {
    read();
    return summary?.subscribe?.(read);
  });

  return {
    counts,
    recent,
    attention,
    loading,
    error,
    reload: () => {
      // `refresh()` clears the memoised reads first, so this read reaches the providers.
      summary?.refresh();
      read();
    },
  };
}
