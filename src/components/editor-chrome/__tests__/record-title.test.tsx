import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { RecordTitle } from "../record-title";

function field(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Composition name" }) as HTMLInputElement;
}

async function type(input: HTMLInputElement, value: string) {
  fireEvent.input(input, { target: { value } });
  await settle();
  await settle();
}

describe("RecordTitle", () => {
  it("renders the current name in a named field", async () => {
    render(<RecordTitle value="Product overview" onCommit={vi.fn()} label="Composition name" />);
    expect(field()).toHaveValue("Product overview");
  });

  it("commits the new name on Enter", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
  });

  it("commits on blur", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "Pricing");
    fireEvent.blur(input);
    await settle();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
  });

  it("does not commit twice when Enter is followed by the blur it causes", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    fireEvent.blur(input);
    await settle();

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("cancels on Escape, and the blur it causes does not resurrect the edit", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "Pricing");
    fireEvent.keyDown(input, { key: "Escape" });
    await settle();
    fireEvent.blur(input);
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue("Product overview");
  });

  it("trims the committed name", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "  Pricing  ");
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("Pricing");
    expect(field()).toHaveValue("Pricing");
  });

  it("reverts a blank name instead of renaming the record to nothing", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    const input = field();
    await type(input, "   ");
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue("Product overview");
  });

  it("stays quiet when the name is committed unchanged", async () => {
    const onCommit = vi.fn();
    render(<RecordTitle value="Product overview" onCommit={onCommit} label="Composition name" />);

    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("follows a rename that happened elsewhere", async () => {
    function Harness() {
      const name = signal("Product overview");
      const setName = (next: string) => {
        name.value = next;
      };
      return (
        <>
          <RecordTitle value={name} onCommit={setName} label="Composition name" />
          <button type="button" on:click={() => setName("Renamed in a menu")}>Rename</button>
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await settle();

    expect(field()).toHaveValue("Renamed in a menu");
  });
});
