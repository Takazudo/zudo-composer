import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSER_VIEWPORTS,
  COMPOSER_VIEWPORT_WIDTHS,
  LS_COMPOSER_VIEWPORT,
  getPersistedViewport,
  isComposerViewport,
  setPersistedViewport,
} from "../viewport";

describe("composer viewport model (#251)", () => {
  beforeEach(() => localStorage.clear());

  it("covers exactly the four canvas viewports, fluid first", () => {
    expect(COMPOSER_VIEWPORTS).toEqual(["fluid", "desktop", "tablet", "mobile"]);
  });

  it("fluid has no fixed width; the rest are concrete device widths", () => {
    expect(COMPOSER_VIEWPORT_WIDTHS.fluid).toBeNull();
    expect(COMPOSER_VIEWPORT_WIDTHS.desktop).toBeGreaterThan(COMPOSER_VIEWPORT_WIDTHS.tablet!);
    expect(COMPOSER_VIEWPORT_WIDTHS.tablet).toBeGreaterThan(COMPOSER_VIEWPORT_WIDTHS.mobile!);
  });

  it("guards unknown values", () => {
    expect(isComposerViewport("mobile")).toBe(true);
    expect(isComposerViewport("phone")).toBe(false);
    expect(isComposerViewport(null)).toBe(false);
  });

  it("round-trips a persisted choice", () => {
    expect(getPersistedViewport()).toBeNull();
    setPersistedViewport("tablet");
    expect(localStorage.getItem(LS_COMPOSER_VIEWPORT)).toBe("tablet");
    expect(getPersistedViewport()).toBe("tablet");
  });

  it("ignores a corrupt persisted value rather than returning garbage", () => {
    localStorage.setItem(LS_COMPOSER_VIEWPORT, "ultrawide");
    expect(getPersistedViewport()).toBeNull();
  });
});
