/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Shared, session-local geometry for Composer's editor-tool dialogs.
//
// The chooser currently uses the movable half of this module. The New
// composition dialog can use the same default rect and the exported resize
// handle without making geometry part of a Composition or a browser setting.

import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** Desktop inset on every viewport edge. Keep this in sync with the CSS var. */
export const TOOL_DIALOG_DESKTOP_GUTTER = 24;
/** Smaller safe inset once a desktop gutter would make a narrow shell cramped. */
export const TOOL_DIALOG_NARROW_GUTTER = 8;
/** Content-driven breakpoint shared with the chooser's narrow two-pane layout. */
export const TOOL_DIALOG_NARROW_VIEWPORT_MAX = 640;
/** Arrow-key movement and resize increment. Shift uses the larger increment. */
export const TOOL_DIALOG_KEYBOARD_STEP = 16;
export const TOOL_DIALOG_KEYBOARD_SHIFT_STEP = 48;
/** Reusable New-dialog resize floor. A smaller viewport remains fully usable. */
export const TOOL_DIALOG_MIN_WIDTH = 320;
export const TOOL_DIALOG_MIN_HEIGHT = 240;

export interface ToolDialogViewport {
  width: number;
  height: number;
}

export interface ToolDialogRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToolDialogMinimumSize {
  width: number;
  height: number;
}

export interface ToolDialogGeometry {
  rect: ToolDialogRect;
  /** Restore the current viewport's default 24px/8px-inset rect. */
  reset: () => void;
  /** Replace the rect after enforcing the current viewport bounds. */
  setRect: (rect: ToolDialogRect) => void;
  /** Move by a delta while preserving size. */
  moveBy: (deltaX: number, deltaY: number) => void;
  /** Resize from the bottom-right while applying its minimum and viewport maximum. */
  resizeBy: (deltaX: number, deltaY: number, minimum: ToolDialogMinimumSize) => void;
}

export interface UseToolDialogGeometryOptions {
  open: boolean;
  /** Injectable for deterministic tests; production reads the visible viewport. */
  getViewport?: () => ToolDialogViewport;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Returns the safe inset for a viewport without relying on CSS media queries. */
export function toolDialogGutter(viewport: ToolDialogViewport): number {
  return viewport.width <= TOOL_DIALOG_NARROW_VIEWPORT_MAX ? TOOL_DIALOG_NARROW_GUTTER : TOOL_DIALOG_DESKTOP_GUTTER;
}

/** The stable near-viewport default for every supported Composer tool dialog. */
export function defaultToolDialogRect(viewport: ToolDialogViewport): ToolDialogRect {
  const width = nonNegative(viewport.width);
  const height = nonNegative(viewport.height);
  const gutter = toolDialogGutter({ width, height });
  const usableWidth = Math.max(0, width - gutter * 2);
  const usableHeight = Math.max(0, height - gutter * 2);

  return { x: gutter, y: gutter, width: usableWidth, height: usableHeight };
}

/**
 * Keep a complete shell, including its top-left grip and top-right close
 * control, inside the current viewport. The gutter defines the default and
 * maximum size; movement may use the edge itself, otherwise a dialog that
 * starts at viewport - 48px would have no room to move at all. If the viewport
 * shrinks, the rect shrinks first and is then repositioned within its edges.
 */
export function clampToolDialogRect(rect: ToolDialogRect, viewport: ToolDialogViewport): ToolDialogRect {
  const viewportWidth = nonNegative(viewport.width);
  const viewportHeight = nonNegative(viewport.height);
  const gutter = toolDialogGutter({ width: viewportWidth, height: viewportHeight });
  const maximumWidth = Math.max(0, viewportWidth - gutter * 2);
  const maximumHeight = Math.max(0, viewportHeight - gutter * 2);
  const width = clamp(nonNegative(rect.width), 0, maximumWidth);
  const height = clamp(nonNegative(rect.height), 0, maximumHeight);

  return {
    x: clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, viewportWidth - width),
    y: clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, viewportHeight - height),
    width,
    height,
  };
}

/** Move only — width and height remain unchanged unless a viewport clamp requires them to shrink. */
export function moveToolDialogRect(
  rect: ToolDialogRect,
  deltaX: number,
  deltaY: number,
  viewport: ToolDialogViewport,
): ToolDialogRect {
  return clampToolDialogRect(
    {
      ...rect,
      x: rect.x + (Number.isFinite(deltaX) ? deltaX : 0),
      y: rect.y + (Number.isFinite(deltaY) ? deltaY : 0),
    },
    viewport,
  );
}

/** Resize a bottom-right handle while respecting both its floor and the viewport ceiling. */
export function resizeToolDialogRect(
  rect: ToolDialogRect,
  deltaX: number,
  deltaY: number,
  viewport: ToolDialogViewport,
  minimum: ToolDialogMinimumSize,
): ToolDialogRect {
  const bounded = clampToolDialogRect(rect, viewport);
  const gutter = toolDialogGutter(viewport);
  const maximumWidth = Math.max(0, nonNegative(viewport.width) - gutter * 2);
  const maximumHeight = Math.max(0, nonNegative(viewport.height) - gutter * 2);
  const minimumWidth = Math.min(nonNegative(minimum.width), maximumWidth);
  const minimumHeight = Math.min(nonNegative(minimum.height), maximumHeight);

  return clampToolDialogRect(
    {
      ...bounded,
      width: clamp(bounded.width + (Number.isFinite(deltaX) ? deltaX : 0), minimumWidth, maximumWidth),
      height: clamp(bounded.height + (Number.isFinite(deltaY) ? deltaY : 0), minimumHeight, maximumHeight),
    },
    viewport,
  );
}

/** Uses the smaller layout/visual viewport so browser chrome and zoom never hide a control. */
export function readToolDialogViewport(): ToolDialogViewport {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const visualViewport = window.visualViewport;
  return {
    width: nonNegative(Math.min(window.innerWidth, visualViewport?.width ?? window.innerWidth)),
    height: nonNegative(Math.min(window.innerHeight, visualViewport?.height ?? window.innerHeight)),
  };
}

/** Inline geometry for a modal top-layer shell. CSS supplies the same safe fallback before hydration. */
export function toolDialogStyle(rect: ToolDialogRect): JSX.CSSProperties {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

/**
 * Maintains session-only geometry and clamps it after a window or visual
 * viewport change. Every false -> true `open` transition begins at default.
 */
export function useToolDialogGeometry({ open, getViewport = readToolDialogViewport }: UseToolDialogGeometryOptions): ToolDialogGeometry {
  const [rect, setStoredRect] = useState<ToolDialogRect>(() => defaultToolDialogRect(getViewport()));

  const setRect = useCallback(
    (next: ToolDialogRect) => {
      setStoredRect(clampToolDialogRect(next, getViewport()));
    },
    [getViewport],
  );

  const reset = useCallback(() => {
    setStoredRect(defaultToolDialogRect(getViewport()));
  }, [getViewport]);

  const moveBy = useCallback(
    (deltaX: number, deltaY: number) => {
      setStoredRect((current) => moveToolDialogRect(current, deltaX, deltaY, getViewport()));
    },
    [getViewport],
  );

  const resizeBy = useCallback(
    (deltaX: number, deltaY: number, minimum: ToolDialogMinimumSize) => {
      setStoredRect((current) => resizeToolDialogRect(current, deltaX, deltaY, getViewport(), minimum));
    },
    [getViewport],
  );

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const clampToViewport = () => setStoredRect((current) => clampToolDialogRect(current, getViewport()));
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", clampToViewport);
    visualViewport?.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      visualViewport?.removeEventListener("resize", clampToViewport);
    };
  }, [open, getViewport]);

  return { rect, reset, setRect, moveBy, resizeBy };
}

interface PointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  rect: ToolDialogRect;
}

function pointerCapture(target: HTMLElement, pointerId: number): void {
  // `setPointerCapture` is available on real browser elements. The guard keeps
  // the controls testable in lightweight DOM environments without weakening
  // production's capture behavior.
  target.setPointerCapture?.(pointerId);
}

/** Pointer + keyboard handlers for a labelled top-left dialog move grip. */
export function useMovableToolDialog(geometry: ToolDialogGeometry) {
  const pointerStart = useRef<PointerStart | null>(null);

  const onPointerDown = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        rect: geometry.rect,
      };
      pointerCapture(event.currentTarget, event.pointerId);
    },
    [geometry.rect],
  );

  const onPointerMove = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      const start = pointerStart.current;
      if (!start || start.pointerId !== event.pointerId) return;
      geometry.setRect(moveToolDialogRect(start.rect, event.clientX - start.clientX, event.clientY - start.clientY, readToolDialogViewport()));
    },
    [geometry],
  );

  const finishPointer = useCallback((event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
  }, []);

  const onKeyDown = useCallback(
    (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        geometry.reset();
        return;
      }
      const step = event.shiftKey ? TOOL_DIALOG_KEYBOARD_SHIFT_STEP : TOOL_DIALOG_KEYBOARD_STEP;
      const delta =
        event.key === "ArrowLeft"
          ? [-step, 0]
          : event.key === "ArrowRight"
            ? [step, 0]
            : event.key === "ArrowUp"
              ? [0, -step]
              : event.key === "ArrowDown"
                ? [0, step]
                : null;
      if (!delta) return;
      event.preventDefault();
      geometry.moveBy(delta[0], delta[1]);
    },
    [geometry],
  );

  return { onPointerDown, onPointerMove, onPointerUp: finishPointer, onPointerCancel: finishPointer, onKeyDown };
}

/** Pointer + keyboard handlers for a bottom-right dialog resize handle. */
export function useResizableToolDialog(
  geometry: ToolDialogGeometry,
  minimum: ToolDialogMinimumSize = { width: TOOL_DIALOG_MIN_WIDTH, height: TOOL_DIALOG_MIN_HEIGHT },
) {
  const pointerStart = useRef<PointerStart | null>(null);

  const onPointerDown = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerStart.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        rect: geometry.rect,
      };
      pointerCapture(event.currentTarget, event.pointerId);
    },
    [geometry.rect],
  );

  const onPointerMove = useCallback(
    (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
      const start = pointerStart.current;
      if (!start || start.pointerId !== event.pointerId) return;
      geometry.setRect(
        resizeToolDialogRect(
          start.rect,
          event.clientX - start.clientX,
          event.clientY - start.clientY,
          readToolDialogViewport(),
          minimum,
        ),
      );
    },
    [geometry, minimum],
  );

  const finishPointer = useCallback((event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
  }, []);

  const onKeyDown = useCallback(
    (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        geometry.reset();
        return;
      }
      const step = event.shiftKey ? TOOL_DIALOG_KEYBOARD_SHIFT_STEP : TOOL_DIALOG_KEYBOARD_STEP;
      const delta =
        event.key === "ArrowLeft"
          ? [-step, 0]
          : event.key === "ArrowRight"
            ? [step, 0]
            : event.key === "ArrowUp"
              ? [0, -step]
              : event.key === "ArrowDown"
                ? [0, step]
                : null;
      if (!delta) return;
      event.preventDefault();
      geometry.resizeBy(delta[0], delta[1], minimum);
    },
    [geometry, minimum],
  );

  return { onPointerDown, onPointerMove, onPointerUp: finishPointer, onPointerCancel: finishPointer, onKeyDown };
}

export interface ToolDialogResizeHandleProps {
  geometry: ToolDialogGeometry;
  minimum?: ToolDialogMinimumSize;
  class?: string;
}

/**
 * A custom bottom-right resize primitive for the New composition dialog.
 * Add intentionally does not render this control.
 */
export function ToolDialogResizeHandle({
  geometry,
  minimum = { width: TOOL_DIALOG_MIN_WIDTH, height: TOOL_DIALOG_MIN_HEIGHT },
  class: className = "",
}: ToolDialogResizeHandleProps): JSX.Element {
  const resizeHandle = useResizableToolDialog(geometry, minimum);

  return (
    <button
      type="button"
      class={`sg-composer-tool-dialog-resize ${className}`.trim()}
      aria-label="Resize dialog"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
      title="Resize dialog (Arrow keys; Shift resizes farther; Home resets)"
      {...resizeHandle}
    >
      <span aria-hidden="true" class="sg-composer-tool-dialog-resize-mark" />
    </button>
  );
}
