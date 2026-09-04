import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "../roving";

describe("nextRovingIndex", () => {
  it("ignores keys the roving contract does not own", () => {
    expect(nextRovingIndex("Enter", 0, 3)).toBeNull();
    expect(nextRovingIndex(" ", 0, 3)).toBeNull();
    expect(nextRovingIndex("Tab", 0, 3)).toBeNull();
  });

  it("wraps in both directions", () => {
    expect(nextRovingIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextRovingIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("jumps to the ends", () => {
    expect(nextRovingIndex("Home", 2, 3)).toBe(0);
    expect(nextRovingIndex("End", 0, 3)).toBe(2);
  });

  it("answers the vertical arrows only in the radio-group orientation", () => {
    expect(nextRovingIndex("ArrowDown", 0, 3)).toBeNull();
    expect(nextRovingIndex("ArrowUp", 0, 3)).toBeNull();
    expect(nextRovingIndex("ArrowDown", 0, 3, { orientation: "both" })).toBe(1);
    expect(nextRovingIndex("ArrowUp", 0, 3, { orientation: "both" })).toBe(2);
  });

  it("skips disabled entries, including at the ends", () => {
    const isDisabled = (index: number) => index === 1;
    expect(nextRovingIndex("ArrowRight", 0, 3, { isDisabled })).toBe(2);
    expect(nextRovingIndex("ArrowLeft", 2, 3, { isDisabled })).toBe(0);
    expect(nextRovingIndex("End", 0, 3, { isDisabled: (index) => index === 2 })).toBe(1);
    expect(nextRovingIndex("Home", 2, 3, { isDisabled: (index) => index === 0 })).toBe(1);
  });

  it("returns null when nothing is reachable", () => {
    expect(nextRovingIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextRovingIndex("ArrowRight", 0, 2, { isDisabled: () => true })).toBeNull();
  });
});
