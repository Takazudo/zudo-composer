import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { RecordTitle } from "../record-title";

function field(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Composition name" }) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.input(input, { target: { value } });
}

describe("RecordTitle", () => {
  it("renders the current name in a named field", () => {
    render(<RecordTitle value="Product overview" onCommit={vi.fn()} label="Composition name" />);
    expect(field()).toHaveValue("Product overview");
  });

  it("commits the new name on Enter", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
  });

  it("commits on blur", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "Pricing");
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
  });

  it("does not commit twice when Enter is followed by the blur it causes", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("cancels on Escape, and the blur it causes does not resurrect the edit", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue("Product overview");
  });

  it("trims the committed name", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "  Pricing  ");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
    expect(field()).toHaveValue("Pricing");
  });

  it("reverts a blank name instead of renaming the record to nothing", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    type(input, "   ");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue("Product overview");
  });

  it("stays quiet when the name is committed unchanged", () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("follows a rename that happened elsewhere", () => {
    function Harness() {
      const [name, setName] = useState("Product overview");
      return (
        <>
          <RecordTitle value={name} onCommit={setName} label="Composition name" />
          <button type="button" onClick={() => setName("Renamed in a menu")}>Rename</button>
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(field()).toHaveValue("Renamed in a menu");
  });
});
