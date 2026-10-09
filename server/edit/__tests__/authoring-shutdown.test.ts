import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";
import { installAuthoringShutdown } from "../authoring-shutdown.mjs";

function fixture() {
  const stack: { handle: (...args: unknown[]) => unknown }[] = [];
  const middlewares = { stack, use(...args: unknown[]) { stack.push({ handle: args.at(-1) as typeof stack[number]["handle"] }); return this; } };
  const close = vi.fn(async () => {}), release = vi.fn(async () => {});
  return { stack, middlewares, close, release, server: { middlewares, close, ws: { close: vi.fn(async () => {}) }, httpServer: null } as unknown as ViteDevServer };
}

describe("authoring shutdown", () => {
  it.each([false, true])("keeps direct Vite shutdown alive until lease release (forwarded signal: %s)", async (forwardSignal) => {
    const helper = new URL("../authoring-shutdown.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { installAuthoringShutdown } from ${JSON.stringify(helper)};
      const listener = setInterval(() => {}, 1000);
      const server = {
        middlewares: { stack: [], use() {} }, ws: { async close() {} },
        async close() {
          clearInterval(listener);
          console.log('closing');
          await new Promise(resolve => setTimeout(resolve, 100).unref());
        }
      };
      installAuthoringShutdown(server, { async release() { console.log('released'); } });
      process.once('SIGTERM', async () => { await server.close(); process.exit(0); });
      console.log('ready');
    `], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let stopping = false, forwarded = false;
    child.stdout.on("data", chunk => {
      stdout += String(chunk);
      if (!stopping && stdout.includes("ready")) { stopping = true; child.kill("SIGTERM"); }
      if (forwardSignal && !forwarded && stdout.includes("closing")) { forwarded = true; child.kill("SIGTERM"); }
    });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const result = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    expect(result, stderr).toEqual({ code: 0, signal: null });
    expect(stdout).toContain("released");
  });

  it("drains existing and later async handlers after client disconnect before closing Vite or releasing the lease", async () => {
    const f = fixture();
    const signals = process.listenerCount("SIGTERM");
    let finishFirst!: () => void, finishLast!: () => void;
    const first = new Promise<void>(resolve => { finishFirst = resolve; });
    const last = new Promise<void>(resolve => { finishLast = resolve; });
    f.middlewares.use(async () => { await first; });
    installAuthoringShutdown(f.server, { release: f.release });
    f.middlewares.use("/preview", async () => { await last; });
    const response = { destroyed: true, end: vi.fn(), statusCode: 200 };
    const work = f.stack.map(layer => layer.handle({}, response, vi.fn()));
    const shutdown = f.server.close();
    expect(f.server.close()).toBe(shutdown);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
    const refused = { end: vi.fn(), statusCode: 200 };
    f.stack[0]!.handle({}, refused, vi.fn());
    expect(refused.statusCode).toBe(503);
    finishFirst();
    await first;
    expect(f.release).not.toHaveBeenCalled();
    finishLast();
    await Promise.all(work);
    await shutdown;
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGTERM")).toBe(signals);
    expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(f.release.mock.invocationCallOrder[0]!);
  });

  it("disconnects a pending operator challenge before draining and keeps the evaluator alive until settlement", async () => {
    const f = fixture();
    let disconnect!: () => void;
    const challenge = new Promise<void>(resolve => { disconnect = resolve; });
    f.server.ws.close = vi.fn(async () => { disconnect(); });
    let settled = false;
    f.middlewares.use(async () => { await challenge; expect(f.close).not.toHaveBeenCalled(); settled = true; });
    installAuthoringShutdown(f.server, { release: f.release });
    const pending = f.stack[0]!.handle({}, {}, vi.fn());
    await f.server.close();
    await pending;
    expect(settled).toBe(true);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("interrupts incomplete body streams before draining their handlers", async () => {
    const f = fixture();
    const request = new PassThrough();
    let finished = false;
    installAuthoringShutdown(f.server, { release: f.release });
    f.middlewares.use(async () => {
      try { for await (const chunk of request) void chunk; }
      finally { finished = true; }
    });
    const pending = Promise.resolve(f.stack[0]!.handle(request, {}, vi.fn()));
    const rejected = expect(pending).rejects.toThrow();
    await f.server.close();
    await rejected;
    expect(finished).toBe(true);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("preserves Connect error-handler arity and receiver", async () => {
    const f = fixture();
    installAuthoringShutdown(f.server, { release: f.release });
    const received: unknown[] = [];
    const handler = function (this: unknown, error: unknown, req: unknown, res: unknown, next: unknown) { received.push(this, error, req, res, next); };
    f.middlewares.use(handler);
    const args = [{ error: true }, {}, {}, vi.fn()];
    expect(f.stack[0]!.handle.length).toBe(4);
    f.stack[0]!.handle.apply(f.server, args);
    expect(received).toEqual([f.server, ...args]);
    await f.server.close();
  });

  it("drains rejected handlers but preserves the lease if Vite close itself fails", async () => {
    const f = fixture();
    const signals = process.listenerCount("SIGTERM");
    f.close.mockRejectedValue(new Error("close failed"));
    installAuthoringShutdown(f.server, { release: f.release });
    f.middlewares.use(async () => { throw new Error("request failed"); });
    await expect(f.stack[0]!.handle({}, {}, vi.fn())).rejects.toThrow("request failed");
    await expect(f.server.close()).rejects.toThrow("close failed");
    expect(f.release).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGTERM")).toBe(signals);
  });
});
