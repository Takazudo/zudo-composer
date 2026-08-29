/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useToolDialogGeometry } from "../tool-dialog-geometry";
import {
  TOOL_DIALOG_DESKTOP_GUTTER,
  TOOL_DIALOG_MIN_HEIGHT,
  TOOL_DIALOG_MIN_WIDTH,
  TOOL_DIALOG_NARROW_GUTTER,
  ToolDialogResizeHandle,
  clampToolDialogRect,
  defaultToolDialogRect,
  moveToolDialogRect,
  resizeToolDialogRect,
} from "../tool-dialog-geometry";

describe("tool-dialog geometry helpers", () => {
  it("locks the chosen 24px desktop inset and reduces it to 8px on narrow viewports", () => {
    expect(defaultToolDialogRect({ width: 1440, height: 900 })).toEqual({
      x: TOOL_DIALOG_DESKTOP_GUTTER,
      y: TOOL_DIALOG_DESKTOP_GUTTER,
      width: 1392,
      height: 852,
    });
    expect(defaultToolDialogRect({ width: 390, height: 844 })).toEqual({
      x: TOOL_DIALOG_NARROW_GUTTER,
      y: TOOL_DIALOG_NARROW_GUTTER,
      width: 374,
      height: 828,
    });
  });

  it("moves only position and clamps every edge while preserving the default size", () => {
    const viewport = { width: 1024, height: 768 };
    const initial = defaultToolDialogRect(viewport);
    expect(moveToolDialogRect(initial, -999, 999, viewport)).toEqual({ x: 0, y: 48, width: 976, height: 720 });
  });

  it("shrinks an oversized rect after viewport changes so both top controls remain reachable", () => {
    expect(clampToolDialogRect({ x: 200, y: 200, width: 976, height: 720 }, { width: 390, height: 300 })).toEqual({
      x: 16,
      y: 16,
      width: 374,
      height: 284,
    });
  });

  it("enforces the reusable resize floor and the current viewport maximum", () => {
    const viewport = { width: 800, height: 600 };
    const minimum = { width: TOOL_DIALOG_MIN_WIDTH, height: TOOL_DIALOG_MIN_HEIGHT };
    expect(resizeToolDialogRect({ x: 24, y: 24, width: 500, height: 400 }, -999, -999, viewport, minimum)).toEqual({
      x: 24,
      y: 24,
      width: TOOL_DIALOG_MIN_WIDTH,
      height: TOOL_DIALOG_MIN_HEIGHT,
    });
    expect(resizeToolDialogRect({ x: 24, y: 24, width: 500, height: 400 }, 999, 999, viewport, minimum)).toEqual({
      x: 24,
      y: 24,
      width: 752,
      height: 552,
    });
  });
});

describe("ToolDialogResizeHandle", () => {
  it("uses pointer capture and exposes keyboard resize/reset controls", () => {
    function Harness() {
      const geometry = useToolDialogGeometry({ open: true });
      return (
        <>
          <output data-testid="rect">{`${geometry.rect.width}x${geometry.rect.height}`}</output>
          <ToolDialogResizeHandle geometry={geometry} />
        </>
      );
    }

    render(<Harness />);
    const handle = screen.getByRole("button", { name: "Resize dialog" });
    const rect = screen.getByTestId("rect");
    const capture = vi.fn();
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: capture });

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(rect).toHaveTextContent("944x688");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 11, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 11, clientX: 42, clientY: 42 });
    fireEvent.pointerUp(handle, { pointerId: 11 });
    expect(capture).toHaveBeenCalledWith(11);
    expect(rect).toHaveTextContent("976x720");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(rect).toHaveTextContent("960x720");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(rect).toHaveTextContent("976x720");
    expect(handle).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Shift+ArrowRight"));
  });
});
