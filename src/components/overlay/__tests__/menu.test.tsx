import { fireEvent, render, screen } from "@testing-library/preact";
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import "./overlay-test-environment";
import { TrashIcon } from "../../icons";
import { Menu, MenuCheckboxItem, MenuItem, MenuRadioItem, MenuSection, MenuSeparator } from "../menu";
import { useMenu, type UseMenuOptions } from "../use-menu";

interface HarnessProps extends UseMenuOptions {
  onOpen?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

function RowMenu({ onOpen, onDuplicate, onDelete, ...options }: HarnessProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, options);
  return (
    <div>
      <button type="button" ref={triggerRef} {...menu.triggerProps}>More</button>
      <button type="button">Outside</button>
      <Menu controller={menu} label="Row actions">
        <MenuItem kbd="↵" onSelect={onOpen}>Open</MenuItem>
        <MenuItem onSelect={onDuplicate}>Duplicate</MenuItem>
        <MenuItem disabled>Rename</MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger" icon={TrashIcon} onSelect={onDelete}>Delete…</MenuItem>
      </Menu>
    </div>
  );
}

function ThemeMenu(): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef);
  const [theme, setTheme] = useState("system");
  return (
    <div>
      <button type="button" ref={triggerRef} {...menu.triggerProps}>Theme</button>
      <Menu controller={menu} label="Theme preference">
        <MenuSection title="Appearance">
          {["system", "light", "dark"].map((value) => (
            <MenuRadioItem key={value} checked={theme === value} onSelect={() => setTheme(value)}>
              {value}
            </MenuRadioItem>
          ))}
        </MenuSection>
      </Menu>
    </div>
  );
}

function ColumnMenu(): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef);
  const [visible, setVisible] = useState(["name", "kind"]);
  return (
    <div>
      <button type="button" ref={triggerRef} {...menu.triggerProps}>Columns</button>
      <Menu controller={menu} label="Visible columns">
        {["name", "kind", "updated"].map((column) => (
          <MenuCheckboxItem
            key={column}
            checked={visible.includes(column)}
            onSelect={() =>
              setVisible((current) =>
                current.includes(column) ? current.filter((entry) => entry !== column) : [...current, column],
              )
            }
          >
            {column}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem href="/composer">Open library</MenuItem>
      </Menu>
    </div>
  );
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  return screen.getByRole("menu", { name: "Row actions" });
}

function itemNames(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.textContent?.trim() ?? "");
}

describe("Menu trigger contract", () => {
  it("advertises the menu it controls and mirrors its open state", () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    const menu = openMenu();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  });

  it("opens on ArrowDown with the first item focused", () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("opens on ArrowUp with the last enabled item focused", () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });

  it("closes again when the trigger is clicked a second time", () => {
    render(<RowMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("reports every open and close to onOpenChange", () => {
    const onOpenChange = vi.fn();
    render(<RowMenu onOpenChange={onOpenChange} />);
    openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("Menu keyboard navigation", () => {
  it("moves focus with ArrowDown and ArrowUp, wrapping at both ends", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("skips disabled items", () => {
    render(<RowMenu />);
    const menu = openMenu();
    expect(itemNames()).toContain("Rename");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("keeps a roving tabindex so the menu is one tab stop", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "End" });
    const items = screen.getAllByRole("menuitem");
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([screen.getByRole("menuitem", { name: "Delete…" })]);
  });

  it("moves focus to the first item whose label matches a typed prefix", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "d" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "d" });
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });
});

describe("Menu dismissal and focus restore", () => {
  it("restores focus to the trigger on Escape", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  it("restores focus to the trigger on Tab, without leaving the menu open", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  it("restores focus to the trigger after an item is chosen", () => {
    const onDuplicate = vi.fn();
    render(<RowMenu onDuplicate={onDuplicate} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  it("closes on an outside pointer press and leaves focus where the pointer went", () => {
    render(<RowMenu />);
    openMenu();
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).not.toHaveFocus();
  });

  it("stays open when the press lands inside the menu", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Open" }));
    expect(menu).toBeInTheDocument();
  });

  it("closes when the page scrolls underneath it", () => {
    render(<RowMenu />);
    openMenu();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when a scroll container around the trigger scrolls", () => {
    const view = render(<RowMenu />);
    openMenu();
    fireEvent.scroll(view.container.firstElementChild!);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when something that cannot move the trigger scrolls", () => {
    // A text input scrolling its own value back to the start as it loses focus
    // is a scroll event like any other, and the listener runs in the capture
    // phase. Dismissing on it closed the Content schema's type menu on the very
    // click that opened it, because that click blurred the Key cell beside it.
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.scroll(screen.getByRole("button", { name: "Outside" }));
    expect(menu).toBeInTheDocument();
  });

  it("stays open while its own panel is scrolled", () => {
    render(<RowMenu />);
    const menu = openMenu();
    fireEvent.scroll(menu);
    expect(menu).toBeInTheDocument();
  });
});

describe("Menu structure", () => {
  it("renders outside its trigger's subtree, in a body-level portal", () => {
    const view = render(<RowMenu />);
    const menu = openMenu();
    expect(view.container.contains(menu)).toBe(false);
    expect(menu.closest(".cms-overlay-portal")?.parentElement).toBe(document.body);
  });

  it("positions itself as a fixed, viewport-clamped panel", () => {
    render(<RowMenu />);
    const menu = openMenu();
    expect(menu.style.left).toMatch(/px$/);
    expect(menu.style.top).toMatch(/px$/);
    expect(menu.style.maxHeight).toMatch(/px$/);
    expect(menu.dataset.side).toBe("bottom");
  });

  it("keeps the shortcut hint out of the item's accessible name", () => {
    render(<RowMenu />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Open" }).textContent).toContain("↵");
  });

  it("separates the danger item from the rest", () => {
    render(<RowMenu />);
    const menu = openMenu();
    expect(menu.querySelector(".cms-menu__separator")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Delete…" }).className).toContain("cms-menu__item--danger");
  });
});

describe("Menu radio items", () => {
  it("exposes exactly one checked menuitemradio and moves the check on selection", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.getAllByRole("menuitemradio").map((option) => option.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  it("opens on the option already in force", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "light" }));
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.getByRole("menuitemradio", { name: "light" })).toHaveFocus();
  });

  it("labels the section as a group", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(screen.getByRole("group", { name: "Appearance" })).toBeInTheDocument();
  });
});

describe("Menu checkbox and link items", () => {
  it("toggles a menuitemcheckbox without closing the menu", () => {
    render(<ColumnMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const updated = screen.getByRole("menuitemcheckbox", { name: "updated" });
    expect(updated).toHaveAttribute("aria-checked", "false");

    fireEvent.click(updated);
    expect(screen.getByRole("menu", { name: "Visible columns" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "updated" })).toHaveAttribute("aria-checked", "true");
  });

  it("renders a link item as an anchor that still behaves as a menu item", () => {
    render(<ColumnMenu />);
    const menu = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(menu);
    const link = screen.getByRole("menuitem", { name: "Open library" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/composer");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Visible columns" }), { key: "End" });
    expect(link).toHaveFocus();
  });
});
