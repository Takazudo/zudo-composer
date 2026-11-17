import { describe, expect, it } from "vitest";
import { parseAssistant } from "../assistant";
const policy = [{ providerId: "content-filesystem", modelId: "course", fieldIds: ["course-price"] }];
describe("trusted Assistant Content field policy", () => {
  it.each(["fake", "anthropic", "claude-cli", "codex-cli"])("accepts explicit policy for %s without changing provider settings", provider => {
    expect(parseAssistant({ provider, contentFields: policy })).toMatchObject({ provider, contentFields: policy });
    expect(parseAssistant({ provider, contentFields: [] })).toMatchObject({ contentFields: [] });
    expect(parseAssistant({ provider })).not.toHaveProperty("contentFields");
  });
  it("rejects mixed, unknown, duplicate and unbounded policies", () => {
    for (const contentFields of [null, {}, [...policy, ...policy], [{ ...policy[0], extra: true }], [{ ...policy[0], fieldIds: ["course-price", "course-price"] }], [{ ...policy[0], modelId: "../course" }], [{ ...policy[0], fieldIds: ["bad/field"] }], Array.from({ length: 101 }, () => policy[0])]) {
      expect(() => parseAssistant({ provider: "fake", contentFields })).toThrow(/contentFields/);
    }
  });
});

it("preserves bounded declared-field instructions without importing provider defaults or granting fields", () => {
  const fieldInstructions = { "course-price": "Keep the currency suffix.\nPreserve unrelated fields." };
  const contentFields = [{ ...policy[0]!, fieldInstructions }];
  const config = parseAssistant({ provider: "codex-cli", model: "explicit-model", effort: "high", serviceTier: "priority", contentFields })!;
  expect(config).toMatchObject({ model: "explicit-model", effort: "high", serviceTier: "priority", contentFields });
  expect(config.contentFields?.[0]?.fieldInstructions).not.toBe(fieldInstructions);
  expect(parseAssistant({ provider: "fake", contentFields: policy })?.contentFields).toEqual(policy);
  expect(parseAssistant({ provider: "fake", contentFields: policy })?.contentFields?.[0]).not.toHaveProperty("fieldInstructions");
});

it("rejects foreign, inherited, malformed and oversized field instruction maps", () => {
  for (const fieldInstructions of [null, undefined, [], "instructions", { "course-private": "Unauthorized" }, { "course-price": " " }, { "course-price": 1 }, { "course-price": "a\0b" }, { "course-price": "x".repeat(4097) }, Object.create({ "course-price": "Inherited" })]) {
    expect(() => parseAssistant({ provider: "fake", contentFields: [{ ...policy[0], fieldInstructions }] })).toThrow(/contentFields/);
  }
  expect(() => parseAssistant({ provider: "fake", contentFields: Array.from({ length: 9 }, (_, i) => ({ providerId: "content-filesystem", modelId: `model-${i}`, fieldIds: ["body"], fieldInstructions: { body: "x".repeat(4096) } })) })).toThrow(/32768/);
});
