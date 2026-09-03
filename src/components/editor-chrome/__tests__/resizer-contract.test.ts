// Ported from `src/features/composer/chrome/__tests__/resizer-contract.test.ts`.
// The clamp cases are the same shape against the generalised constants
// (200/520 rails, main >= 320); the storage cases gained the per-editor keys.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INSP_W,
  DEFAULT_NAV_W,
  MAX_RAIL_W,
  MIN_MAIN_W,
  MIN_RAIL_W,
  RESIZER_TRACK_W,
  clampRailWidth,
  cssVarForRail,
  getPersistedWidth,
  maxRailWidth,
  railStorageKey,
  readEditorWidths,
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

  it("protects MIN_MAIN_W: the two rails' max never eats the whole viewport", () => {
    const viewport = 1024;
    const otherRail = MAX_RAIL_W;
    const max = maxRailWidth(otherRail, viewport);
    expect(viewport - otherRail - max - RESIZER_TRACK_W).toBeGreaterThanOrEqual(
      Math.min(MIN_MAIN_W, viewport - otherRail - MIN_RAIL_W - RESIZER_TRACK_W),
    );
  });

  it("hands the whole remainder to the main column when the viewport is the binding constraint", () => {
    // 1000 - 200 (other rail) - 320 (main) - 2 (tracks) = 478, below MAX_RAIL_W.
    expect(maxRailWidth(MIN_RAIL_W, 1000)).toBe(1000 - MIN_RAIL_W - MIN_MAIN_W - RESIZER_TRACK_W);
    expect(clampRailWidth(900, MIN_RAIL_W, 900)).toBe(900 - MIN_RAIL_W - MIN_MAIN_W - RESIZER_TRACK_W);
  });

  it("clampRailWidth floors at MIN_RAIL_W for a too-small request", () => {
    expect(clampRailWidth(10, MIN_RAIL_W, 2000)).toBe(MIN_RAIL_W);
  });
});

describe("getPersistedWidth / setPersistedWidth", () => {
  const key = railStorageKey("composer", "nav");

  it("keys the geometry per editor and per rail", () => {
    expect(railStorageKey("composer", "nav")).toBe("zudo-composer:editor:composer:nav-w");
    expect(railStorageKey("sitemapper", "insp")).toBe("zudo-composer:editor:sitemapper:insp-w");
    expect(railStorageKey("composer", "nav")).not.toBe(railStorageKey("sitemapper", "nav"));
  });

  it("names the two rail custom properties", () => {
    expect(cssVarForRail("nav")).toBe("--nav-w");
    expect(cssVarForRail("insp")).toBe("--insp-w");
  });

  it("round-trips a persisted width", () => {
    setPersistedWidth(key, 300);
    expect(getPersistedWidth(key, 999)).toBe(300);
  });

  it("falls back when nothing is stored or the value is not numeric", () => {
    expect(getPersistedWidth(key, 250)).toBe(250);
    localStorage.setItem(key, "not-a-number");
    expect(getPersistedWidth(key, 250)).toBe(250);
  });

  it("never throws when storage is blocked", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setPersistedWidth(key, 300)).not.toThrow();
    expect(getPersistedWidth(key, 250)).toBe(250);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe("readEditorWidths", () => {
  it("falls back to the editor defaults when nothing is persisted", () => {
    expect(readEditorWidths("composer", { viewportWidth: 1600 })).toEqual({
      nav: DEFAULT_NAV_W,
      insp: DEFAULT_INSP_W,
    });
  });

  it("honours a caller's fresh-session defaults", () => {
    expect(readEditorWidths("composer", { nav: 320, viewportWidth: 1600 }).nav).toBe(320);
  });

  it("restores each editor's own persisted geometry", () => {
    localStorage.setItem(railStorageKey("composer", "nav"), "312");
    localStorage.setItem(railStorageKey("composer", "insp"), "344");
    localStorage.setItem(railStorageKey("sitemapper", "nav"), "260");

    expect(readEditorWidths("composer", { viewportWidth: 1600 })).toEqual({ nav: 312, insp: 344 });
    expect(readEditorWidths("sitemapper", { viewportWidth: 1600 }).nav).toBe(260);
  });

  it("re-clamps geometry stored on a wider viewport", () => {
    localStorage.setItem(railStorageKey("composer", "nav"), "520");
    localStorage.setItem(railStorageKey("composer", "insp"), "520");

    const widths = readEditorWidths("composer", { viewportWidth: 1024 });
    expect(widths.nav).toBeLessThan(520);
    expect(1024 - widths.nav - widths.insp - RESIZER_TRACK_W).toBeGreaterThanOrEqual(0);
  });
});
