import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  CSS_VAR_INSPECTOR_W,
  CSS_VAR_TREE_W,
  LS_INSPECTOR_WIDTH,
  LS_TREE_WIDTH,
  MIN_RAIL_W,
  WIDTH_CHANGE_EVENT,
} from "../resizer-contract";
import { installComposerResizers, restoreComposerWidths } from "../resizer-dom";

function handle(attribute: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute(attribute, "");
  document.body.appendChild(element);
  return element;
}

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(CSS_VAR_TREE_W);
  document.documentElement.style.removeProperty(CSS_VAR_INSPECTOR_W);
  vi.stubGlobal("innerWidth", 1600);
});

afterEach(() => vi.unstubAllGlobals());

describe("Composer resizer DOM wiring", () => {
  it("restores both persisted widths into the document CSS variables", () => {
    localStorage.setItem(LS_TREE_WIDTH, "312");
    localStorage.setItem(LS_INSPECTOR_WIDTH, "344");

    restoreComposerWidths();

    expect(document.documentElement.style.getPropertyValue(CSS_VAR_TREE_W)).toBe("312px");
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_INSPECTOR_W)).toBe("344px");
  });

  it("handles keyboard resizing, persistence, and the public width-change event", () => {
    document.documentElement.style.setProperty(CSS_VAR_TREE_W, "280px");
    document.documentElement.style.setProperty(CSS_VAR_INSPECTOR_W, "320px");
    const tree = handle(ATTR_TREE_RESIZER);
    const changed = vi.fn();
    document.addEventListener(WIDTH_CHANGE_EVENT, changed);
    const dispose = installComposerResizers();

    const event = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    tree.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_TREE_W)).toBe("296px");
    expect(tree).toHaveAttribute("aria-valuenow", "296");
    expect(localStorage.getItem(LS_TREE_WIDTH)).toBe("296");
    expect(changed).toHaveBeenCalledOnce();

    dispose();
    document.removeEventListener(WIDTH_CHANGE_EVENT, changed);
  });

  it("wires handles added after installation and removes their listeners on dispose", async () => {
    document.documentElement.style.setProperty(CSS_VAR_TREE_W, "280px");
    document.documentElement.style.setProperty(CSS_VAR_INSPECTOR_W, "320px");
    const dispose = installComposerResizers();
    const inspector = handle(ATTR_INSPECTOR_RESIZER);
    await Promise.resolve();

    inspector.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_INSPECTOR_W)).toBe(`${MIN_RAIL_W}px`);

    dispose();
    inspector.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }));
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_INSPECTOR_W)).toBe(`${MIN_RAIL_W}px`);
  });
});
