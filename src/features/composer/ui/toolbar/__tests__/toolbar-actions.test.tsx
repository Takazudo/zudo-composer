/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ComposerToolbarActions } from "../toolbar-actions";

describe("ComposerToolbarActions", () => {
  it("calls onExport as a pure callback", () => {
    const onExport = vi.fn();
    render(<ComposerToolbarActions onReset={vi.fn()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export JSX" }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("disables Export when exportDisabled is set", () => {
    render(<ComposerToolbarActions onReset={vi.fn()} onExport={vi.fn()} exportDisabled />);
    expect(screen.getByRole("button", { name: "Export JSX" })).toBeDisabled();
  });

  it("supports a custom export label", () => {
    render(
      <ComposerToolbarActions onReset={vi.fn()} onExport={vi.fn()} exportLabel="Preview JSX" />,
    );
    expect(screen.getByRole("button", { name: "Preview JSX" })).toBeInTheDocument();
  });
});
