import { Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { Keyed } from "../../../runtime";
import { fireEvent, render, screen, settle } from "../../../test/render";
import "./overlay-test-environment";
import { Dialog, type DialogProps } from "../dialog";

type HarnessProps = Partial<Omit<DialogProps, "children" | "onClose">> & {
  onClose?: () => void;
  withInitialFocus?: boolean;
};

function DialogHarness({ onClose, withInitialFocus = false, ...props }: HarnessProps) {
  const open = signal(false);
  const setOpen = (value: boolean) => {
    open.value = value;
  };
  const noteRef: Ref<HTMLInputElement> = { current: null };
  return (
    <div>
      <button type="button" on:click={() => setOpen(true)}>Export</button>
      <Dialog
        open={open}
        title="Export composition"
        footer={<button type="button" on:click={() => setOpen(false)}>Done</button>}
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

function ConditionalDialogHarness() {
  const stage = signal<"closed" | "A" | "B">("closed");
  const hasTrigger = signal(true);
  const setStage = (value: "closed" | "A" | "B") => {
    stage.value = value;
  };
  return (
    <div>
      <Show when={hasTrigger}>{() => <button type="button" on:click={() => setStage("A")}>Open conditional</button>}</Show>
      <button type="button" on:click={() => {
        hasTrigger.value = false;
      }}>Remove trigger</button>
      <Keyed value={stage} by={(value) => value}>
        {(current) =>
          current.value === "closed" ? null : (
            <Dialog open title={`Conditional ${current.value}`} onClose={() => setStage("closed")}>
              <button type="button" on:click={() => setStage("B")}>Replace dialog</button>
            </Dialog>
          )
        }
      </Keyed>
    </div>
  );
}

async function openConditionalDialog(): Promise<{ trigger: HTMLElement; dialog: HTMLElement }> {
  const trigger = screen.getByRole("button", { name: "Open conditional" });
  trigger.focus();
  fireEvent.click(trigger);
  await settle();
  return { trigger, dialog: screen.getByRole("dialog", { name: "Conditional A" }) };
}

async function openDialog(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Export" });
  trigger.focus();
  fireEvent.click(trigger);
  await settle();
  return screen.getByRole("dialog", { name: "Export composition" });
}

describe("Dialog", () => {
  it("leaves composing and already-handled Escape to its inner owner", async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();
    fireEvent.keyDown(dialog, { key: "Escape", isComposing: true });
    await settle();
    fireEvent.keyDown(dialog, { key: "Escape", keyCode: 229 });
    await settle();
    const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    handled.preventDefault();
    fireEvent(dialog, handled);
    await settle();
    expect(dialog).toHaveAttribute("open");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("stays out of the accessibility tree until it is opened", async () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("opens as a modal named by its own title", async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "Export composition" }).id);
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it("moves focus to the first control inside the dialog", async () => {
    render(<DialogHarness />);
    await openDialog();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("honours an explicit initial focus target", async () => {
    render(<DialogHarness withInitialFocus />);
    await openDialog();
    expect(screen.getByLabelText("Note")).toHaveFocus();
  });

  it("closes on Escape and returns focus to whatever opened it", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const dialog = await openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("closes on the header close button and restores focus", async () => {
    render(<DialogHarness />);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("traps Tab inside the dialog, wrapping in both directions", async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();
    const close = screen.getByRole("button", { name: "Close" });
    const done = screen.getByRole("button", { name: "Done" });

    done.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    await settle();
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    await settle();
    expect(done).toHaveFocus();
  });

  it("dismisses on a backdrop click", async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();
    fireEvent.click(dialog);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores clicks that land inside the panel", async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();
    fireEvent.click(screen.getByRole("heading", { name: "Export composition" }));
    await settle();
    expect(dialog).toBeInTheDocument();
  });

  it("keeps the backdrop inert when dismissal is turned off", async () => {
    render(<DialogHarness dismissOnBackdrop={false} />);
    const dialog = await openDialog();
    fireEvent.click(dialog);
    await settle();
    expect(dialog).toBeInTheDocument();
  });

  it("responds to the native cancel event without letting the element self-close", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const dialog = await openDialog();
    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    dialog.dispatchEvent(cancel);
    await settle();
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["wide", "full"] as const)("carries the %s size as a modifier class and restores focus", async (size) => {
    render(<DialogHarness size={size} />);
    const dialog = await openDialog();
    expect(dialog.className).toContain(`cms-dialog--${size}`);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("can hide the close button and take its name from a label instead of a title", async () => {
    render(<DialogHarness title={undefined} label="Unsaved work" hideCloseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await settle();
    const dialog = screen.getByRole("dialog", { name: "Unsaved work" });
    expect(dialog).not.toHaveAttribute("aria-labelledby");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it.each(["Escape", "header", "backdrop"])("restores focus when %s conditionally unmounts the dialog", async (dismiss) => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = await openConditionalDialog();
    const restore = vi.spyOn(trigger, "focus");
    if (dismiss === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
    else if (dismiss === "header") fireEvent.click(screen.getByRole("button", { name: "Close" }));
    else fireEvent.click(dialog);
    await settle();
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("closes the dialog before restoring focus so native modal inertness is released", async () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = await openConditionalDialog();
    const focus = trigger.focus;
    const restore = vi.spyOn(trigger, "focus").mockImplementation(() => {
      // Model the native modal's blocked background focus, which the shared
      // jsdom showModal shim cannot reproduce.
      if (!(dialog as HTMLDialogElement).open) focus.call(trigger);
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(restore).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("restores focus on conditional unmount without native showModal support", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")!;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: undefined });
    try {
      render(<ConditionalDialogHarness />);
      const { trigger, dialog } = await openConditionalDialog();
      expect(dialog).toHaveAttribute("open");
      fireEvent.keyDown(dialog, { key: "Escape" });
      await settle();
      expect(dialog).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", descriptor);
    }
  });

  it("focuses the replacement and preserves the original opener across a same-commit replacement", async () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = await openConditionalDialog();
    fireEvent.click(screen.getByRole("button", { name: "Replace dialog" }));
    await settle();
    const replacement = screen.getByRole("dialog", { name: "Conditional B" });
    expect(dialog).not.toBeInTheDocument();
    expect(replacement.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(replacement, { key: "Escape" });
    await settle();
    expect(trigger).toHaveFocus();
  });

  it("does not attempt to focus a detached opener on conditional unmount", async () => {
    render(<ConditionalDialogHarness />);
    const { trigger, dialog } = await openConditionalDialog();
    const restore = vi.spyOn(trigger, "focus");
    fireEvent.click(screen.getByRole("button", { name: "Remove trigger" }));
    await settle();
    expect(trigger.isConnected).toBe(false);
    expect(() => fireEvent.keyDown(dialog, { key: "Escape" })).not.toThrow();
    await settle();
    expect(restore).not.toHaveBeenCalled();
    expect(dialog).not.toBeInTheDocument();
  });

  it("restores exactly once on open=false and never again when subsequently unmounted", async () => {
    const view = render(<DialogHarness />);
    const dialog = await openDialog();
    const trigger = screen.getByRole("button", { name: "Export" });
    const restore = vi.spyOn(trigger, "focus");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await settle();
    expect(trigger).toHaveFocus();
    expect(restore).toHaveBeenCalledOnce();
    view.unmount();
    expect(restore).toHaveBeenCalledOnce();
  });
});
