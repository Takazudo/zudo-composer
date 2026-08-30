import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_FIELD_KINDS } from "../../../content";
import { CONTENT_FIELD_KIND_PRESENTATIONS, FieldKindPicker } from "../field-kind-picker";

describe("FieldKindPicker", () => {
  it("presents every stored kind with an icon, friendly label, and one-sentence explanation", () => {
    const { unmount } = render(<FieldKindPicker value="text" onChange={() => undefined} />);
    expect(CONTENT_FIELD_KIND_PRESENTATIONS.map(({ kind }) => kind)).toEqual(CONTENT_FIELD_KINDS);
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(CONTENT_FIELD_KINDS.length);
    for (const card of cards) {
      expect(card.querySelector("svg")).not.toBeNull();
      expect(card.querySelector("strong")?.textContent).toBeTruthy();
      expect(card.querySelector("small")?.textContent).toMatch(/\.$/);
      expect(card.querySelector("code")?.textContent).toBeTruthy();
    }
    unmount();
  });

  it("uses roving arrow selection and exposes immutable-used state", () => {
    const change = vi.fn();
    const { rerender } = render(<FieldKindPicker value="text" onChange={change} />);
    const selected = screen.getByRole("radio", { name: /Short text/ });
    selected.focus(); fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(change).toHaveBeenCalledWith("long-text");
    expect(screen.getByRole("radio", { name: /Long text/ })).toHaveFocus();

    rerender(<FieldKindPicker value="text" locked onChange={change} />);
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("In use · type locked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Number/ }));
    expect(change).toHaveBeenCalledTimes(1);
  });
});
