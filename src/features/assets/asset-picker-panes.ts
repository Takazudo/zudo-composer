import { computed, getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";

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

type SeparatorPointerEvent = PointerEvent & { currentTarget: HTMLDivElement };

/** Call once in the picker's setup; the refs are read when that scope activates. */
export function createAssetPickerPanes() {
  const scope = getScope();
  const panes = signal<PaneState>(readPanes());
  const tier = signal<PaneTier>({ sideOverlay: false, detailDrawer: false });
  const bodyRef: Ref<HTMLDivElement> = { current: null };
  const sideRef: Ref<HTMLElement> = { current: null };
  const detailRef: Ref<HTMLElement> = { current: null };
  const sideTabRef: Ref<HTMLButtonElement> = { current: null };
  const detailTabRef: Ref<HTMLButtonElement> = { current: null };
  const separatorRef: Ref<HTMLDivElement> = { current: null };
  let drag: { pointerId: number; x: number; width: number } | null = null;

  const closeSide = () => {
    if (sideRef.current?.contains(document.activeElement) || document.activeElement === separatorRef.current) sideTabRef.current?.focus();
    drag = null;
    if (panes.value.side) panes.value = { ...panes.value, side: false };
  };
  const closeDetail = () => {
    if (detailRef.current?.contains(document.activeElement)) detailTabRef.current?.focus();
    if (panes.value.detail) panes.value = { ...panes.value, detail: false };
  };

  // Commit preferences with the rendered pane state, including when the user
  // immediately dismisses the picker before a later task would run.
  scope.effect(() => {
    const state = panes.value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Storage can be disabled. */ }
  });

  scope.onActivate(() => {
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
      const current = tier.value;
      if (current.sideOverlay !== sideOverlay || current.detailDrawer !== detailDrawer) tier.value = { sideOverlay, detailDrawer };
    };
    readTier();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(readTier);
    observer.observe(body.closest("dialog") ?? body);
    observer.observe(body);
    return () => observer.disconnect();
  });

  const setSideWidth = (width: number) => { panes.value = { ...panes.value, sideWidth: clampSideWidth(width) }; };
  const endDrag = (event: SeparatorPointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const width = computed(() => panes.value.sideWidth);
  const separatorHidden = computed(() => !panes.value.side || tier.value.sideOverlay);

  return {
    panes, tier, bodyRef, sideRef, detailRef, sideTabRef, detailTabRef, closeSide, closeDetail,
    toggleSide: () => { if (panes.value.side) closeSide(); else panes.value = { ...panes.value, side: true }; },
    toggleDetail: () => { if (panes.value.detail) closeDetail(); else panes.value = { ...panes.value, detail: true }; },
    separatorProps: {
      ref: separatorRef,
      role: "separator",
      tabindex: computed(() => (panes.value.side && !tier.value.sideOverlay ? 0 : -1)),
      "aria-label": "Resize library",
      "aria-orientation": "vertical",
      "aria-valuemin": MIN_SIDE_WIDTH,
      "aria-valuemax": MAX_SIDE_WIDTH,
      "aria-valuenow": width,
      "aria-valuetext": computed(() => `${width.value} pixels`),
      "aria-hidden": computed(() => String(separatorHidden.value)),
      "on:pointerdown": (event: SeparatorPointerEvent) => {
        if (event.button !== 0 || tier.value.sideOverlay || !panes.value.side) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag = { pointerId: event.pointerId, x: event.clientX, width: panes.value.sideWidth };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      "on:pointermove": (event: SeparatorPointerEvent) => {
        const active = drag;
        if (active?.pointerId === event.pointerId) setSideWidth(active.width + event.clientX - active.x);
      },
      "on:pointerup": endDrag,
      "on:pointercancel": endDrag,
      "on:lostpointercapture": () => { drag = null; },
      "on:keydown": (event: KeyboardEvent) => {
        const current = panes.value.sideWidth;
        const next = event.key === "Home" ? MIN_SIDE_WIDTH : event.key === "End" ? MAX_SIDE_WIDTH
          : event.key === "ArrowLeft" ? current - 10 : event.key === "ArrowRight" ? current + 10 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setSideWidth(next);
      },
    },
  };
}

export type AssetPickerPanes = ReturnType<typeof createAssetPickerPanes>;
