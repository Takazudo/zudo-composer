import { fireEvent, render, screen } from "@testing-library/preact";
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import "./overlay-test-environment";
import { Dialog, type DialogProps } from "../dialog";

type HarnessProps = Partial<Omit<DialogProps, "children" | "onClose">> & {
  onClose?: () => void;
  withInitialFocus?: boolean;
};

function DialogHarness({ onClose, withInitialFocus = false, ...props }: HarnessProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const noteRef = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Export</button>
      <Dialog
        open={open}
        title="Export composition"
        footer={<button type="button" onClick={() => setOpen(false)}>Done</button>}
        {...props}
        initialFocusRef={withInitialFocus ? noteRef : undefined}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      >
        <label>
          Note
          <input ref={noteRef} />
        </label>
      </Dialog>
    </div>
  );
}

function ConditionalDialogHarness(): JSX.Element {
  const [stage, setStage] = useState<"closed" | "A" | "B">("closed");
  const [hasTrigger, setHasTrigger] = useState(true);
  return (
    <div>
      {hasTrigger && <button type="button" onClick={() => setStage("A")}>Open conditional</button>}
      <button type="button" onClick={() => setHasTrigger(false)}>Remove trigger</button>
      {stage !== "closed" && (
        <Dialog key={stage} open title={`Conditional ${stage}`} onClose={() => setStage("closed")}>
          <button type="button" onClick={() => setStage("B")}>Replace dialog</button>
        </Dialog>
      )}
    </div>
  );
}

function openConditionalDialog(): { trigger: HTMLElement; dialog: HTMLElement } {
  const trigger = screen.getByRole("button", { name: "Open conditional" });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Conditional A" }) };
}

function openDialog(): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Export" });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: "Export composition" });
}

describe("Dialog", () => {
  it("leaves composing and already-handled Escape to its inner owner", () => {
    render(<DialogHarness />);
    const dialog = openDialog();
    fireEvent.keyDown(dialog, { key: "Escape", isComposing: true });
    fireEvent.keyDown(dialog, { key: "Escape", keyCode: 229 });
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault(); fireEvent(dialog, handled);
    expect(dialog).toHaveAttribute("open");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("stays out of the accessibility tree until it is opened", () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("opens as a modal named by its own title", () => {
    render(<DialogHarness />);
    const dialog = openDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "Export composition" }).id);
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it("moves focus to the first control inside the dialog", () => {
    render(<DialogHarness />);
    openDialog();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("honours an explicit initial focus target", () => {
    render(<DialogHarness withInitialFocus />);
    openDialog();
    expect(screen.getByLabelText("Note")).toHaveFocus();
  });

  it("closes on Escape and returns focus to whatever opened it", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const dialog = openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("closes on the header close button and restores focus", () => {
    render(<DialogHarness />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("traps Tab inside the dialog, wrapping in both directions", () => {
    render(<DialogHarness />);
    const dialog = openDialog();
    const close = screen.getByRole("button", { name: "Close" });
    const done = screen.getByRole("button", { name: "Done" });

    done.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();
  });

  it("dismisses on a backdrop click", () => {
    render(<DialogHarness />);
    const dialog = openDialog();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores clicks that land inside the panel", () => {
    render(<DialogHarness />);
    const dialog = openDialog();
    fireEvent.click(screen.getByRole("heading", { name: "Export composition" }));
    expect(dialog).toBeInTheDocument();
  });

  it("keeps the backdrop inert when dismissal is turned off", () => {
    render(<DialogHarness dismissOnBackdrop={false} />);
    const dialog = openDialog();
    fireEvent.click(dialog);
    expect(dialog).toBeInTheDocument();
  });

  it("responds to the native cancel event without letting the element self-close", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const dialog = openDialog();
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("carries the wide size as a modifier class", () => {
    render(<DialogHarness size="wide" />);
    expect(openDialog().className).toContain("cms-dialog--wide");
  });

  it("can hide the close button and take its name from a label instead of a title", () => {
    render(<DialogHarness title={undefined} label="Unsaved work" hideCloseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const dialog = screen.getByRole("dialog", { name: "Unsaved work" });
    expect(dialog).not.toHaveAttribute("aria-labelledby");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it.each(["Escape", "header", "backdrop"])("restores focus when %s conditionally unmounts the dialog", (dismiss) => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = openConditionalDialog();
    const restore = vi.spyOn(trigger, "focus");
    if (dismiss === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
    else if (dismiss === "header") fireEvent.click(screen.getByRole("button", { name: "Close" }));
    else fireEvent.click(dialog);
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("closes the dialog before restoring focus so native modal inertness is released", () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = openConditionalDialog();
    const focus = trigger.focus;
    const restore = vi.spyOn(trigger, "focus").mockImplementation(() => {
      // Model the native modal's blocked background focus, which the shared
      // jsdom showModal shim cannot reproduce.
      if (!(dialog as HTMLDialogElement).open) focus.call(trigger);
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(restore).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("restores focus on conditional unmount without native showModal support", () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")!;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: undefined });
    try {
      render(<ConditionalDialogHarness />);
      const { trigger, dialog } = openConditionalDialog();
      expect(dialog).toHaveAttribute("open");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", descriptor);
    }
  });

  it("focuses the replacement and preserves the original opener across a same-commit replacement", () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = openConditionalDialog();
    fireEvent.click(screen.getByRole("button", { name: "Replace dialog" }));
    const replacement = screen.getByRole("dialog", { name: "Conditional B" });
    expect(dialog).not.toBeInTheDocument();
    expect(replacement.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(replacement, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("does not attempt to focus a detached opener on conditional unmount", () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = openConditionalDialog();
    const restore = vi.spyOn(trigger, "focus");
    fireEvent.click(screen.getByRole("button", { name: "Remove trigger" }));
    expect(trigger.isConnected).toBe(false);
    expect(() => fireEvent.keyDown(dialog, { key: "Escape" })).not.toThrow();
    expect(restore).not.toHaveBeenCalled();
    expect(dialog).not.toBeInTheDocument();
  });

  it("restores exactly once on open=false and never again when subsequently unmounted", () => {
    const view = render(<DialogHarness />);
    const dialog = openDialog();
    const trigger = screen.getByRole("button", { name: "Export" });
    const restore = vi.spyOn(trigger, "focus");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(restore).toHaveBeenCalledOnce();
    view.unmount();
    expect(restore).toHaveBeenCalledOnce();
  });
});
