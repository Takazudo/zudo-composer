import { describe, expect, it } from "vitest";
import { AUTHORING_READ_HEADER, retryAuthoringRead } from "../authoring-read-retry";
import { transportFailureMessage } from "../coordination-error";

const DEV = "The development content provider is unavailable. Confirm `pnpm dev` is running and retry.";

describe("native coordination refusals after leaving a mid-round route", () => {
  it("keeps a read waiting while binds are refused as authoring-busy, then completes once bound", async () => {
    let refusals = 3;
    const ready = async () => { if (refusals-- > 0) throw Object.assign(new Error("settling"), { code: "authoring-busy" }); };
    const response = await retryAuthoringRead("/read", { headers: { [AUTHORING_READ_HEADER]: "1" } }, async () => { await ready(); return new Response("ok"); }, { delayMs: 1 });
    expect(await response.text()).toBe("ok");
    expect(refusals).toBe(-1);
  });
  it("never reports a coordination refusal as a missing dev server", () => {
    expect(transportFailureMessage(Object.assign(new Error("x"), { code: "authoring-busy" }), DEV)).toMatch(/coordination is settling/);
    expect(transportFailureMessage(Object.assign(new Error("x"), { code: "stale-browser" }), DEV)).toMatch(/session changed/);
    expect(transportFailureMessage(new TypeError("Failed to fetch"), DEV)).toBe(DEV);
  });
});
