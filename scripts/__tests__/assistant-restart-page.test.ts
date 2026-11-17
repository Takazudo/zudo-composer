// @vitest-environment node
import { expect, it, vi } from "vitest";
import { restartPageHost } from "../assistant/restart-page.mjs";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { resolve, promise }; }
it("disposes the old document before restarting and revisits the exact saved URL only after startup", async () => {
  const parked = deferred(), started = deferred(), events: string[] = [];
  const url = "http://127.0.0.1:4177/composer?assistant=1&sitemap=main&page=home#receipt";
  const page = { url: () => url, goto: vi.fn(async (target: string) => { events.push(target); if (target === "about:blank") await parked.promise; return null; }) };
  const restart = vi.fn(async () => { events.push("restart"); await started.promise; });
  const pending = restartPageHost(page, restart);
  expect(events).toEqual(["about:blank"]); expect(restart).not.toHaveBeenCalled();
  parked.resolve(); await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  expect(events).toEqual(["about:blank", "restart"]);
  started.resolve(); await pending;
  expect(events).toEqual(["about:blank", "restart", url]);
  expect(page.goto).toHaveBeenCalledTimes(2);
});
it.each(["park", "restart", "return"])("propagates %s failure without retrying or accepting the old document", async phase => {
  const error = new Error(`failed ${phase}`), url = "http://127.0.0.1:4177/composer?assistant=1";
  const page = { url: () => url, goto: vi.fn(async (target: string) => { if ((phase === "park" && target === "about:blank") || (phase === "return" && target === url)) throw error; return null; }) };
  const restart = vi.fn(async () => { if (phase === "restart") throw error; });
  await expect(restartPageHost(page, restart)).rejects.toBe(error);
  expect(restart).toHaveBeenCalledTimes(phase === "park" ? 0 : 1);
  expect(page.goto).toHaveBeenCalledTimes(phase === "return" ? 2 : 1);
});
