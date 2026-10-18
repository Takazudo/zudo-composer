// Adapter contract against a loopback scripted Messages API (fake-provider evidence, not live inference).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeMessagesApi } from "../../../scripts/fixtures/assistant/fake-messages-api.mjs";
import { createAnthropicProvider } from "../anthropic-provider";
import { parseAssistant } from "../../config/assistant";

let api: Awaited<ReturnType<typeof startFakeMessagesApi>>;
beforeAll(async () => { api = await startFakeMessagesApi(); });
afterAll(async () => { await api.close(); });

const provider = () => createAnthropicProvider(parseAssistant({ baseUrl: api.url, apiKeyEnv: "ZUDO_ASSISTANT_TEST_KEY", effort: "high" })!, { ZUDO_ASSISTANT_TEST_KEY: "test-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: "session-token" });
const request = (onText: (delta: string) => void = () => {}) => ({ system: "system", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], tools: [{ name: "inspect_page", description: "d", inputSchema: { type: "object", properties: {} } }], signal: new AbortController().signal, onText });

describe("Anthropic adapter", () => {
  it("sends the pinned request contract: model, adaptive thinking, effort, default fallbacks and eager tool input", async () => {
    api.script([{ text: "ok" }]);
    await provider().turn(request());
    const sent = api.requests().at(-1)!;
    expect(sent.body).toMatchObject({ model: "claude-opus-5-5", thinking: { type: "adaptive" }, output_config: { effort: "high" }, fallbacks: "default", tool_choice: { type: "auto" }, stream: true });
    expect(sent.body.tools).toEqual([expect.objectContaining({ name: "inspect_page", eager_input_streaming: true })]);
    expect(sent.beta).toContain("server-side-fallback-2026-07-01");
  });

  it("after a mid-output fallback, neither runs nor echoes the declining model's thinking and tool calls", async () => {
    api.script([{ blocks: [
      { type: "thinking", thinking: "", signature: "declined-signature" },
      { type: "text", text: "Let me " },
      { type: "tool_use", name: "propose_changes", input: { operations: [] } },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      { type: "thinking", thinking: "", signature: "served-signature" },
      { type: "text", text: "check the page." },
      { type: "tool_use", name: "inspect_page", input: {} },
    ] }]);
    const turn = await provider().turn(request());
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.content.filter(block => block.type === "tool_use").map(block => block.type === "tool_use" && block.name)).toEqual(["inspect_page"]);
    const opaque = turn.content.flatMap(block => block.type === "opaque" ? [(block.value as { type: string; signature?: string })] : []);
    expect(opaque.map(block => block.type)).toEqual(["fallback", "thinking"]);
    expect(opaque.some(block => block.signature === "declined-signature")).toBe(false);
    expect(turn.content.flatMap(block => block.type === "text" ? [block.text] : [])).toEqual(["Let me ", "check the page."]);
  });

  it("keeps every block of an ordinary turn in order", async () => {
    api.script([{ blocks: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "a" }, { type: "tool_use", name: "inspect_page", input: {} }] }]);
    const turn = await provider().turn(request());
    expect(turn.content.map(block => block.type)).toEqual(["opaque", "text", "tool_use"]);
  });
});
