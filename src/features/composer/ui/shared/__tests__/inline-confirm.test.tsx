/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { InlineConfirm } from "../inline-confirm";

function renderConfirm(overrides: Partial<Parameters<typeof InlineConfirm>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <InlineConfirm
      ariaLabel="Confirm the thing"
      message="Do the thing?"
      confirmLabel="Confirm thing"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm };
}

describe("InlineConfirm", () => {
  it("renders the message and a labelled group, with Cancel focused initially", () => {
    renderConfirm();
    expect(screen.getByRole("group", { name: "Confirm the thing" })).toBeInTheDocument();
    expect(screen.getByText("Do the thing?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const { onCancel, onConfirm } = renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm when the confirm-label button is clicked", () => {
    const { onCancel, onConfirm } = renderConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm thing" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape on either button calls onCancel", () => {
    const { onCancel } = renderConfirm();
    fireEvent.keyDown(screen.getByRole("button", { name: "Confirm thing" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("supports a custom cancel label", () => {
    renderConfirm({ cancelLabel: "Never mind" });
    expect(screen.getByRole("button", { name: "Never mind" })).toHaveFocus();
  });
});
