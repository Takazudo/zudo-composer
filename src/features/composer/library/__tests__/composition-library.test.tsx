/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  type CompositionInitializationOutcome,
  type CompositionSummary,
  type ReuseCatalogEntry,
} from "../../../../composer/browser";
import { CompositionLibrary } from "../composition-library";
import type {
  CompositionLibraryIntents,
  CompositionLibraryProviderCapability,
} from "../library-contract";

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => { vi.unstubAllGlobals(); });

const EARLY = "2026-01-02T03:04:05.000Z";
const LATE = "2026-02-03T04:05:06.000Z";

function summary(id: string, name: string, updatedAt = EARLY, createdAt = EARLY): CompositionSummary {
  return { id, name, createdAt, updatedAt, nodeCount: 3 };
}

const ALPHA = summary("alpha", "Alpha layout", EARLY);
const BRAVO = summary("bravo", "Bravo layout", LATE);
const GLOBAL_TEMPLATE: ReuseCatalogEntry = {
  ref: { providerId: "indexeddb", recordId: "site-shell" },
  summary: {
    ...summary("site-shell", "Site shell", LATE),
    publicationKind: "global-template",
    outletId: "main",
    outletLabel: "Main content",
  },
  kind: "global-template",
  outlet: { id: "main", label: "Main content" },
};

const defaultProviders: CompositionLibraryProviderCapability[] = [
  { descriptor: COMPOSITION_PROVIDERS.indexeddb, available: true },
  { descriptor: COMPOSITION_PROVIDERS.files, available: false },
];

function ready(summaries: readonly CompositionSummary[]): CompositionInitializationOutcome {
  return { status: "ready", summaries };
}

function fakeIntents(overrides: Partial<CompositionLibraryIntents> = {}): CompositionLibraryIntents {
  return {
    initialize: vi.fn(async () => ready([ALPHA, BRAVO])),
    retry: vi.fn(async () => ready([ALPHA, BRAVO])),
    startFresh: vi.fn(async () => ready([])),
    listTemplates: vi.fn(async () => ({ status: "listed" as const, entries: [] })),
    create: vi.fn(async () => summary("new", "Untitled composition", LATE)),
    open: vi.fn(async () => ({ status: "opened" as const })),
    rename: vi.fn(async (ref, name) => summary(ref.recordId, name, LATE)),
    duplicate: vi.fn(async () => summary("copy", "Alpha layout copy", LATE)),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
    exportJsx: vi.fn(async () => ({
      documentName: "Alpha layout",
      outcome: { status: "ready" as const, kind: "ordinary" as const, generation: { ok: true, blocked: false, code: "export code", diagnostics: { byId: new Map(), opaqueIds: [] }, imports: [], nodeOrder: [] } as never },
    })),
    ...overrides,
  };
}

function renderLibrary(
  intents = fakeIntents(),
  providers: readonly CompositionLibraryProviderCapability[] = defaultProviders,
) {
  render(<CompositionLibrary providers={providers} initialProviderId="indexeddb" intents={intents} />);
  return intents;
}

async function waitForLibrary(): Promise<void> {
  await screen.findByRole("heading", { name: "Compositions" });
}

const dataRows = () => screen.getAllByRole("row").slice(1);

describe("CompositionLibrary data and capability states", () => {
  it("shows Plain/Pattern/Global template kind chips and node counts", async () => {
    const plain = summary("plain", "Plain page");
    const pattern = { ...summary("pattern", "Callout", LATE), publicationKind: "pattern" as const };
    const template = {
      ...summary("template", "Site shell", LATE),
      publicationKind: "global-template" as const,
      outletId: "main",
      outletLabel: "Main content",
    };
    renderLibrary(fakeIntents({ initialize: vi.fn(async () => ready([plain, pattern, template])) }));
    await waitForLibrary();

    expect(screen.getByText("Plain")).toBeInTheDocument();
    expect(screen.getByText("Pattern")).toBeInTheDocument();
    expect(screen.getByText("Global template")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("shows a semantic loading state while initialization is pending", () => {
    renderLibrary(fakeIntents({ initialize: vi.fn(() => new Promise<CompositionInitializationOutcome>(() => undefined)) }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading compositions…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("links every row to its provider-qualified detail route", async () => {
    renderLibrary();
    await waitForLibrary();

    expect(screen.getByRole("link", { name: "Bravo layout" })).toHaveAttribute("href", "/composer#/composition/indexeddb/bravo");
    expect(screen.getByRole("link", { name: "Alpha layout" })).toHaveAttribute("href", "/composer#/composition/indexeddb/alpha");
    const rows = dataRows();
    expect(within(rows[0]).getByText("Bravo layout")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Alpha layout")).toBeInTheDocument();
  });

  it("filters by name or id and comes back from Clear filters", async () => {
    renderLibrary();
    await waitForLibrary();

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), { target: { value: "alpha" } });
    expect(dataRows()).toHaveLength(1);
    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), { target: { value: "nothing here" } });
    expect(screen.getByText("No matches for “nothing here”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(dataRows()).toHaveLength(2);
  });

  it("shows an actionable empty state", async () => {
    renderLibrary(fakeIntents({ initialize: vi.fn(async () => ready([])) }));
    await waitForLibrary();
    expect(screen.getByText("No compositions yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New composition|Create your first composition/ })).toHaveLength(2);
  });

  it("distinguishes an initial recoverable list error from a genuinely empty library", async () => {
    renderLibrary(fakeIntents({
      initialize: vi.fn(async () => ({
        status: "error" as const,
        error: new CompositionPersistenceError("list", "read-failed", "Browser storage is temporarily unavailable.", true),
      })),
    }));

    expect(await screen.findByText("Composition library unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Browser storage is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No compositions yet" })).not.toBeInTheDocument();
  });

  it("omits unavailable file controls and switches only to an available provider", async () => {
    renderLibrary();
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Provider: Browser storage" }));
    expect(screen.queryByRole("menuitemradio", { name: "Local files" })).not.toBeInTheDocument();
  });

  it("switches provider and shows its own rows and label", async () => {
    const providers: CompositionLibraryProviderCapability[] = [
      { descriptor: COMPOSITION_PROVIDERS.indexeddb, available: true },
      { descriptor: COMPOSITION_PROVIDERS.files, available: true },
    ];
    const intents = fakeIntents({
      initialize: vi.fn(async (providerId) => (providerId === "files" ? ready([summary("file-a", "File composition")]) : ready([ALPHA]))),
    });
    renderLibrary(intents, providers);
    await screen.findByRole("link", { name: "Alpha layout" });

    fireEvent.click(screen.getByRole("button", { name: "Provider: Browser storage" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Local files" }));
    await screen.findByRole("link", { name: "File composition" });
    expect(screen.getByText("1 of 1 compositions · Local files")).toBeInTheDocument();
    expect(intents.initialize).toHaveBeenCalledTimes(2);
  });

  it("preserves the active provider and prior collection when a provider switch fails", async () => {
    const providers: CompositionLibraryProviderCapability[] = [
      { descriptor: COMPOSITION_PROVIDERS.indexeddb, available: true },
      { descriptor: COMPOSITION_PROVIDERS.files, available: true },
    ];
    const intents = fakeIntents({
      initialize: vi.fn(async (providerId) => {
        if (providerId === "files") {
          return { status: "error" as const, error: new CompositionPersistenceError("list", "read-failed", "Files could not be listed.", true) };
        }
        return ready([ALPHA]);
      }),
    });
    renderLibrary(intents, providers);
    await screen.findByRole("link", { name: "Alpha layout" });

    fireEvent.click(screen.getByRole("button", { name: "Provider: Browser storage" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Local files" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Files could not be listed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alpha layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Provider: Browser storage" })).toBeInTheDocument();
  });

  it("shows recovery with no readable rows and requires safe confirmation before starting fresh", async () => {
    const recovery = {
      kind: "quarantined" as const,
      reason: "future-schema" as const,
      foundSchemaVersion: 9,
      sourcePreserved: true as const,
      message: "This library was created by a newer Composer.",
    };
    const intents = fakeIntents({
      initialize: vi.fn(async () => ({ status: "recovery-required" as const, recovery })),
      startFresh: vi.fn(async () => ready([])),
    });
    renderLibrary(intents);
    await screen.findByText("Stored compositions need recovery.");
    expect(screen.getByText("This library was created by a newer Composer.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start fresh…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start fresh?" })).getByRole("button", { name: "Start fresh" }));
    await screen.findByText("No compositions yet");
    expect(intents.startFresh).toHaveBeenCalledWith("indexeddb");
  });

  it("offers a Retry when the store cannot be opened at all", async () => {
    const error = new CompositionPersistenceError("list", "read-failed", "IndexedDB is unavailable.", true);
    const intents = fakeIntents({ initialize: vi.fn(async () => ({ status: "error" as const, error })) });
    renderLibrary(intents);

    expect(await screen.findByText("Composition library unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Alpha layout" })).toBeInTheDocument();
  });
});

describe("CompositionLibrary row and bulk actions", () => {
  it("opens the New-composition dialog, creates, and opens the saved record", async () => {
    const created = summary("created", "Created composition", "2026-03-01T00:00:00.000Z");
    const intents = fakeIntents({ create: vi.fn(async () => created) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "New composition" }));

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    await waitFor(() => expect(intents.create).toHaveBeenCalledWith({ providerId: "indexeddb", name: "Untitled composition" }));
    await waitFor(() => expect(intents.open).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "created" }));
    expect(screen.getByRole("link", { name: "Created composition" })).toBeInTheDocument();
  });

  it("uses the selected same-provider Global-template row as the typed source choice", async () => {
    const intents = fakeIntents({ listTemplates: vi.fn(async () => ({ status: "listed" as const, entries: [GLOBAL_TEMPLATE] })) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "New composition" }));

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Bound page" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create composition" }));

    await waitFor(() => expect(intents.create).toHaveBeenCalledWith({
      providerId: "indexeddb",
      name: "Bound page",
      source: { sourceRecordId: "site-shell", outletId: "main" },
    }));
  });

  it("renames through the row menu and the shared dialog", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Alpha layout" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Alpha layout actions" })).getByRole("menuitem", { name: "Rename…" }));

    const dialog = screen.getByRole("dialog", { name: "Rename composition" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Alpha renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(intents.rename).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "alpha" }, "Alpha renamed"));
    expect(await screen.findByRole("link", { name: "Alpha renamed" })).toBeInTheDocument();
  });

  it("reports a failed rename inside the dialog and keeps the typed name", async () => {
    const intents = fakeIntents({ rename: vi.fn(async () => { throw new Error("Storage quota exceeded."); }) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Alpha layout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));

    const dialog = screen.getByRole("dialog", { name: "Rename composition" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Alpha renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Storage quota exceeded.");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Alpha renamed");
  });

  it("duplicates a row through the row menu and opens the copy", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Alpha layout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => expect(intents.open).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "copy" }));
    expect(await screen.findByRole("link", { name: "Alpha layout copy" })).toBeInTheDocument();
  });

  it("exports JSX for a row through the shared export dialog", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Alpha layout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export JSX" }));

    expect(await screen.findByRole("dialog", { name: "Export — Alpha layout" })).toBeInTheDocument();
    await waitFor(() => expect(intents.exportJsx).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "alpha" }));
    expect(screen.getByText("export code")).toBeInTheDocument();
  });

  it("deletes one record through the row menu and the shared confirmation", async () => {
    const intents = fakeIntents({ initialize: vi.fn(async () => ready([ALPHA])) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Alpha layout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete Alpha layout?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByText("No compositions yet");
    expect(intents.delete).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "alpha" });
  });

  it("duplicates and deletes a bulk selection without navigating away", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();

    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha layout" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bravo layout" }));
    expect(screen.getByText("2 compositions selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(intents.duplicate).toHaveBeenCalledTimes(2));
    expect(intents.open).not.toHaveBeenCalled();
    expect(screen.queryByText("2 compositions selected")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Delete Alpha layout?" })).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(intents.delete).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "alpha" }));
  });

  it("clears the library behind the shared confirmation", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Clear library" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Clear library?" })).getByRole("button", { name: "Clear library" }));

    await waitFor(() => expect(intents.clear).toHaveBeenCalledWith("indexeddb"));
    expect(await screen.findByText("No compositions yet")).toBeInTheDocument();
  });

  it("failed clear preserves every row", async () => {
    const intents = fakeIntents({ clear: vi.fn(async () => { throw new Error("Clear failed safely."); }) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Clear library" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Clear library?" })).getByRole("button", { name: "Clear library" }));

    await screen.findByText("Clear failed safely.");
    expect(screen.getByRole("link", { name: "Alpha layout" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bravo layout" })).toBeInTheDocument();
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});
