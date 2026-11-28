import "./overlay-test-environment";
import type { Ref } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { Menu, MenuItem, MenuSection, MenuSubmenu } from "../menu";
import { createMenu } from "../use-menu";

function Harness({ select = () => {}, escape = () => {} }: { select?: () => void; escape?: () => void }) {
  const trigger: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(trigger);
  return <div on:keydown={escape}>
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
  it("uses distinct stable IDs across three portal roots and resolves each trigger to its own menu", async () => {
    render(<Harness />);
    const root = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(root);
    await settle();
    const arrange = screen.getByRole("menuitem", { name: "Arrange" });
    fireEvent.click(arrange);
    await settle();
    const more = screen.getByRole("menuitem", { name: "More" });
    fireEvent.click(more);
    await settle();
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
    await settle();
    fireEvent.click(more);
    await settle();
    expect(more).toHaveAttribute("aria-controls", ids[2]);
  });

  it.each([false, true])("exits the entire owning chain on Tab (shift=%s)", async (shiftKey) => {
    render(<Harness />);
    const root = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(root);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "More" }));
    await settle();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move to start" }), { key: "Tab", shiftKey });
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(root).toHaveFocus();
    expect(root).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with Right, consumes Escape at the innermost surface, and restores each trigger", async () => {
    const escape = vi.fn();
    render(<Harness escape={escape} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    const arrange = screen.getByRole("menuitem", { name: "Arrange" });
    expect(arrange).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(arrange, { key: "ArrowRight" });
    await settle();
    const more = screen.getByRole("menuitem", { name: "More" });
    fireEvent.keyDown(more, { key: "ArrowRight" });
    await settle();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move to start" }), { key: "Escape" });
    await settle();
    expect(more).toHaveFocus();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.keyDown(more, { key: "ArrowLeft" });
    await settle();
    expect(arrange).toHaveFocus();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.keyDown(arrange, { key: "Escape" });
    await settle();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    expect(escape).not.toHaveBeenCalled();
  });

  it("keeps ancestors open on submenu pointerdown, then closes the chain after selection", async () => {
    const select = vi.fn();
    render(<Harness select={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    await settle();
    const move = screen.getByRole("menuitem", { name: "Move up" });
    fireEvent.pointerDown(move);
    await settle();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.click(move);
    await settle();
    expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
  });

  it("dismisses the complete nested chain on an outside pointer and ignores IME Escape", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Arrange" }));
    await settle();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Move up" }), { key: "Escape", isComposing: true });
    await settle();
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    await settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
