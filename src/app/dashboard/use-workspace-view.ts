import { useCallback, useEffect, useState } from "preact/hooks";
import type { WorkspaceAttention, WorkspaceCounts, WorkspaceRecent, WorkspaceSummary } from "../workspace-summary";

/**
 * One read of the workspace summary for the Dashboard.
 *
 * `counts()`, `recent()` and `attention()` share the summary's single memoised
 * provider read, so they are requested together and land together — asking for
 * them separately would only add render passes over the same data. Each one
 * already degrades per source, so `error` is reserved for the summary itself
 * rejecting, which leaves the page with nothing at all to show.
 */
export interface WorkspaceView {
  readonly counts: WorkspaceCounts | null;
  readonly recent: WorkspaceRecent | null;
  readonly attention: WorkspaceAttention | null;
  /** True while a read is in flight; the previous values stay on screen. */
  readonly loading: boolean;
  readonly error: string | null;
  /** Drops the summary's memoised reads and reads the providers again. */
  readonly reload: () => void;
}

interface ViewData {
  readonly counts: WorkspaceCounts | null;
  readonly recent: WorkspaceRecent | null;
  readonly attention: WorkspaceAttention | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const IDLE: ViewData = { counts: null, recent: null, attention: null, loading: false, error: null };

export function useWorkspaceView(summary: WorkspaceSummary | undefined, recentLimit?: number): WorkspaceView {
  // Bumped by `reload`; `refresh()` has already cleared the memoised reads by
  // the time the effect re-runs, so the next read reaches the providers.
  const [generation, setGeneration] = useState(0);
  const [data, setData] = useState<ViewData>(() => ({ ...IDLE, loading: summary !== undefined }));

  useEffect(() => {
    if (!summary) {
      setData(IDLE);
      return undefined;
    }
    let live = true;
    setData((previous) => ({ ...previous, loading: true }));
    void Promise.all([summary.counts(), summary.recent(recentLimit), summary.attention()])
      .then(([counts, recent, attention]) => {
        if (live) setData({ counts, recent, attention, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setData({
          ...IDLE,
          error: cause instanceof Error && cause.message ? cause.message : "This workspace could not be read.",
        });
      });
    return () => {
      live = false;
    };
  }, [summary, recentLimit, generation]);

  const reload = useCallback(() => {
    summary?.refresh();
    setGeneration((value) => value + 1);
  }, [summary]);

  return { ...data, reload };
}
