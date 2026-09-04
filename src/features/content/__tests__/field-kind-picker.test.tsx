import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_FIELD_KINDS } from "../../../content";
import { CONTENT_FIELD_KIND_PRESENTATIONS, FieldKindPicker } from "../field-kind-picker";

// Vitest runs without `globals`, so Testing Library never installs its own
// auto-cleanup and a second render would query against both trees.
afterEach(cleanup);

function openPicker(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Type for Title" }));
  return screen.getByRole("menu", { name: "Type for Title" });
}

describe("FieldKindPicker", () => {
  it("shows the chosen kind by its friendly name, not its stored enum value", () => {
    render(<FieldKindPicker value="long-text" label="Type for Title" onChange={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Type for Title" });
    expect(trigger).toHaveTextContent("Long text");
    expect(trigger).not.toHaveTextContent("long-text");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    // Nine inline cards were the whole point of the rewrite: nothing is
    // rendered until the popover is opened.
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("offers every stored kind with an explanation, and checks the current one", () => {
    render(<FieldKindPicker value="text" label="Type for Title" onChange={() => undefined} />);
    const menu = openPicker();
    const options = within(menu).getAllByRole("menuitemradio");

    expect(CONTENT_FIELD_KIND_PRESENTATIONS.map(({ kind }) => kind)).toEqual(CONTENT_FIELD_KINDS);
    expect(options).toHaveLength(CONTENT_FIELD_KINDS.length);
    for (const option of options) {
      expect(option.querySelector("strong")?.textContent).toBeTruthy();
      expect(option.querySelector("small")?.textContent).toMatch(/\.$/);
    }
    expect(within(menu).getByRole("menuitemradio", { name: /^Short text/ })).toHaveAttribute("aria-checked", "true");
    // A menu opens on the option already in force, so Enter re-picks it.
    expect(within(menu).getByRole("menuitemradio", { name: /^Short text/ })).toHaveFocus();
  });

  it("reports the chosen kind once and closes", () => {
    const change = vi.fn();
    render(<FieldKindPicker value="text" label="Type for Title" onChange={change} />);
    const menu = openPicker();

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Date/ }));
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith("date");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("walks the options with the arrow keys without choosing as it goes", () => {
    const change = vi.fn();
    render(<FieldKindPicker value="text" label="Type for Title" onChange={change} />);
    const menu = openPicker();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(within(menu).getByRole("menuitemradio", { name: /^Long text/ })).toHaveFocus();
    // Unlike the radiogroup it replaced, moving is not choosing.
    expect(change).not.toHaveBeenCalled();
  });

  it("disables every other kind, with the reason, once stored Entries use the field", () => {
    const change = vi.fn();
    render(<FieldKindPicker value="text" locked label="Type for Title" onChange={change} />);
    expect(screen.getByRole("button", { name: "Type for Title" }).getAttribute("title")).toMatch(/stored Entries hold values/);
    const menu = openPicker();

    expect(within(menu).getByText("Type locked · stored Entries use it")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: /^Short text/ })).not.toBeDisabled();
    for (const kind of ["Long text", "Number", "Date"]) {
      expect(within(menu).getByRole("menuitemradio", { name: new RegExp(`^${kind}`) })).toBeDisabled();
    }
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Number/ }));
    expect(change).not.toHaveBeenCalled();
  });
});
