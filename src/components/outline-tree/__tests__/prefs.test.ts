import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OUTLINE_PREFS,
  outlinePrefsStorageKey,
  readOutlinePrefs,
  writeOutlinePrefs,
} from "../prefs";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("outline prefs", () => {
  it("starts with both columns visible", () => {
    expect(readOutlinePrefs("sitemapper")).toEqual({ slug: true, count: true });
    expect(DEFAULT_OUTLINE_PREFS).toEqual({ slug: true, count: true });
  });

  it("round-trips under a key of its own, so two trees do not share a choice", () => {
    writeOutlinePrefs("sitemapper", { slug: false, count: true });
    expect(localStorage.getItem(outlinePrefsStorageKey("sitemapper"))).toBe('{"slug":false,"count":true}');
    expect(readOutlinePrefs("sitemapper")).toEqual({ slug: false, count: true });
    expect(readOutlinePrefs("content")).toEqual(DEFAULT_OUTLINE_PREFS);
  });

  it("persists nothing without a key", () => {
    writeOutlinePrefs(undefined, { slug: false, count: false });
    expect(localStorage.length).toBe(0);
    expect(readOutlinePrefs(undefined)).toEqual(DEFAULT_OUTLINE_PREFS);
  });

  it("falls back to the defaults for junk, a wrong shape, or a partial record", () => {
    localStorage.setItem(outlinePrefsStorageKey("a"), "not json");
    expect(readOutlinePrefs("a")).toEqual(DEFAULT_OUTLINE_PREFS);
    localStorage.setItem(outlinePrefsStorageKey("b"), "[]");
    expect(readOutlinePrefs("b")).toEqual(DEFAULT_OUTLINE_PREFS);
    localStorage.setItem(outlinePrefsStorageKey("c"), '{"slug":false}');
    expect(readOutlinePrefs("c")).toEqual({ slug: false, count: true });
  });

  it("degrades to the defaults when storage itself throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readOutlinePrefs("sitemapper")).toEqual(DEFAULT_OUTLINE_PREFS);
    expect(() => writeOutlinePrefs("sitemapper", { slug: false, count: false })).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });
});
