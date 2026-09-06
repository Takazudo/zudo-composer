import { describe, expect, it } from "vitest";
import { parseActivatedDeliverySource } from "../source";

describe("activated delivery source messages", () => {
  it("accepts explicit unavailable states and rejects malformed ready payloads", () => {
    expect(parseActivatedDeliverySource({ status: "no-active", message: "Nothing activated." })).toEqual({ status: "no-active", message: "Nothing activated." });
    expect(parseActivatedDeliverySource({ status: "error", message: "Unreadable." })).toEqual({ status: "error", message: "Unreadable." });
    expect(parseActivatedDeliverySource({ status: "ready", artifact: { project: null } })).toBeUndefined();
    expect(parseActivatedDeliverySource({ status: "no-active" })).toBeUndefined();
    expect(parseActivatedDeliverySource(null)).toBeUndefined();
  });
});
