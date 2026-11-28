import { signal, type Ref } from "@takazudo/zfb/zudo-react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./overlay-test-environment";
import { Dialog } from "../dialog";
import { Menu, MenuItem, MenuSubmenu } from "../menu";
import { createMenu } from "../use-menu";
function Actions() {
  const ref: Ref<HTMLButtonElement> = { current: null }, menu = createMenu(ref);
  return <><button ref={ref} {...menu.triggerProps}>Actions</button><Menu controller={menu} label="Actions"><MenuSubmenu label="Arrange"><MenuItem>Move up</MenuItem></MenuSubmenu></Menu></>;
}
function Harness() { const open = signal(true); return <Dialog open={open} title="Navigation" onClose={() => (open.value = false)}><Actions /></Dialog>; }
describe("menus inside native dialogs", () => {
  it("keeps menus/submenus in the modal subtree and Escape closes the innermost surface", async () => {
    render(<Harness />);
    await settle();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(dialog.contains(menu)).toBe(true);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Arrange/ }), { key: "ArrowRight" });
    await settle();
    const move = screen.getByRole("menuitem", { name: "Move up" }); expect(dialog.contains(move)).toBe(true);
    fireEvent.keyDown(move, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(dialog).toHaveAttribute("open"); expect(menu).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    await settle();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    expect(dialog).toHaveAttribute("open");
  });
  it("continues mounting nonmodal menus under body", async () => {
    render(<Actions />); fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    expect(screen.getByRole("menu").parentElement?.parentElement).toBe(document.body);
  });
});
