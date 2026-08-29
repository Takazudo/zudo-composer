/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ComposerMenu, type ComposerMenuItemSpec } from "../composer-menu";

const ITEMS: ComposerMenuItemSpec[] = [
  { id: "copy", label: "Copy", onSelect: vi.fn() },
  { id: "cut", label: "Cut", onSelect: vi.fn() },
  { id: "duplicate", label: "Duplicate", onSelect: vi.fn(), disabled: true },
  { id: "delete", label: "Delete", onSelect: vi.fn(), danger: true },
];

function itemsWithSpies(): ComposerMenuItemSpec[] {
  return ITEMS.map((item) => ({ ...item, onSelect: vi.fn() }));
}

const ANCHOR = { x: 100, y: 100 };

describe("ComposerMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ComposerMenu open={false} label="Node menu" anchor={ANCHOR} onClose={vi.fn()} items={itemsWithSpies()} />,
    );
    expect(container.querySelector(".sg-composer-menu")).toBeNull();
  });

  it("renders nothing when open but the anchor is not yet known", () => {
    const { container } = render(
      <ComposerMenu open={true} label="Node menu" anchor={null} onClose={vi.fn()} items={itemsWithSpies()} />,
    );
    expect(container.querySelector(".sg-composer-menu")).toBeNull();
  });

  it("renders a labelled role=menu with role=menuitem buttons, respecting disabled/danger", () => {
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={vi.fn()} items={itemsWithSpies()} />);
    const menu = screen.getByRole("menu", { name: "Node menu" });
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.map((el) => el.textContent)).toEqual(["Copy", "Cut", "Duplicate", "Delete"]);
    expect((screen.getByRole("menuitem", { name: "Duplicate" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain("sg-composer-menu-item-danger");
    expect(menu).toBeInTheDocument();
  });

  it("clicking an item calls its onSelect but does NOT auto-close (caller controls closing)", () => {
    const onClose = vi.fn();
    const items = itemsWithSpies();
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={items} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(items[0]!.onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("auto-focuses the first ENABLED item on open", () => {
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={vi.fn()} items={itemsWithSpies()} />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click OUTSIDE the panel calls onClose; a click INSIDE does not", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />
      </div>,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on window scroll", () => {
    const onClose = vi.fn();
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />);
    window.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on window resize", () => {
    const onClose = vi.fn();
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />);
    window.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not register global listeners while closed (a later Escape elsewhere is a no-op)", () => {
    const onClose = vi.fn();
    render(<ComposerMenu open={false} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ArrowDown/ArrowUp move focus among ENABLED items only, wrapping around", () => {
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={vi.fn()} items={itemsWithSpies()} />);
    const menu = screen.getByRole("menu");
    // Starts on Copy (auto-focused). Down -> Cut -> Delete (Duplicate is disabled, skipped).
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Cut" }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    // Wraps back to Copy.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
    // Up from Copy wraps to Delete (the last enabled item).
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  });

  it("Home/End jump to the first/last enabled item", () => {
    render(<ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={vi.fn()} items={itemsWithSpies()} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));
  });

  it("renders custom `children` (e.g. a confirmation) instead of items, as role=group", () => {
    render(
      <ComposerMenu open={true} label="Confirm removal" anchor={ANCHOR} onClose={vi.fn()}>
        <p>Remove Box and its 2 nested components?</p>
        <button type="button">Confirm removal</button>
      </ComposerMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("group", { name: "Confirm removal" })).toBeInTheDocument();
    expect(screen.getByText(/Remove Box and its 2 nested components/)).toBeInTheDocument();
  });

  it("clamps its position to the viewport using the measured panel size", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(400);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 250,
      height: 200,
      top: 0,
      left: 0,
      right: 250,
      bottom: 200,
      toJSON() {
        return {};
      },
    });
    // Anchor near the bottom-right corner — the 250x200 panel must clamp
    // inside the 400x300 viewport (minus the 8px margin).
    const { container } = render(
      <ComposerMenu open={true} label="Insert menu" anchor={{ x: 390, y: 290 }} onClose={vi.fn()} items={itemsWithSpies()} />,
    );
    const panel = container.querySelector(".sg-composer-menu") as HTMLElement;
    expect(panel.style.left).toBe("142px"); // 400 - 250 - 8
    expect(panel.style.top).toBe("92px"); // 300 - 200 - 8
  });
});

describe("ComposerMenu — cleanup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("removing the menu (open -> false) stops listening for outside clicks", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ComposerMenu open={true} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />,
    );
    rerender(<ComposerMenu open={false} label="Node menu" anchor={ANCHOR} onClose={onClose} items={itemsWithSpies()} />);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
