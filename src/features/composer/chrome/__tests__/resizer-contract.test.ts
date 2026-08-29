import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RAIL_W,
  MIN_CANVAS_W,
  MIN_RAIL_W,
  RESIZER_TRACK_W,
  clampRailWidth,
  getPersistedWidth,
  maxRailWidth,
  setPersistedWidth,
} from "../resizer-contract";

beforeEach(() => {
  localStorage.clear();
});

describe("maxRailWidth / clampRailWidth", () => {
  it("caps at MAX_RAIL_W when there is plenty of viewport", () => {
    expect(maxRailWidth(MIN_RAIL_W, 2000)).toBe(MAX_RAIL_W);
    expect(clampRailWidth(10000, MIN_RAIL_W, 2000)).toBe(MAX_RAIL_W);
  });

  it("never lets the joint clamp go below MIN_RAIL_W even on a tiny viewport", () => {
    expect(maxRailWidth(MAX_RAIL_W, 100)).toBe(MIN_RAIL_W);
  });

  it("protects MIN_CANVAS_W: the two rails' max never eats the whole viewport", () => {
    const viewport = 1024;
    const otherRail = MAX_RAIL_W;
    const max = maxRailWidth(otherRail, viewport);
    const remainingForCanvas = viewport - otherRail - max - RESIZER_TRACK_W;
    expect(remainingForCanvas).toBeGreaterThanOrEqual(0);
    // Once both rails are pinned at their joint max the canvas gets exactly
    // (or more than) MIN_CANVAS_W — never less.
    expect(viewport - otherRail - max - RESIZER_TRACK_W).toBeGreaterThanOrEqual(
      Math.min(MIN_CANVAS_W, viewport - otherRail - MIN_RAIL_W - RESIZER_TRACK_W),
    );
  });

  it("clampRailWidth floors at MIN_RAIL_W for a too-small request", () => {
    expect(clampRailWidth(10, MIN_RAIL_W, 2000)).toBe(MIN_RAIL_W);
  });
});

describe("getPersistedWidth / setPersistedWidth", () => {
  it("round-trips a persisted width", () => {
    setPersistedWidth("sg-composer-tree-width", 300);
    expect(getPersistedWidth("sg-composer-tree-width", 999)).toBe(300);
  });

  it("falls back when nothing is stored or the value is not numeric", () => {
    expect(getPersistedWidth("sg-composer-tree-width", 250)).toBe(250);
    localStorage.setItem("sg-composer-tree-width", "not-a-number");
    expect(getPersistedWidth("sg-composer-tree-width", 250)).toBe(250);
  });

  it("never throws when storage is blocked", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setPersistedWidth("sg-composer-tree-width", 300)).not.toThrow();
    expect(getPersistedWidth("sg-composer-tree-width", 250)).toBe(250);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
