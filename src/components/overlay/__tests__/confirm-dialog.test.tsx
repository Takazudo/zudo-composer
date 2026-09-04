import { fireEvent, render, screen } from "@testing-library/preact";
import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import "./overlay-test-environment";
import { ConfirmDialog, type ConfirmDialogProps } from "../confirm-dialog";

type HarnessProps = Partial<Omit<ConfirmDialogProps, "open">> & { onConfirm?: () => void };

function ConfirmHarness({ onConfirm, ...props }: HarnessProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Delete composition</button>
      <ConfirmDialog
        open={open}
        title="Delete Product overview?"
        message="This removes the composition and its structure. It cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        {...props}
        onConfirm={() => {
          onConfirm?.();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

function openConfirm(name = "Delete Product overview?"): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Delete composition" });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("alertdialog", { name });
}

describe("ConfirmDialog", () => {
  it("asks its question as an alertdialog with one destructive answer", () => {
    render(<ConfirmHarness />);
    const dialog = openConfirm();
    expect(dialog).toHaveTextContent("This removes the composition and its structure.");
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("cms-dialog__action--danger");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("opens on Cancel for a destructive question", () => {
    render(<ConfirmHarness />);
    openConfirm();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("opens on the confirm button when the question is not destructive", () => {
    render(<ConfirmHarness tone="default" confirmLabel="Start fresh" title="Start fresh?" />);
    openConfirm("Start fresh?");
    expect(screen.getByRole("button", { name: "Start fresh" })).toHaveFocus();
  });

  it("takes an explicit landing spot over the tone's default", () => {
    render(<ConfirmHarness initialFocus="confirm" />);
    openConfirm();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("runs the action on confirm and restores focus to the opener", () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete composition" })).toHaveFocus();
  });

  it("leaves the action unrun when it is dismissed", () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    const dialog = openConfirm();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete composition" })).toHaveFocus();
  });

  it("holds still while the action is in flight", () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness busy onConfirm={onConfirm} />);
    const dialog = openConfirm();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
  });
});
