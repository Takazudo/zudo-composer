import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ContentApp } from "../content-app";
import { ContentConfirmDialog } from "../confirm-dialog";
import { createMemoryContentProvider } from "../fixtures";

describe("Content keyboard behavior", () => {
  it("uses roving tab focus with Left and Right arrows", async () => {
    render(<ContentApp provider={createMemoryContentProvider()} />);
    const models = await screen.findByRole("tab", { name: "Models" }); const entries = screen.getByRole("tab", { name: "Entries" });
    models.focus(); fireEvent.keyDown(models, { key: "ArrowRight" });
    expect(entries).toHaveFocus(); expect(entries).toHaveAttribute("aria-selected", "true"); expect(models).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(entries, { key: "ArrowLeft" }); expect(models).toHaveFocus();
  });

  it("contains dialog focus, closes on Escape, and restores trigger focus", async () => {
    const close = vi.fn(); const { rerender } = render(<><button>Trigger</button><ContentConfirmDialog open={false} title="Delete?" confirmLabel="Delete" onConfirm={() => undefined} onClose={close}>Body</ContentConfirmDialog></>);
    const trigger = screen.getByRole("button", { name: "Trigger" }); trigger.focus();
    rerender(<><button>Trigger</button><ContentConfirmDialog open title="Delete?" confirmLabel="Delete" onConfirm={() => undefined} onClose={close}>Body</ContentConfirmDialog></>);
    const cancel = screen.getByRole("button", { name: "Cancel" }); const remove = screen.getByRole("button", { name: "Delete" });
    cancel.focus(); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true }); expect(remove).toHaveFocus();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true })); expect(close).toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
