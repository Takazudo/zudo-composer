import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageLoading } from "../page-loading/page-loading";

const activity = (count = 0) => {
  const listeners = new Set<() => void>();
  return { set(value: number) { count = value; for (const listener of listeners) listener(); }, inFlight: () => count, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
};

describe("page loading settle", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("releases after activity stays quiet, or at the budget while per-item reads keep streaming", () => {
    vi.useFakeTimers();
    const source = document.createElement("a");
    const quiet = activity(); const loading = createPageLoading(quiet, { quietMs: 100, maxSettleMs: 1000 });
    loading.settle(source); expect(loading.isLoading()).toBe(true); expect(source.hasAttribute("data-cms-nav-pending")).toBe(true);
    quiet.set(1); vi.advanceTimersByTime(150); expect(loading.isLoading()).toBe(true);
    quiet.set(0); vi.advanceTimersByTime(150); expect(loading.isLoading()).toBe(false); expect(source.hasAttribute("data-cms-nav-pending")).toBe(false);
    const hung = activity(1); const capped = createPageLoading(hung, { quietMs: 100, maxSettleMs: 1000 });
    capped.settle(); vi.advanceTimersByTime(999); expect(capped.isLoading()).toBe(true);
    vi.advanceTimersByTime(2); expect(capped.isLoading()).toBe(false);
  });
  it("dispose releases every pending settle", () => {
    vi.useFakeTimers();
    const loading = createPageLoading(activity(1));
    loading.settle(); loading.dispose(); expect(loading.isLoading()).toBe(false);
  });
});
