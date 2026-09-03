/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReuseCatalogEntry } from "../../../../composer/browser";
import { NewCompositionDialog } from "../new-composition-dialog";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => { vi.unstubAllGlobals(); });

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
  it("opens the shared dialog, focuses the name, and restores the invoking focus on Escape", async () => {
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

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("shows Blank document first and submits a trimmed typed Global-template choice only after the user confirms", async () => {
    const props = baseProps();
    render(<NewCompositionDialog {...props} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    expect((await within(dialog).findByRole("button", { name: /Blank document/ })).getAttribute("aria-pressed")).toBe("true");
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

  it("requires a name before submitting and focuses it", async () => {
    const props = baseProps();
    render(<NewCompositionDialog {...props} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    const name = within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    fireEvent.input(name, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Give the composition a name");
    expect(name).toHaveFocus();
  });

  it("shows a template load failure with an actionable retry", async () => {
    const listTemplates = vi.fn()
      .mockResolvedValueOnce({ status: "load-error", message: "Storage is offline." })
      .mockResolvedValueOnce({ status: "listed", entries: [] });
    render(<NewCompositionDialog {...baseProps({ intents: { listTemplates } })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    expect(await within(dialog).findByText("Storage is offline.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry templates" }));
    expect(await within(dialog).findByText(/No eligible Global templates/)).toBeInTheDocument();
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
    await waitFor(() => expect(create).toBeDisabled());
  });

  it("filters the template grid by name and clears back to the full list", async () => {
    render(<NewCompositionDialog {...baseProps()} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    await within(dialog).findByRole("button", { name: /Site shell/ });

    fireEvent.input(within(dialog).getByRole("searchbox", { name: "Search Global templates" }), {
      target: { value: "nothing matches this" },
    });
    expect(within(dialog).queryByRole("button", { name: /Site shell/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText("No Global templates match this search.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear search" }));
    expect(within(dialog).getByRole("button", { name: /Site shell/ })).toBeInTheDocument();
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
