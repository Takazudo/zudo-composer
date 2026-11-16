import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHORING_READ_HEADER, retryAuthoringRead } from "../authoring-read-retry";
const read = { headers: { [AUTHORING_READ_HEADER]: "1" } };
const refusal = (code: string) => new Response(JSON.stringify({ ok: false, error: { code } }), { status: 409 });
afterEach(() => vi.useRealTimers());
describe("coordinated read retries", () => {
  it("waits through client freeze and server admission refusal then returns untouched response", async () => {
    const response = new Response(JSON.stringify({ ok: true, result: ["course"] }));
    const attempt = vi.fn().mockRejectedValueOnce(Object.assign(new Error("frozen"), { code: "authoring-busy" })).mockResolvedValueOnce(refusal("authoring-busy")).mockResolvedValueOnce(response);
    expect(await retryAuthoringRead("/provider", read, attempt, { delayMs: 1 })).toBe(response);
    expect(await response.json()).toEqual({ ok: true, result: ["course"] });
    expect(attempt).toHaveBeenCalledTimes(3);
  });
  it("never replays writes or unknown operations", async () => {
    const attempt = vi.fn(async () => refusal("authoring-busy"));
    expect((await retryAuthoringRead("/provider", { method: "POST", body: "write" }, attempt)).status).toBe(409);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it.each(["stale-browser", "commit-uncertain", "conflict"])("does not retry %s", async code => {
    const attempt = vi.fn(async () => refusal(code));
    await retryAuthoringRead("/provider", read, attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("does not replay a disconnected transport or a stale session", async () => {
    for (const error of [new Error("disconnected"), Object.assign(new Error("stale"), { code: "stale-browser" })]) {
      const attempt = vi.fn(async () => { throw error; });
      await expect(retryAuthoringRead("/provider", read, attempt)).rejects.toBe(error);
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
  it("aborts a waiting read without sending another request", async () => {
    const controller = new AbortController();
    const attempt = vi.fn(async () => { controller.abort(new Error("cancelled")); return refusal("authoring-busy"); });
    await expect(retryAuthoringRead("/provider", { ...read, signal: controller.signal }, attempt)).rejects.toThrow("cancelled");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated refusals and cancels the in-flight signal", async () => {
    let captured: AbortSignal | undefined;
    const attempt = vi.fn(async (signal?: AbortSignal) => { captured = signal; return refusal("authoring-busy"); });
    await expect(retryAuthoringRead("/provider", read, attempt, { timeoutMs: 25, delayMs: 5 })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(captured?.aborted).toBe(true);
    expect(attempt.mock.calls.length).toBeLessThan(8);
  });
});
