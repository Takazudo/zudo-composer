import { afterEach, expect, it, vi } from "vitest";
import { waitForAuthoringSessionReady } from "../session-readiness";
const busy = () => Object.assign(new Error("frozen"), { code: "authoring-busy" });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("waits through freeze for the same epoch without fetching or replaying operations", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const state = { coordinated: true, connected: true, epoch: 4 };
  const ready = vi.fn().mockRejectedValueOnce(busy()).mockResolvedValue(undefined);
  const result = waitForAuthoringSessionReady(() => state, ready);
  await vi.advanceTimersByTimeAsync(250);
  await result;
  expect(ready).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["epoch", "disconnect"])("refuses %s while frozen without fetching", async mode => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const state = { coordinated: true, connected: true, epoch: 4 };
  const ready = vi.fn(async () => { throw busy(); });
  const result = waitForAuthoringSessionReady(() => state, ready);
  const rejected = expect(result).rejects.toMatchObject({ code: "stale-browser" });
  await vi.advanceTimersByTimeAsync(0);
  if (mode === "epoch") state.epoch++; else state.connected = false;
  await vi.advanceTimersByTimeAsync(250);
  await rejected;
  expect(ready).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses bind followed by disconnect before the readiness continuation", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const state = { coordinated: true, connected: false, epoch: -1 };
  const ready = vi.fn(async () => { state.epoch = 4; state.connected = true; state.connected = false; });
  await expect(waitForAuthoringSessionReady(() => state, ready)).rejects.toMatchObject({ code: "stale-browser" });
  expect(fetch).not.toHaveBeenCalled();
});
it("aborts a frozen wait without another readiness attempt or fetch", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const ready = vi.fn(async () => { throw busy(); });
  const result = waitForAuthoringSessionReady(() => ({ coordinated: true, connected: true, epoch: 4 }), ready, controller.signal);
  const rejected = expect(result).rejects.toThrow("left workspace");
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Error("left workspace"));
  await rejected;
  expect(ready).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("accepts first binding but refuses a changed established epoch during ready", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const state = { coordinated: true, connected: false, epoch: -1 };
  await waitForAuthoringSessionReady(() => state, async () => { state.connected = true; state.epoch = 4; });
  await expect(waitForAuthoringSessionReady(() => state, async () => { state.epoch = 5; })).rejects.toMatchObject({ code: "stale-browser" });
  expect(fetch).not.toHaveBeenCalled();
});
