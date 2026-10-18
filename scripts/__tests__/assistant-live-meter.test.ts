// @vitest-environment node
// Harness self-test for the live lane's pass-through meter against a loopback
// fake upstream. This proves the meter's safety rules; it is not live inference.
import { afterEach, describe, expect, it } from "vitest";
import { startFakeMessagesApi } from "../fixtures/assistant/fake-messages-api.mjs";
import { costOf, startLiveMeter } from "../assistant/live-meter.mjs";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });
async function setup(limits: { maxUsd: number; maxRequests: number }) {
  const upstream = await startFakeMessagesApi(); cleanup.push(upstream.close);
  const meter = await startLiveMeter({ upstream: upstream.url, ...limits }); cleanup.push(meter.close);
  return { upstream, meter };
}
const post = (base: string, body: Record<string, unknown>) => fetch(`${base}/v1/messages?beta=true`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "test-key", "anthropic-beta": "server-side-fallback-2026-07-01" }, body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 1000, stream: true, messages: [{ role: "user", content: "hi" }], ...body }) });

describe("live lane meter", () => {
  it("forwards requests and streams responses unchanged, records the contract, never the credential", async () => {
    const { upstream, meter } = await setup({ maxUsd: 1, maxRequests: 5 });
    const turn = { blocks: [{ type: "thinking" as const, thinking: "", signature: "s" }, { type: "fallback" as const, from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } }, { type: "text" as const, text: "Hello there" }] };
    upstream.script([turn, turn]);
    const direct = await (await post(upstream.url, {})).text();
    const metered = await (await post(meter.url, { thinking: { type: "adaptive" }, output_config: { effort: "medium" }, fallbacks: "default", tools: [{ name: "inspect_page", eager_input_streaming: true, input_schema: { type: "object" } }] })).text();
    expect(metered.replace(/msg_fake_\d+/g, "id")).toBe(direct.replace(/msg_fake_\d+/g, "id"));
    expect(upstream.requests().at(-1)!.beta).toBe("server-side-fallback-2026-07-01");
    const [record] = meter.records();
    expect(record).toMatchObject({ requestedModel: "claude-opus-5-5", servedModel: "claude-opus-5", stopReason: "end_turn", effort: "medium", fallbacks: "default", thinking: { type: "adaptive" }, blocks: ["thinking", "fallback", "text"], fallbackHops: [{ from: "claude-opus-5-5", to: "claude-opus-5" }], tools: [{ name: "inspect_page", eager: true }], refused: null });
    expect(JSON.stringify(meter.records())).not.toContain("test-key");
    expect(meter.spent()).toBeCloseTo(costOf({ input_tokens: 1, output_tokens: 10 }, "claude-opus-5"));
    expect(meter.reserved()).toBe(0);
  });

  it("refuses before forwarding when the worst case would exceed the spend cap or the request limit", async () => {
    const capped = await setup({ maxUsd: 0.001, maxRequests: 5 });
    const refused = await post(capped.meter.url, { max_tokens: 16000 });
    expect(refused.status).toBe(400);
    expect(capped.upstream.requests()).toHaveLength(0);
    expect(capped.meter.records()[0]).toMatchObject({ refused: "spend-cap" });

    const limited = await setup({ maxUsd: 5, maxRequests: 1 });
    limited.upstream.script([{ text: "one" }]);
    expect((await post(limited.meter.url, {})).status).toBe(200);
    expect((await post(limited.meter.url, {})).status).toBe(400);
    expect(limited.upstream.requests()).toHaveLength(1);
    expect(limited.meter.records()[1]).toMatchObject({ refused: "request-limit" });
  });

  it("prices every fallback iteration at its own model, never below the top-level usage", () => {
    const usage = { input_tokens: 100, output_tokens: 10, iterations: [{ type: "message", model: "claude-opus-5-5", input_tokens: 1_000, output_tokens: 500 }, { type: "fallback_message", model: "claude-opus-5", input_tokens: 100, output_tokens: 10 }] };
    expect(costOf(usage, "claude-opus-5")).toBeCloseTo((1_000 * 4 + 500 * 20 + 100 * 5 + 10 * 25) / 1_000_000);
  });

  it("refuses non-https upstreams other than loopback", async () => {
    await expect(startLiveMeter({ upstream: "http://api.example.com", maxUsd: 1, maxRequests: 1 })).rejects.toThrow(/https/);
  });
});
