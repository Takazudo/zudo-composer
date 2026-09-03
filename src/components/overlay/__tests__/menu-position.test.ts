import { describe, expect, it } from "vitest";
import {
  computeMenuPosition,
  MENU_GAP,
  MENU_MIN_HEIGHT,
  MENU_VIEWPORT_MARGIN,
  type MenuAnchorRect,
} from "../menu-position";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 240 };

function anchorAt(left: number, top: number): MenuAnchorRect {
  return { left, top, width: 120, height: 30 };
}

describe("computeMenuPosition", () => {
  it("opens below the anchor, left-aligned, when there is room", () => {
    const position = computeMenuPosition(anchorAt(300, 100), size, viewport);
    expect(position).toMatchObject({ left: 300, top: 100 + 30 + MENU_GAP, side: "bottom" });
  });

  it("aligns the menu's right edge to the anchor's right edge when asked", () => {
    const position = computeMenuPosition(anchorAt(300, 100), size, viewport, { align: "end" });
    expect(position.left).toBe(300 + 120 - size.width);
  });

  it("clamps against the right edge instead of overflowing it", () => {
    const position = computeMenuPosition(anchorAt(940, 100), size, viewport);
    expect(position.left).toBe(viewport.width - size.width - MENU_VIEWPORT_MARGIN);
    expect(position.left + size.width).toBeLessThanOrEqual(viewport.width - MENU_VIEWPORT_MARGIN);
  });

  it("clamps against the left edge when the anchor is partly scrolled out of view", () => {
    const position = computeMenuPosition(anchorAt(-60, 100), size, viewport, { align: "end" });
    expect(position.left).toBe(MENU_VIEWPORT_MARGIN);
  });

  it("flips above the anchor when the bottom edge cannot hold the menu", () => {
    const anchor = anchorAt(300, 700);
    const position = computeMenuPosition(anchor, size, viewport);
    expect(position.side).toBe("top");
    expect(position.top).toBe(anchor.top - MENU_GAP - size.height);
    expect(position.top).toBeGreaterThanOrEqual(MENU_VIEWPORT_MARGIN);
  });

  it("clamps against the top edge when neither side can hold the menu", () => {
    const shortViewport = { width: 1000, height: 100 };
    const position = computeMenuPosition(anchorAt(300, 40), size, shortViewport);
    expect(position.side).toBe("top");
    expect(position.top).toBe(MENU_VIEWPORT_MARGIN);
  });

  it("takes the roomier side when the menu is taller than both", () => {
    const tall = { width: 200, height: 900 };
    const position = computeMenuPosition(anchorAt(300, 400), tall, viewport);
    expect(position.side).toBe("top");
    expect(position.top).toBe(MENU_VIEWPORT_MARGIN);
    expect(position.maxHeight).toBe(400 - MENU_GAP - MENU_VIEWPORT_MARGIN);
  });

  it("pins a menu wider than the viewport to the inline margin and caps its height", () => {
    const huge = { width: 1400, height: 1200 };
    const position = computeMenuPosition(anchorAt(300, 100), huge, viewport);
    expect(position.left).toBe(MENU_VIEWPORT_MARGIN);
    expect(position.top + position.maxHeight).toBe(viewport.height - MENU_VIEWPORT_MARGIN);
  });

  it("caps the panel height to the room on the chosen side so long lists scroll", () => {
    const position = computeMenuPosition(anchorAt(300, 600), { width: 200, height: 400 }, viewport);
    const roomAbove = 600 - MENU_GAP - MENU_VIEWPORT_MARGIN;
    expect(position.side).toBe("top");
    expect(position.maxHeight).toBe(roomAbove);
  });

  it("never reports a max height below the readable minimum", () => {
    const position = computeMenuPosition(anchorAt(300, 780), size, { width: 1000, height: 800 });
    expect(position.maxHeight).toBeGreaterThanOrEqual(MENU_MIN_HEIGHT);
  });

  it("honours a custom gap and margin", () => {
    const position = computeMenuPosition(anchorAt(300, 100), size, viewport, { gap: 12, margin: 24 });
    expect(position.top).toBe(100 + 30 + 12);
    const clamped = computeMenuPosition(anchorAt(980, 100), size, viewport, { gap: 12, margin: 24 });
    expect(clamped.left).toBe(viewport.width - size.width - 24);
  });
});
