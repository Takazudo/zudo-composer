import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LS_TREE_WIDTH,
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

describe("Sitemapper resizer contract", () => {
  it("caps a rail at MAX_RAIL_W when the viewport has room", () => {
    expect(maxRailWidth(MIN_RAIL_W, 2000)).toBe(MAX_RAIL_W);
    expect(clampRailWidth(10_000, MIN_RAIL_W, 2000)).toBe(MAX_RAIL_W);
  });

  it("floors a rail at MIN_RAIL_W and protects the useful canvas", () => {
    expect(maxRailWidth(MAX_RAIL_W, 100)).toBe(MIN_RAIL_W);
    expect(clampRailWidth(1, MIN_RAIL_W, 2000)).toBe(MIN_RAIL_W);
    const viewport = 1024;
    const max = maxRailWidth(MAX_RAIL_W, viewport);
    expect(viewport - MAX_RAIL_W - max - RESIZER_TRACK_W).toBeGreaterThanOrEqual(
      Math.min(MIN_CANVAS_W, viewport - MAX_RAIL_W - MIN_RAIL_W - RESIZER_TRACK_W),
    );
  });

  it("round-trips a persisted width and falls back for invalid values", () => {
    setPersistedWidth(LS_TREE_WIDTH, 301.6);
    expect(getPersistedWidth(LS_TREE_WIDTH, 999)).toBe(302);
    localStorage.setItem(LS_TREE_WIDTH, "not-a-number");
    expect(getPersistedWidth(LS_TREE_WIDTH, 250)).toBe(250);
  });

  it("does not throw when storage is blocked", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setPersistedWidth(LS_TREE_WIDTH, 300)).not.toThrow();
    expect(getPersistedWidth(LS_TREE_WIDTH, 250)).toBe(250);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
