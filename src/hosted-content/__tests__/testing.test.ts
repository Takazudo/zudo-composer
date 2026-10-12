import { describe, expect, it } from "vitest";
import { createMemoryHostedConformanceFactory, runHostedContentConformance } from "../testing";

describe("public hosted Content conformance runner", () => {
  it("executes fault, interleaving, replay and two-publication cases without a test-framework dependency", async () => {
    const result = await runHostedContentConformance(createMemoryHostedConformanceFactory());
    expect(result.scenarios).toEqual([
      "independent-cas", "duplicate-create-and-key-reuse", "competing-reorder",
      "rollback-before-commit", "rollback-receipt-persistence", "conditional-commit-atomicity", "commit-retry-after-bookkeeping", "lost-create-ack-restart",
      "coherent-immutable-capture", "two-integrations-existing-entry", "two-integrations-new-entry",
      "external-baseline-and-definition-conflict", "external-integration-conflict",
    ]);
    expect(result.assertions).toBeGreaterThan(70);
  });
});
