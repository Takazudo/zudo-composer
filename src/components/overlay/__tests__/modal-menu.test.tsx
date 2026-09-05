import { fireEvent, render, screen } from "@testing-library/preact";
import { useRef, useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import "./overlay-test-environment";
import { Dialog } from "../dialog";
import { Menu, MenuItem, MenuSubmenu } from "../menu";
import { useMenu } from "../use-menu";
function Actions() {
  const ref = useRef<HTMLButtonElement>(null), menu = useMenu(ref);
  return <><button ref={ref} {...menu.triggerProps}>Actions</button><Menu controller={menu} label="Actions"><MenuSubmenu label="Arrange"><MenuItem>Move up</MenuItem></MenuSubmenu></Menu></>;
}
function Harness() { const [open, setOpen] = useState(true); return <Dialog open={open} title="Navigation" onClose={() => setOpen(false)}><Actions /></Dialog>; }
describe("menus inside native dialogs", () => {
  it("keeps menus/submenus in the modal subtree and Escape closes the innermost surface", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(dialog.contains(menu)).toBe(true);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Arrange/ }), { key: "ArrowRight" });
    const move = screen.getByRole("menuitem", { name: "Move up" }); expect(dialog.contains(move)).toBe(true);
    fireEvent.keyDown(move, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(dialog).toHaveAttribute("open"); expect(menu).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" }); expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    expect(dialog).toHaveAttribute("open");
  });
  it("continues mounting nonmodal menus under body", () => {
    render(<Actions />); fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menu").parentElement?.parentElement).toBe(document.body);
  });
});
