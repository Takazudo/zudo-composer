import { signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./overlay-test-environment";
import { ConfirmDialog, type ConfirmDialogProps } from "../confirm-dialog";

type HarnessProps = Partial<Omit<ConfirmDialogProps, "open">> & { onConfirm?: () => void };

function ConfirmHarness({ onConfirm, ...props }: HarnessProps) {
  const open = signal(false);
  const setOpen = (value: boolean) => {
    open.value = value;
  };
  return (
    <div>
      <button type="button" on:click={() => setOpen(true)}>Delete composition</button>
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

async function openConfirm(name = "Delete Product overview?"): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Delete composition" });
  trigger.focus();
  fireEvent.click(trigger);
  await settle();
  return screen.getByRole("alertdialog", { name });
}

describe("ConfirmDialog", async () => {
  it("asks its question as an alertdialog with one destructive answer", async () => {
    render(<ConfirmHarness />);
    const dialog = await openConfirm();
    expect(dialog).toHaveTextContent("This removes the composition and its structure.");
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("cms-dialog__action--danger");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("opens on Cancel for a destructive question", async () => {
    render(<ConfirmHarness />);
    await openConfirm();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("opens on the confirm button when the question is not destructive", async () => {
    render(<ConfirmHarness tone="default" confirmLabel="Start fresh" title="Start fresh?" />);
    await openConfirm("Start fresh?");
    expect(screen.getByRole("button", { name: "Start fresh" })).toHaveFocus();
  });

  it("takes an explicit landing spot over the tone's default", async () => {
    render(<ConfirmHarness initialFocus="confirm" />);
    await openConfirm();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("runs the action on confirm and restores focus to the opener", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    await openConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await settle();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete composition" })).toHaveFocus();
  });

  it("leaves the action unrun when it is dismissed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness onConfirm={onConfirm} />);
    const dialog = await openConfirm();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete composition" })).toHaveFocus();
  });

  it("holds still while the action is in flight", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmHarness busy onConfirm={onConfirm} />);
    const dialog = await openConfirm();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(dialog);
    await settle();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(dialog).toBeInTheDocument();
  });
});
