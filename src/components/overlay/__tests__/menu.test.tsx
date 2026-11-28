import { computed, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keyed } from "../../../runtime";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./overlay-test-environment";
import { TrashIcon } from "../../icons";
import { Menu, MenuCheckboxItem, MenuItem, MenuRadioItem, MenuSection, MenuSeparator } from "../menu";
import { createMenu, type MenuOptions, type MenuTriggerRef } from "../use-menu";

interface HarnessProps extends MenuOptions {
  onOpen?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

function RowMenu({ onOpen, onDuplicate, onDelete, ...options }: HarnessProps){
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, options);
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

function ThemeMenu(){
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef);
  const theme = signal("system");
  return (
    <div>
      <button type="button" ref={triggerRef} {...menu.triggerProps}>Theme</button>
      <Menu controller={menu} label="Theme preference">
        <MenuSection title="Appearance">
          {["system", "light", "dark"].map((value) => (
            <MenuRadioItem key={value} checked={computed(() => theme.value === value)} onSelect={() => (theme.value = value)}>
              {value}
            </MenuRadioItem>
          ))}
        </MenuSection>
      </Menu>
    </div>
  );
}

function ColumnMenu(){
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef);
  const visible = signal(["name", "kind"]);
  return (
    <div>
      <button type="button" ref={triggerRef} {...menu.triggerProps}>Columns</button>
      <Menu controller={menu} label="Visible columns">
        {["name", "kind", "updated"].map((column) => (
          <MenuCheckboxItem
            key={column}
            checked={computed(() => visible.value.includes(column))}
            onSelect={() => {
              const current = visible.value;
              visible.value = current.includes(column) ? current.filter((entry) => entry !== column) : [...current, column];
            }}
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

function RerenderingMenu({ replaceTrigger = false }: { replaceTrigger?: boolean }) {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const revision = signal(0);
  const menu = createMenu(triggerRef, { onOpenChange: (open) => open && (revision.value = 1) });
  const trigger = () => (
    <button data-revision={revision} type="button" ref={triggerRef} {...menu.triggerProps}>
      More
    </button>
  );
  return (
    <div>
      {replaceTrigger ? <Keyed value={revision} by={(value) => value}>{() => trigger()}</Keyed> : trigger()}
      <Menu controller={menu} label="Row actions"><MenuItem>Open</MenuItem></Menu>
    </div>
  );
}

let restoreTransientTrigger: (() => void) | null = null;

// Stands in for a callback ref: told the node on mount and on unmount.
function TransientTrigger({ triggerRef, retainDisconnected, menu }: { triggerRef: MenuTriggerRef; retainDisconnected: boolean; menu: ReturnType<typeof createMenu> }) {
  const own: Ref<HTMLButtonElement> = { current: null };
  getScope().onActivate(() => {
    triggerRef.current = own.current;
    return () => {
      if (!retainDisconnected) triggerRef.current = null;
    };
  });
  return <button type="button" ref={own} {...menu.triggerProps}>More</button>;
}

function TransientTriggerMenu({ retainDisconnected = false }: { retainDisconnected?: boolean }) {
  const triggerRef: MenuTriggerRef = { current: null };
  const showTrigger = signal(true);
  restoreTransientTrigger = () => {
    showTrigger.value = true;
  };
  const menu = createMenu(triggerRef, { onOpenChange: (open) => open && (showTrigger.value = false) });
  return (
    <div>
      <Show when={showTrigger}>{() => <TransientTrigger triggerRef={triggerRef} retainDisconnected={retainDisconnected} menu={menu} />}</Show>
      <button type="button">Outside</button>
      <Menu controller={menu} label="Row actions"><MenuItem>Open</MenuItem></Menu>
    </div>
  );
}

function NestedScrollMenu(){
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef);
  return (
    <div data-testid="outer-clip" style={{ overflow: "hidden" }}>
      <div data-testid="inner-scroll" style={{ overflow: "auto" }}>
        <button type="button" ref={triggerRef} {...menu.triggerProps}>More</button>
        <button type="button">Outside</button>
        <Menu controller={menu} label="Row actions"><MenuItem>Open</MenuItem></Menu>
      </div>
    </div>
  );
}

async function openMenu(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  await settle();
  return screen.getByRole("menu", { name: "Row actions" });
}

function itemNames(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.textContent?.trim() ?? "");
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Menu trigger contract", () => {
  it("advertises the menu it controls and mirrors its open state", async () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    const menu = await openMenu();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  });

  it("opens on ArrowDown with the first item focused", async () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("opens on ArrowUp with the last enabled item focused", async () => {
    render(<RowMenu />);
    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });

  it("closes again when the trigger is clicked a second time", async () => {
    render(<RowMenu />);
    await openMenu();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("reports every open and close to onOpenChange", async () => {
    const onOpenChange = vi.fn();
    render(<RowMenu onOpenChange={onOpenChange} />);
    await openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await settle();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("Menu keyboard navigation", () => {
  it("moves focus with ArrowDown and ArrowUp, wrapping at both ends", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("skips disabled items", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    expect(itemNames()).toContain("Rename");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await settle();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "End" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("keeps a roving tabindex so the menu is one tab stop", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "End" });
    await settle();
    const items = screen.getAllByRole("menuitem");
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([screen.getByRole("menuitem", { name: "Delete…" })]);
  });

  it("moves focus to the first item whose label matches a typed prefix", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "d" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "d" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toHaveFocus();
  });
});

describe("Menu dismissal and focus restore", () => {
  it("restores focus to the trigger on Escape", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  it("restores focus to the trigger on Tab, without leaving the menu open", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "Tab" });
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  it("restores focus to the trigger after an item is chosen", async () => {
    const onDuplicate = vi.fn();
    render(<RowMenu onDuplicate={onDuplicate} />);
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await settle();
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });

  // A browser runs microtasks between a real click's listeners, so a dialog the
  // item opens mounts before the menu's bubbling close. It must still find the
  // trigger focused, or it returns focus to the unmounted item on close.
  it("hands focus back to the trigger before the chosen item's action runs", async () => {
    let focusedAtSelect: Element | null = null;
    render(<RowMenu onDelete={() => { focusedAtSelect = document.activeElement; }} />);
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(focusedAtSelect).toBe(screen.getByRole("button", { name: "More" }));
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on an outside pointer press and leaves focus where the pointer went", async () => {
    render(<RowMenu />);
    await openMenu();
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.pointerDown(outside);
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).not.toHaveFocus();
  });

  it("stays open when the press lands inside the menu", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Open" }));
    await settle();
    expect(menu).toBeInTheDocument();
  });

  it("closes when the page scrolls underneath it", async () => {
    render(<RowMenu />);
    await openMenu();
    fireEvent.scroll(window);
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when an ancestor scroll leaves the trigger visible", async () => {
    const view = render(<RowMenu />);
    const ancestor = view.container.firstElementChild as HTMLElement;
    ancestor.style.overflow = "auto";
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.textContent === "More") return rect(100, 100, 30, 20);
      if (this === ancestor) return rect(20, 20, 300, 240);
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 40);
      return originalRect.call(this);
    });
    const menu = await openMenu();
    fireEvent.scroll(ancestor);
    await settle();
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("124px");
  });

  it("stays open when something that cannot move the trigger scrolls", async () => {
    // A text input scrolling its own value back to the start as it loses focus
    // is a scroll event like any other, and the listener runs in the capture
    // phase. Dismissing on it closed the Content schema's type menu on the very
    // click that opened it, because that click blurred the Key cell beside it.
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.scroll(screen.getByRole("button", { name: "Outside" }));
    await settle();
    expect(menu).toBeInTheDocument();
  });

  it("stays open while its own panel is scrolled", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    fireEvent.scroll(menu);
    await settle();
    expect(menu).toBeInTheDocument();
  });

  it("survives an owner re-render and a trigger-node replacement before panel mount", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("data-revision") === "1") return rect(220, 80, 30, 20);
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 40);
      return originalRect.call(this);
    });

    const ordinary = render(<RerenderingMenu />);
    const ordinaryTrigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(ordinaryTrigger);
    await settle();
    expect(screen.getByRole("menu", { name: "Row actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBe(ordinaryTrigger);
    ordinary.unmount();

    render(<RerenderingMenu replaceTrigger />);
    const originalTrigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(originalTrigger);
    await settle();
    const replacement = screen.getByRole("button", { name: "More" });
    const menu = screen.getByRole("menu", { name: "Row actions" });
    expect(replacement).not.toBe(originalTrigger);
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe("220px");
    expect(menu.style.top).toBe("104px");
  });

  it("allows a transient null ref one frame to land, but closes a permanently missing ref", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 40);
      if (this.textContent === "More") return rect(180, 60, 30, 20);
      return originalRect.call(this);
    });

    const transient = render(<TransientTriggerMenu />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    const menu = screen.getByRole("menu", { name: "Row actions" });
    fireEvent.scroll(screen.getByRole("button", { name: "Outside" }));
    await settle();
    expect(menu).toBeInTheDocument();
    restoreTransientTrigger?.();
    await settle();
    frames.shift()?.(0);
    await settle();
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe("180px");
    expect(menu.style.top).toBe("84px");
    transient.unmount();

    render(<TransientTriggerMenu />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    frames.shift()?.(0);
    await settle();
    expect(screen.queryByRole("menu", { name: "Row actions" })).toBeNull();

    render(<TransientTriggerMenu retainDisconnected />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    frames.shift()?.(0);
    await settle();
    expect(screen.queryByRole("menu", { name: "Row actions" })).toBeNull();
  });

  it("repositions through nested clipping ancestors and closes only outside their intersection", async () => {
    let anchorRect = rect(100, 100, 30, 20);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.textContent === "More") return anchorRect;
      if (this.getAttribute("data-testid") === "inner-scroll") return rect(40, 40, 300, 200);
      if (this.getAttribute("data-testid") === "outer-clip") return rect(20, 20, 340, 240);
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 40);
      return originalRect.call(this);
    });

    render(<NestedScrollMenu />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    const menu = screen.getByRole("menu", { name: "Row actions" });
    expect(menu.style.left).toBe("100px");
    anchorRect = rect(150, 120, 30, 20);
    fireEvent.scroll(screen.getByTestId("inner-scroll"));
    await settle();
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe("150px");
    expect(menu.style.top).toBe("144px");

    anchorRect = rect(-80, 120, 30, 20);
    fireEvent.scroll(screen.getByTestId("outer-clip"));
    await settle();
    expect(screen.queryByRole("menu", { name: "Row actions" })).toBeNull();
  });

  it("repositions on window scroll and resize while visible, then dismisses outside the viewport", async () => {
    let anchorRect = rect(100, 100, 30, 20);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.textContent === "More") return anchorRect;
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 40);
      return originalRect.call(this);
    });

    render(<RowMenu />);
    const menu = await openMenu();
    anchorRect = rect(140, 120, 30, 20);
    fireEvent.scroll(window);
    await settle();
    expect(menu.style.left).toBe("140px");
    expect(menu.style.top).toBe("144px");
    anchorRect = rect(160, 130, 30, 20);
    fireEvent(window, new Event("resize"));
    await settle();
    expect(menu.style.left).toBe("160px");
    expect(menu.style.top).toBe("154px");
    anchorRect = rect(window.innerWidth + 10, 130, 30, 20);
    fireEvent.scroll(window);
    await settle();
    expect(screen.queryByRole("menu", { name: "Row actions" })).toBeNull();
  });
});

describe("Menu structure", () => {
  it("renders outside its trigger's subtree, in a body-level portal", async () => {
    const view = render(<RowMenu />);
    const menu = await openMenu();
    expect(view.container.contains(menu)).toBe(false);
    expect(menu.closest(".cms-overlay-portal")?.parentElement).toBe(document.body);
  });

  it("keeps a body-portalled panel positioned beyond its trigger's scrollport", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.textContent === "More") return rect(80, 105, 30, 20);
      if (this.getAttribute("data-testid") === "inner-scroll") return rect(40, 40, 300, 90);
      if (this.getAttribute("data-testid") === "outer-clip") return rect(20, 20, 340, 150);
      if (this.getAttribute("role") === "menu") return rect(0, 0, 80, 60);
      return originalRect.call(this);
    });

    const view = render(<NestedScrollMenu />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await settle();
    const menu = screen.getByRole("menu", { name: "Row actions" });
    expect(view.container.contains(menu)).toBe(false);
    expect(menu.closest(".cms-overlay-portal")?.parentElement).toBe(document.body);
    expect(Number.parseFloat(menu.style.top) + 60).toBeGreaterThan(130);
  });

  it("positions itself as a fixed, viewport-clamped panel", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    expect(menu.style.left).toMatch(/px$/);
    expect(menu.style.top).toMatch(/px$/);
    expect(menu.style.maxHeight).toMatch(/px$/);
    expect(menu.dataset.side).toBe("bottom");
  });

  it("keeps the shortcut hint out of the item's accessible name", async () => {
    render(<RowMenu />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Open" }).textContent).toContain("↵");
  });

  it("separates the danger item from the rest", async () => {
    render(<RowMenu />);
    const menu = await openMenu();
    expect(menu.querySelector(".cms-menu__separator")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Delete…" }).className).toContain("cms-menu__item--danger");
  });
});

describe("Menu radio items", () => {
  it("exposes exactly one checked menuitemradio and moves the check on selection", async () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await settle();
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "dark" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await settle();
    expect(screen.getAllByRole("menuitemradio").map((option) => option.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  it("opens on the option already in force", async () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "light" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await settle();
    expect(screen.getByRole("menuitemradio", { name: "light" })).toHaveFocus();
  });

  it("labels the section as a group", async () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    await settle();
    expect(screen.getByRole("group", { name: "Appearance" })).toBeInTheDocument();
  });
});

describe("Menu checkbox and link items", () => {
  it("toggles a menuitemcheckbox without closing the menu", async () => {
    render(<ColumnMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    await settle();
    const updated = screen.getByRole("menuitemcheckbox", { name: "updated" });
    expect(updated).toHaveAttribute("aria-checked", "false");

    fireEvent.click(updated);
    await settle();
    expect(screen.getByRole("menu", { name: "Visible columns" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "updated" })).toHaveAttribute("aria-checked", "true");
  });

  it("renders a link item as an anchor that still behaves as a menu item", async () => {
    render(<ColumnMenu />);
    const menu = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(menu);
    await settle();
    const link = screen.getByRole("menuitem", { name: "Open library" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/composer");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Visible columns" }), { key: "End" });
    await settle();
    expect(link).toHaveFocus();
  });
});
