import { describe, expect, it } from "vitest";
import type { ModelProvider, ProviderTurn } from "../../assistant/provider";
import { createModelContentAiProposer } from "../model-proposer";

const provider = (turn: ProviderTurn): ModelProvider => ({ status: () => ({ ok: true, provider: "fake", label: "scripted", model: null, version: null }), turn: async () => turn });
const fields = [{ key: "title", label: "Title", kind: "text", value: "A" }, { key: "body", label: "Body", kind: "markdown", value: "B" }];
const run = (turn: ProviderTurn) => createModelContentAiProposer(provider(turn), "scripted").propose({ instruction: "shorter", fields, signal: new AbortController().signal });

describe("model-backed Content-AI proposer", () => {
  it("uses dynamic strict policy fields, including a field named summary without collision", async () => {
    const fields = [{ key: "price", label: "Course price", kind: "text", value: "Old" }, { key: "summary", label: "Summary", kind: "text", value: "Before" }];
    let offered: unknown;
    const model: ModelProvider = { ...provider({ stopReason: "end_turn", content: [] }), turn: async request => { offered = request.tools; return { stopReason: "tool_use", content: [{ type: "tool_use", id: "1", name: "propose_content_fields", input: { values: { price: "¥10,000", summary: "New field value" }, summary: "Requested price and summary" } }] }; } };
    const result = await createModelContentAiProposer(model, "configured").propose({ instruction: "Change price and summary", fields, signal: new AbortController().signal });
    expect(result).toEqual({ kind: "proposal", values: { price: "¥10,000", summary: "New field value" }, summary: "Requested price and summary" });
    expect(offered).toMatchObject([{ name: "propose_content_fields", inputSchema: { properties: { values: { additionalProperties: false, properties: { price: { type: "string" }, summary: { type: "string" } } } } } }, { name: "decline" }]);
    for (const input of [{ values: { price: "ok", other: "forbidden" }, summary: "x" }, { values: { price: 12 }, summary: "x" }, { price: "old shape", summary: "x" }]) {
      const invalid = provider({ stopReason: "tool_use", content: [{ type: "tool_use", id: "1", name: "propose_content_fields", input }] });
      expect((await createModelContentAiProposer(invalid, "configured").propose({ instruction: "x", fields, signal: new AbortController().signal })).kind).toBe("refusal");
    }
  });
  it("refuses multiple actions instead of silently accepting the first", async () => {
    expect((await run({ stopReason: "tool_use", content: [
      { type: "tool_use", id: "1", name: "propose_article_fields", input: { title: "A2", summary: "One" } },
      { type: "tool_use", id: "2", name: "decline", input: { reason: "No" } },
    ] })).kind).toBe("refusal");
  });
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
