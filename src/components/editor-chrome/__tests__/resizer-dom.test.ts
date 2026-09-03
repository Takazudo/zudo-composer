// Ported from `src/features/composer/chrome/__tests__/resizer-dom.test.ts`.
// The keyboard, persistence, aria-valuenow, width-change-event and dispose
// cases carry over unchanged in intent; what moved is the host (the editor body
// rather than `document.documentElement`) and the wiring (an explicit handle
// rather than a `MutationObserver` scan). Delta-based dragging is new.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  MAX_RAIL_W,
  MIN_RAIL_W,
  RAIL_STEP_W,
  WIDTH_CHANGE_EVENT,
  railStorageKey,
} from "../resizer-contract";
import type { EditorWidthChangeDetail } from "../resizer-contract";
import { installRailResizer } from "../resizer-dom";

const EDITOR_KEY = "composer";

let host: HTMLElement;

function handle(): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("role", "separator");
  host.appendChild(element);
  return element;
}

function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function drag(target: HTMLElement, from: number, to: number): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { clientX: from, button: 0, cancelable: true }));
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: to }));
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: to }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  host = document.createElement("div");
  host.style.setProperty(CSS_VAR_NAV_W, "280px");
  host.style.setProperty(CSS_VAR_INSP_W, "320px");
  document.body.appendChild(host);
  vi.stubGlobal("innerWidth", 1600);
});

afterEach(() => vi.unstubAllGlobals());

describe("rail resizer keyboard", () => {
  it("resizes, persists, updates aria-valuenow, and announces the new width", () => {
    const nav = handle();
    const changed = vi.fn();
    host.addEventListener(WIDTH_CHANGE_EVENT, changed);
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY });

    const event = press(nav, "ArrowRight");

    expect(event.defaultPrevented).toBe(true);
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${280 + RAIL_STEP_W}px`);
    expect(nav.getAttribute("aria-valuenow")).toBe("296");
    expect(localStorage.getItem(railStorageKey(EDITOR_KEY, "nav"))).toBe("296");
    expect(changed).toHaveBeenCalledOnce();
    expect((changed.mock.calls[0][0] as CustomEvent<EditorWidthChangeDetail>).detail).toEqual({
      rail: "nav",
      width: 296,
    });

    dispose();
  });

  it("mirrors the arrow keys on the inspector, which grows leftwards", () => {
    const insp = handle();
    const dispose = installRailResizer(insp, { host, rail: "insp", editorKey: EDITOR_KEY });

    press(insp, "ArrowLeft");
    expect(host.style.getPropertyValue(CSS_VAR_INSP_W)).toBe(`${320 + RAIL_STEP_W}px`);
    press(insp, "ArrowRight");
    expect(host.style.getPropertyValue(CSS_VAR_INSP_W)).toBe("320px");

    dispose();
  });

  it("jumps to the clamp ends with Home and End", () => {
    const nav = handle();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY });

    press(nav, "Home");
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${MIN_RAIL_W}px`);
    press(nav, "End");
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${MAX_RAIL_W}px`);

    dispose();
  });

  it("clamps against the other rail rather than the requested width", () => {
    host.style.setProperty(CSS_VAR_INSP_W, "500px");
    vi.stubGlobal("innerWidth", 1000);
    const nav = handle();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY });

    press(nav, "End");
    // 1000 - 500 (inspector) - 320 (main) - 2 (tracks) leaves 178, under the floor.
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${MIN_RAIL_W}px`);

    dispose();
  });

  it("offers Enter as the splitter collapse shortcut and ignores unrelated keys", () => {
    const nav = handle();
    const onToggleCollapse = vi.fn();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY, onToggleCollapse });

    expect(press(nav, "Enter").defaultPrevented).toBe(true);
    expect(onToggleCollapse).toHaveBeenCalledOnce();

    expect(press(nav, "a").defaultPrevented).toBe(false);
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe("280px");

    dispose();
  });
});

describe("rail resizer pointer drag", () => {
  it("moves the rail by the pointer delta, not by the absolute position", () => {
    const nav = handle();
    const onChange = vi.fn();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY, onChange });

    // Starting the drag 400px into the viewport must not snap the 280px rail.
    drag(nav, 400, 460);

    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe("340px");
    expect(onChange).toHaveBeenLastCalledWith(340);

    dispose();
  });

  it("drags the inspector in the opposite direction", () => {
    const insp = handle();
    const dispose = installRailResizer(insp, { host, rail: "insp", editorKey: EDITOR_KEY });

    drag(insp, 900, 860);
    expect(host.style.getPropertyValue(CSS_VAR_INSP_W)).toBe("360px");

    dispose();
  });

  it("stops following the pointer once the drag ends", () => {
    const nav = handle();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY });

    drag(nav, 400, 440);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 900 }));

    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe("320px");

    dispose();
  });
});

describe("rail resizer teardown", () => {
  it("removes its listeners on dispose", () => {
    const nav = handle();
    const dispose = installRailResizer(nav, { host, rail: "nav", editorKey: EDITOR_KEY });

    press(nav, "ArrowRight");
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe("296px");

    dispose();
    press(nav, "ArrowRight");
    expect(host.style.getPropertyValue(CSS_VAR_NAV_W)).toBe("296px");
  });
});
