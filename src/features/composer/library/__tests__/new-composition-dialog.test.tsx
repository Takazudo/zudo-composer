/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import type { ComponentManifest } from "@zudo-composer/component-contract";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createComponentCatalog } from "../../../../composer/browser";
import type { ReuseCatalogEntry } from "../../../../composer/browser";
import { createFixturePackManifest } from "../../../../composer/__tests__/fixtures";
import { NewCompositionDialog } from "../new-composition-dialog";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => { vi.unstubAllGlobals(); });

// `page.main` is restricted to `hero`/`text`; `hero` itself restricts its own
// `cta` slot, so it is the one accepted kind that should carry a "has rule" badge.
const MANIFEST_ENTRIES: ComponentManifest[] = [
  {
    id: "page",
    schemaVersion: 1,
    title: "Page",
    category: "Layout",
    description: "Page shell",
    source: { module: "test", exportKind: "named", exportName: "Page" },
    defaults: {},
    fields: [],
    slots: [{ id: "main", prop: "main", label: "Main", cardinality: "many", accepts: ["hero", "text"], min: 1 }],
  },
  {
    id: "shell",
    schemaVersion: 1,
    title: "Shell",
    category: "Layout",
    description: "Open shell",
    source: { module: "test", exportKind: "named", exportName: "Shell" },
    defaults: {},
    fields: [],
    slots: [{ id: "content", prop: "content", label: "Content", cardinality: "many" }],
  },
  {
    id: "hero",
    schemaVersion: 1,
    title: "Hero",
    category: "Content",
    description: "Hero banner",
    source: { module: "test", exportKind: "named", exportName: "Hero" },
    defaults: {},
    fields: [],
    slots: [{ id: "cta", prop: "cta", label: "CTA", cardinality: "single", accepts: ["text"] }],
  },
  {
    id: "text",
    schemaVersion: 1,
    title: "Text",
    category: "Content",
    description: "Text block",
    source: { module: "test", exportKind: "named", exportName: "Text" },
    defaults: {},
    fields: [],
    slots: [],
  },
];
const manifest = createComponentCatalog(createFixturePackManifest(MANIFEST_ENTRIES));

const TEMPLATE: ReuseCatalogEntry = {
  ref: { providerId: "files", recordId: "site-shell" },
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
  outletRule: { componentId: "page", slotId: "main", accepts: ["hero", "text"], cardinality: "many", min: 1 },
};

const OPEN_TEMPLATE: ReuseCatalogEntry = {
  ref: { providerId: "files", recordId: "landing-shell" },
  summary: {
    id: "landing-shell",
    name: "Landing shell",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T01:00:00.000Z",
    nodeCount: 2,
    rootCount: 1,
    publicationKind: "global-template",
    outletId: "content",
    outletLabel: "Body",
    reuseStatus: "eligible",
  },
  kind: "global-template",
  outlet: { id: "content", label: "Body" },
  outletRule: { componentId: "shell", slotId: "content", accepts: null, cardinality: "many" },
};

function baseProps(overrides: Partial<Parameters<typeof NewCompositionDialog>[0]> = {}) {
  return {
    open: true,
    providerId: "files" as const,
    manifest,
    entries: MANIFEST_ENTRIES,
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

    expect((await within(dialog).findByRole("button", { name: /Blank/ })).getAttribute("aria-pressed")).toBe("true");
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "  Consumer  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({
      providerId: "files",
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

  it("badges a restricted template with its accepted-kind count and an open template as Open", async () => {
    const listTemplates = vi.fn(async () => ({ status: "listed" as const, entries: [TEMPLATE, OPEN_TEMPLATE] }));
    render(<NewCompositionDialog {...baseProps({ intents: { listTemplates } })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    const restrictedRow = await within(dialog).findByRole("button", { name: /Site shell/ });
    expect(within(restrictedRow).getByText("🔒 2 kinds")).toBeInTheDocument();
    const openRow = within(dialog).getByRole("button", { name: /Landing shell/ });
    expect(within(openRow).getByText("Open")).toBeInTheDocument();
  });

  it("summarizes a restricted template's outlet rule and adds the live-binding footer note", async () => {
    render(<NewCompositionDialog {...baseProps()} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    const summary = within(dialog).getByLabelText("What you can place");
    expect(summary).toHaveTextContent(
      "No template, no rule. The root accepts every component in the pack. Fine for one-offs; agents get no guidance.",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    expect(summary).toHaveTextContent("Main content = Page › Main");
    expect(summary).toHaveTextContent("Accepts 2 kinds, at least 1, any order:");
    const heroRow = within(summary).getByText("Hero").closest("li")!;
    expect(within(heroRow).getByText("has rule")).toBeInTheDocument();
    const textRow = within(summary).getByText("Text").closest("li")!;
    expect(within(textRow).queryByText("has rule")).not.toBeInTheDocument();
    expect(summary).toHaveTextContent("Header/footer come from the template.");

    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Pages of this kind are bound live to Site shell; changing the rule in code changes every page bound to it.",
    );
  });

  it("summarizes an open template's outlet with no accepted-kind rule and no live-binding footer note", async () => {
    const listTemplates = vi.fn(async () => ({ status: "listed" as const, entries: [TEMPLATE, OPEN_TEMPLATE] }));
    render(<NewCompositionDialog {...baseProps({ intents: { listTemplates } })} />);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });

    fireEvent.click(within(dialog).getByRole("button", { name: /Landing shell/ }));
    const summary = within(dialog).getByLabelText("What you can place");
    expect(summary).toHaveTextContent("Body = Shell › Content");
    expect(summary).toHaveTextContent("No rule: accepts every component in the pack.");

    expect(within(dialog).getByRole("status")).toHaveTextContent("Binding to Landing shell.");
    expect(within(dialog).getByRole("status")).not.toHaveTextContent("bound live to");
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
