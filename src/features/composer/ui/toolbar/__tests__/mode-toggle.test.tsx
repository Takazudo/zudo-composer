/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ComposerModeToggle } from "../mode-toggle";

describe("ComposerModeToggle", () => {
  it("marks the current mode as pressed and the other as not", () => {
    render(<ComposerModeToggle mode="edit" onSetMode={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "false");
  });

  it("flips the pressed state when mode is preview", () => {
    render(<ComposerModeToggle mode="preview" onSetMode={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onSetMode with the clicked mode", () => {
    const onSetMode = vi.fn();
    render(<ComposerModeToggle mode="edit" onSetMode={onSetMode} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onSetMode).toHaveBeenCalledWith("preview");
    expect(onSetMode).toHaveBeenCalledOnce();
  });

  it("is grouped under an accessible group label", () => {
    render(<ComposerModeToggle mode="edit" onSetMode={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Composer mode" })).toBeInTheDocument();
  });
});
