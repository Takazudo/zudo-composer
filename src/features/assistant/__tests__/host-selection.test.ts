import { afterEach, expect, it, vi } from "vitest";
import { takeHostSelection, writeHostSelection } from "../host-selection";
const selection = { revision: "a".repeat(64), pathname: "/lessons", target: { renderedNodeId: "placed", providerId: "files", recordId: "page", nodeId: "owner" }, prop: "price" };
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
it("hands off exact qualified selection once and only to its workspace", () => {
  writeHostSelection(sessionStorage, "one", selection);
  expect(takeHostSelection(sessionStorage, "two")).toBeNull();
  expect(takeHostSelection(sessionStorage, "one")).toEqual(selection);
  expect(takeHostSelection(sessionStorage, "one")).toBeNull();
});
it("rejects stale handoffs and forged extra authority", () => {
  vi.useFakeTimers(); writeHostSelection(sessionStorage, "one", selection);
  vi.advanceTimersByTime(600001);
  expect(() => takeHostSelection(sessionStorage, "one")).toThrow("expired");
  expect(() => writeHostSelection(sessionStorage, "one", { ...selection, capabilityId: "forged" } as typeof selection)).toThrow();
});
