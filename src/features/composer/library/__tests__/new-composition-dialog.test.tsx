/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import type { ReuseCatalogEntry } from "../../../../composer/browser";
import { NewCompositionDialog } from "../new-composition-dialog";

const TEMPLATE: ReuseCatalogEntry = {
  ref: { providerId: "indexeddb", recordId: "site-shell" },
  summary: {
    id: "site-shell",
    name: "Site shell",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    nodeCount: 3,
    rootCount: 1,
    publicationKind: "global-template",
    outletId: "main",
    outletLabel: "Main content",
    reuseStatus: "eligible",
  },
  kind: "global-template",
  outlet: { id: "main", label: "Main content" },
};

function baseProps(overrides: Partial<Parameters<typeof NewCompositionDialog>[0]> = {}) {
  return {
    open: true,
    providerId: "indexeddb" as const,
    intents: { listTemplates: vi.fn(async () => ({ status: "listed" as const, entries: [TEMPLATE] })) },
    onSubmit: vi.fn(async () => ({ status: "created" as const })),
    onRetryNavigation: vi.fn(async () => ({ status: "created" as const })),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("NewCompositionDialog", () => {
  it("opens a labelled native dialog, focuses the name, and restores the invoking focus on Escape", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "New composition";
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return <NewCompositionDialog {...baseProps({ open, onClose: () => { onClose(); setOpen(false); } })} />;
    }
    render(<Harness />);

    const dialog = await screen.findByRole("dialog", { name: "New composition" }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus();
    trigger.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("shows None first and submits a trimmed typed Global-template choice only after the user confirms", async () => {
    const props = baseProps();
    render(<NewCompositionDialog {...props} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    expect((await within(dialog).findByRole("button", { name: /None/ })).getAttribute("aria-pressed")).toBe("true");
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "  Consumer  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      providerId: "indexeddb",
      name: "Consumer",
      source: { sourceRecordId: "site-shell", outletId: "main" },
    }));
  });

  it("keeps source-load failure and no-result states inside the full-size shell with an actionable retry", async () => {
    const retry = vi.fn()
      .mockResolvedValueOnce({ status: "load-error", message: "Storage is offline." })
      .mockResolvedValueOnce({ status: "listed", entries: [] });
    render(<NewCompositionDialog {...baseProps({ intents: { listTemplates: retry } })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    expect(await within(dialog).findByText("Storage is offline.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry templates" }));
    expect(await within(dialog).findByText(/No eligible Global templates/)).toBeInTheDocument();
    expect(dialog.style.width).not.toBe("");
  });

  it("preserves form state after a save failure and retries without double-submitting", async () => {
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ status: "create-error", message: "Write failed." })
      .mockResolvedValueOnce({ status: "created" });
    render(<NewCompositionDialog {...baseProps({ onSubmit })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    fireEvent.input(name, { target: { value: "Keep me" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(await within(dialog).findByText("Write failed.")).toBeInTheDocument();
    expect(name).toHaveValue("Keep me");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("ignores an immediate second submit while the first save is still pending", async () => {
    let resolve!: (result: { status: "created" }) => void;
    const onSubmit = vi.fn(() => new Promise<{ status: "created" }>((done) => { resolve = done; }));
    render(<NewCompositionDialog {...baseProps({ onSubmit })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    const create = within(dialog).getByRole("button", { name: "Create composition" });

    fireEvent.click(create);
    fireEvent.click(create);
    expect(onSubmit).toHaveBeenCalledOnce();
    resolve({ status: "created" });
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false));
  });

  it("uses the shared 24px rect, keyboard resize clamps, and resets the size after reopening", async () => {
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    const height = vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>close</button>
          <button type="button" onClick={() => setOpen(true)}>open</button>
          <NewCompositionDialog {...baseProps({ open, onClose: () => setOpen(false) })} />
        </>
      );
    }

    render(<Harness />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    const handle = within(dialog).getByRole("button", { name: "Resize dialog" });
    expect(dialog.style.left).toBe("24px");
    expect(dialog.style.top).toBe("24px");
    expect(dialog.style.width).toBe("976px");
    expect(dialog.style.height).toBe("720px");
    expect(handle).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Shift+ArrowRight"));

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(dialog.style.width).toBe("960px");
    expect(dialog.style.height).toBe("672px");

    const capture = vi.fn();
    Object.defineProperty(handle, "setPointerCapture", { configurable: true, value: capture });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 900, clientY: 700 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: -100, clientY: -100 });
    fireEvent.pointerUp(handle, { pointerId: 9 });
    expect(capture).toHaveBeenCalledWith(9);
    expect(Number.parseInt(dialog.style.width, 10)).toBeGreaterThanOrEqual(320);
    expect(Number.parseInt(dialog.style.height, 10)).toBeGreaterThanOrEqual(240);

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    const reopened = await screen.findByRole("dialog", { name: "New composition" });
    expect(reopened.style.width).toBe("976px");
    expect(reopened.style.height).toBe("720px");
    width.mockRestore();
    height.mockRestore();
  });
});
