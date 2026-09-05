import "./overlay-test-environment";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuSection, MenuSubmenu } from "../menu";
import { useMenu } from "../use-menu";

function Harness({ select = () => {}, escape = () => {} }: { select?: () => void; escape?: () => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useMenu(trigger);
  return <div onKeyDown={escape}>
    <button ref={trigger} {...menu.triggerProps}>Actions</button>
    <button>Outside</button>
    <Menu controller={menu} label="Actions">
      <MenuSubmenu label="Arrange">
        <MenuSection title="Position"><MenuItem onSelect={select}>Move up</MenuItem></MenuSection>
        <MenuSubmenu label="More"><MenuSection title="Position"><MenuItem>Move to start</MenuItem></MenuSection></MenuSubmenu>
      </MenuSubmenu>
      <MenuItem>Rename</MenuItem>
    </Menu>
  </div>;
}

describe("nested menu", () => {
  it("uses distinct stable IDs across three portal roots and resolves each trigger to its own menu", () => {
    render(<Harness />);
    const root = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(root);
    const arrange = screen.getByRole("menuitem", { name: "Arrange" });
    fireEvent.click(arrange);
    const more = screen.getByRole("menuitem", { name: "More" });
    fireEvent.click(more);
    const triggers = [root, arrange, more];
    const labels = ["Actions", "Arrange", "More"];
    const ids = triggers.map((trigger) => trigger.getAttribute("aria-controls"));
    expect(new Set(ids).size).toBe(3);
    const groups = screen.getAllByRole("group", { name: "Position" });
    const titleIds = groups.map((group) => group.getAttribute("aria-labelledby"));
    expect(new Set(titleIds).size).toBe(2);
    for (const [index, id] of titleIds.entries()) {
      expect(id).toBeTruthy();
      expect(groups[index].contains(document.getElementById(id!))).toBe(true);
    }
    for (const [index, id] of ids.entries()) {
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)).toBe(screen.getByRole("menu", { name: labels[index] }));
    }
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move to start" }), { key: "Escape" });
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-controls", ids[2]);
  });

  it.each([false, true])("exits the entire owning chain on Tab (shift=%s)", (shiftKey) => {
    render(<Harness />);
    const root = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(root);
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move to start" }), { key: "Tab", shiftKey });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(root).toHaveFocus();
    expect(root).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with Right, consumes Escape at the innermost surface, and restores each trigger", () => {
    const escape = vi.fn();
    render(<Harness escape={escape} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const arrange = screen.getByRole("menuitem", { name: "Arrange" });
    expect(arrange).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(arrange, { key: "ArrowRight" });
    const more = screen.getByRole("menuitem", { name: "More" });
    fireEvent.keyDown(more, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move to start" }), { key: "Escape" });
    expect(more).toHaveFocus();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.keyDown(more, { key: "ArrowLeft" });
    expect(arrange).toHaveFocus();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.keyDown(arrange, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    expect(escape).not.toHaveBeenCalled();
  });

  it("keeps ancestors open on submenu pointerdown, then closes the chain after selection", () => {
    const select = vi.fn();
    render(<Harness select={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    const move = screen.getByRole("menuitem", { name: "Move up" });
    fireEvent.pointerDown(move);
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.click(move);
    expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
  });

  it("dismisses the complete nested chain on an outside pointer and ignores IME Escape", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move up" }), { key: "Escape", isComposing: true });
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
