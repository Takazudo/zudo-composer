import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { SegmentedControl } from "../segmented-control";
import type { SegmentedOption } from "../segmented-control";

const VIEWS: readonly SegmentedOption<"table" | "cards" | "map">[] = [
  { value: "table", label: "Table" },
  { value: "cards", label: "Cards" },
  { value: "map", label: "Map" },
];

type View = "table" | "cards" | "map";

interface HarnessProps {
  mode?: "radio" | "pressed";
  initial?: View;
  options?: readonly SegmentedOption<View>[];
}

function Harness({ mode = "radio", initial = "table", options = VIEWS }: HarnessProps) {
  const [value, setValue] = useState<View>(initial);
  return <SegmentedControl label="View" options={options} value={value} onChange={setValue} mode={mode} />;
}

describe("SegmentedControl — radiogroup mode", () => {
  it("exposes a named radiogroup of radios", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "View" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Table", checked: true })).toBeInTheDocument();
  });

  it("puts the only tab stop on the selected option", () => {
    render(<Harness initial="cards" />);
    const [table, cards, map] = screen.getAllByRole("radio");
    expect(table).toHaveAttribute("tabindex", "-1");
    expect(cards).toHaveAttribute("tabindex", "0");
    expect(map).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with the arrow keys and wraps around", () => {
    render(<Harness />);
    const options = screen.getAllByRole("radio");
    fireEvent.keyDown(options[0], { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Cards", checked: true })).toBe(document.activeElement);
    fireEvent.keyDown(options[1], { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Table", checked: true })).toBe(document.activeElement);
    fireEvent.keyDown(options[0], { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Map", checked: true })).toBe(document.activeElement);
  });

  it("answers Up and Down as the radio-group pattern expects", () => {
    render(<Harness />);
    const options = screen.getAllByRole("radio");
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Cards", checked: true })).toBeInTheDocument();
    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    expect(screen.getByRole("radio", { name: "Table", checked: true })).toBeInTheDocument();
  });

  it("jumps to the ends with Home and End", () => {
    render(<Harness initial="cards" />);
    const options = screen.getAllByRole("radio");
    fireEvent.keyDown(options[1], { key: "End" });
    expect(screen.getByRole("radio", { name: "Map", checked: true })).toBe(document.activeElement);
    fireEvent.keyDown(options[2], { key: "Home" });
    expect(screen.getByRole("radio", { name: "Table", checked: true })).toBe(document.activeElement);
  });

  it("skips a disabled option when roving", () => {
    render(
      <Harness
        options={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards", disabled: true },
          { value: "map", label: "Map" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Map", checked: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cards" })).toBeDisabled();
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" options={VIEWS} value="table" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Map" }));
    expect(onChange).toHaveBeenCalledWith("map");
  });

  it("names an icon-only option from ariaLabel", () => {
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: "table", ariaLabel: "Table view" },
          { value: "cards", ariaLabel: "Card view" },
        ]}
        value="table"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Table view" })).toBeInTheDocument();
  });
});

describe("SegmentedControl — pressed mode", () => {
  it("exposes toggle buttons inside a plain group", () => {
    render(<Harness mode="pressed" />);
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("button", { name: "Table", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cards", pressed: false })).toBeInTheDocument();
  });

  it("moves focus without selecting, leaving activation to the button", () => {
    render(<Harness mode="pressed" />);
    const buttons = screen.getAllByRole("button");
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(screen.getByRole("button", { name: "Table", pressed: true })).toBeInTheDocument();
    fireEvent.click(buttons[1]);
    expect(screen.getByRole("button", { name: "Cards", pressed: true })).toBeInTheDocument();
  });

  it("ignores the vertical arrows a toolbar does not own", () => {
    render(<Harness mode="pressed" />);
    const buttons = screen.getAllByRole("button");
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[0]);
  });
});
