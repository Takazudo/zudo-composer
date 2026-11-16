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
