import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { ContentApp } from "../content-app";
import { ContentConfirmDialog } from "../confirm-dialog";
import { createMemoryContentProvider } from "../fixtures";

describe("Content keyboard behavior", () => {
  it("uses roving tab focus with Left and Right arrows", async () => {
    render(<ContentApp provider={createMemoryContentProvider()} />);
    const library = await screen.findByRole("tab", { name: "Library" }); const author = screen.getByRole("tab", { name: "Author" });
    library.focus(); fireEvent.keyDown(library, { key: "ArrowRight" });
    expect(author).toHaveFocus(); expect(author).toHaveAttribute("aria-selected", "true"); expect(library).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(author, { key: "ArrowLeft" }); expect(library).toHaveFocus();
  });

  it("projects Entries and Model fields beneath each model and switches explicit work modes", async () => {
    render(<ContentApp provider={createMemoryContentProvider()} />);
    const model = await screen.findByRole("button", { name: /Articles.*Collection/ });
    expect(screen.getByRole("button", { name: /Entries.*1/ }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Model fields.*1/ }).querySelector("svg")).not.toBeNull();
    fireEvent.click(model);
    fireEvent.click(screen.getByRole("button", { name: /Model fields.*1/ }));
    expect(await screen.findByRole("group", { name: "Authoring mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Model fields", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Type for Title" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Entries", pressed: false }));
    expect(screen.getAllByRole("tab", { name: "Author" }).some((tab) => tab.getAttribute("aria-selected") === "true")).toBe(true);
    expect(screen.getByRole("button", { name: "Entries", pressed: true })).toBeInTheDocument();
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
