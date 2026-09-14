import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";

const STORAGE_KEY = "sg-assets-picker:panes";
const MIN_SIDE_WIDTH = 150;
const MAX_SIDE_WIDTH = 300;
const clampSideWidth = (width: number) => Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, width));

interface PaneState { side: boolean; detail: boolean; sideWidth: number }
interface PaneTier { sideOverlay: boolean; detailDrawer: boolean }

export function nextEscapeAction({ sideOverlay, sideOpen, detailDrawer, detailOpen }: PaneTier & { sideOpen: boolean; detailOpen: boolean }): "detail" | "side" | "dialog" {
  if (detailDrawer && detailOpen) return "detail";
  if (sideOverlay && sideOpen) return "side";
  return "dialog";
}

function readPanes(): PaneState {
  const defaults = { side: true, detail: true, sideWidth: 176 };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return defaults;
    const state = saved as Partial<PaneState>;
    return {
      side: typeof state.side === "boolean" ? state.side : defaults.side,
      detail: typeof state.detail === "boolean" ? state.detail : defaults.detail,
      sideWidth: typeof state.sideWidth === "number" && Number.isFinite(state.sideWidth) ? clampSideWidth(state.sideWidth) : defaults.sideWidth,
    };
  } catch { return defaults; }
}

export function useAssetPickerPanes() {
  const [panes, setPanes] = useState(readPanes);
  const [tier, setTier] = useState<PaneTier>({ sideOverlay: false, detailDrawer: false });
  const bodyRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const sideTabRef = useRef<HTMLButtonElement>(null);
  const detailTabRef = useRef<HTMLButtonElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);

  const closeSide = useCallback(() => {
    if (sideRef.current?.contains(document.activeElement) || document.activeElement === separatorRef.current) sideTabRef.current?.focus();
    drag.current = null;
    setPanes((current) => current.side ? { ...current, side: false } : current);
  }, []);
  const closeDetail = useCallback(() => {
    if (detailRef.current?.contains(document.activeElement)) detailTabRef.current?.focus();
    setPanes((current) => current.detail ? { ...current, detail: false } : current);
  }, []);

  // Commit preferences with the rendered pane state, including when the user
  // immediately dismisses the picker before an after-paint effect would run.
  useLayoutEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(panes)); } catch { /* Storage can be disabled. */ }
  }, [panes]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const side = sideRef.current;
    const detail = detailRef.current;
    if (!body || !side || !detail) return;
    let wasOverlay = false;
    const readTier = () => {
      // The container query owns the breakpoints. Read its actual result,
      // including when only the dialog's available space changes.
      const sideOverlay = getComputedStyle(side).position === "absolute";
      const detailDrawer = getComputedStyle(detail).position === "absolute";
      if (sideOverlay && !wasOverlay) closeSide();
      wasOverlay = sideOverlay;
      setTier((current) => current.sideOverlay === sideOverlay && current.detailDrawer === detailDrawer ? current : { sideOverlay, detailDrawer });
    };
    readTier();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(readTier);
    observer.observe(body.closest("dialog") ?? body);
    observer.observe(body);
    return () => observer.disconnect();
  }, [closeSide]);

  const setSideWidth = (width: number) => setPanes((current) => ({ ...current, sideWidth: clampSideWidth(width) }));
  const endDrag = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    panes, tier, bodyRef, sideRef, detailRef, sideTabRef, detailTabRef, closeSide, closeDetail,
    toggleSide: () => panes.side ? closeSide() : setPanes((current) => ({ ...current, side: true })),
    toggleDetail: () => panes.detail ? closeDetail() : setPanes((current) => ({ ...current, detail: true })),
    separatorProps: {
      ref: separatorRef,
      role: "separator",
      tabIndex: panes.side && !tier.sideOverlay ? 0 : -1,
      "aria-label": "Resize library",
      "aria-orientation": "vertical",
      "aria-valuemin": MIN_SIDE_WIDTH,
      "aria-valuemax": MAX_SIDE_WIDTH,
      "aria-valuenow": panes.sideWidth,
      "aria-valuetext": `${panes.sideWidth} pixels`,
      "aria-hidden": !panes.side || tier.sideOverlay,
      onPointerDown: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || tier.sideOverlay || !panes.side) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: panes.sideWidth };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId) setSideWidth(active.width + event.clientX - active.x);
      },
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: () => { drag.current = null; },
      onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
        const width = event.key === "Home" ? MIN_SIDE_WIDTH : event.key === "End" ? MAX_SIDE_WIDTH
          : event.key === "ArrowLeft" ? panes.sideWidth - 10 : event.key === "ArrowRight" ? panes.sideWidth + 10 : undefined;
        if (width === undefined) return;
        event.preventDefault();
        setSideWidth(width);
      },
    } satisfies JSX.HTMLAttributes<HTMLDivElement>,
  };
}
