import { describe, expect, it } from "vitest";
import type { ModelProvider, ProviderTurn } from "../../assistant/provider";
import { createModelContentAiProposer } from "../model-proposer";

const provider = (turn: ProviderTurn): ModelProvider => ({ status: () => ({ ok: true, provider: "fake", label: "scripted", model: null, version: null }), turn: async () => turn });
const fields = [{ key: "title", label: "Title", kind: "text", value: "A" }, { key: "body", label: "Body", kind: "markdown", value: "B" }];
const run = (turn: ProviderTurn) => createModelContentAiProposer(provider(turn), "scripted").propose({ instruction: "shorter", fields, signal: new AbortController().signal });

describe("model-backed Content-AI proposer", () => {
  it("returns a validated proposal", async () => {
    expect(await run({ stopReason: "tool_use", content: [{ type: "tool_use", id: "1", name: "propose_article_fields", input: { title: "A2", summary: "Shortened." } }] }))
      .toEqual({ kind: "proposal", values: { title: "A2" }, summary: "Shortened." });
  });
  it("keeps declines and refusals, and never uses malformed or extra fields", async () => {
    expect(await run({ stopReason: "tool_use", content: [{ type: "tool_use", id: "1", name: "decline", input: { reason: "Not an article edit." } }] })).toEqual({ kind: "refusal", message: "Not an article edit." });
    expect(await run({ stopReason: "refusal", content: [] })).toEqual({ kind: "refusal", message: "The model declined this change." });
    expect((await run({ stopReason: "tool_use", content: [{ type: "tool_use", id: "1", name: "propose_article_fields", input: { slug: "x", summary: "" } }] })).kind).toBe("refusal");
    expect((await run({ stopReason: "end_turn", content: [{ type: "text", text: "Sure!" }] })).kind).toBe("refusal");
  });
});
