/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import {
  COMPOSITION_PROVIDERS,
  CompositionPersistenceError,
  type ReuseCatalogEntry,
  type CompositionInitializationOutcome,
  type CompositionSummary,
} from "../../../../composer";
import { CompositionLibrary } from "../composition-library";
import type {
  CompositionLibraryIntents,
  CompositionLibraryProviderCapability,
} from "../library-contract";

const EARLY = "2026-01-02T03:04:05.000Z";
const LATE = "2026-02-03T04:05:06.000Z";

function summary(
  id: string,
  name: string,
  updatedAt = EARLY,
  createdAt = EARLY,
): CompositionSummary {
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
    rootCount: 1,
    reuseStatus: "eligible",
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

function fakeIntents(
  overrides: Partial<CompositionLibraryIntents> = {},
): CompositionLibraryIntents {
  return {
    initialize: vi.fn(async () => ready([ALPHA, BRAVO])),
    retry: vi.fn(async () => ready([ALPHA, BRAVO])),
    startFresh: vi.fn(async () => ready([])),
    listTemplates: vi.fn(async () => ({ status: "listed" as const, entries: [] })),
    create: vi.fn(async () => summary("new", "Untitled composition", LATE)),
    open: vi.fn(async () => ({ status: "opened" as const })),
    duplicate: vi.fn(async () => summary("copy", "Alpha layout copy", LATE)),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderLibrary(
  intents = fakeIntents(),
  providers: readonly CompositionLibraryProviderCapability[] = defaultProviders,
) {
  render(
    <CompositionLibrary
      providers={providers}
      initialProviderId="indexeddb"
      intents={intents}
    />,
  );
  return intents;
}

async function waitForLibrary(): Promise<void> {
  await screen.findByRole("heading", { name: "Compositions" });
}

describe("CompositionLibrary data and capability states", () => {
  it("shows concise persisted Global template and Pattern roles without creating another library", async () => {
    const global = {
      ...summary("global", "Site shell"),
      publicationKind: "global-template" as const,
      outletId: "outlet-main",
      outletLabel: "Main content",
    };
    const pattern = {
      ...summary("pattern", "Callout", LATE),
      publicationKind: "pattern" as const,
    };
    renderLibrary(fakeIntents({ initialize: vi.fn(async () => ready([global, pattern])) }));
    await waitForLibrary();

    expect(screen.getByText("Global template · Main content")).toBeInTheDocument();
    expect(screen.getByText("Pattern · Saved composition")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Composition library" })).toBeInTheDocument();
  });

  it("shows a semantic loading state and polite live progress while initialization is pending", () => {
    renderLibrary(fakeIntents({ initialize: vi.fn(() => new Promise<CompositionInitializationOutcome>(() => undefined)) }));

    expect(screen.getByRole("main", { name: "Composition library" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Loading compositions…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading compositions…");
  });

  it("sorts newest-first deterministically, exposes identity, filters by name or id, and shows no-match state", async () => {
    renderLibrary();
    await waitForLibrary();

    expect(screen.getByText("IndexedDB: zudo-composer")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("button", { name: "Open Bravo layout" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Open Alpha layout" })).toBeInTheDocument();

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), {
      target: { value: "alpha" },
    });
    expect(screen.getByRole("button", { name: "Open Alpha layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Bravo layout" })).not.toBeInTheDocument();

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), {
      target: { value: "missing" },
    });
    expect(screen.getByRole("heading", { name: "No matching compositions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("button", { name: "Open Bravo layout" })).toBeInTheDocument();
  });

  it("shows an actionable empty state", async () => {
    renderLibrary(fakeIntents({ initialize: vi.fn(async () => ready([])) }));
    await waitForLibrary();

    expect(screen.getByRole("heading", { name: "No compositions yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New composition" })).toHaveLength(2);
  });

  it("distinguishes an initial recoverable list error from a genuinely empty library", async () => {
    renderLibrary(fakeIntents({
      initialize: vi.fn(async () => ({
        status: "error" as const,
        error: new CompositionPersistenceError("list", "read-failed", "Browser storage is temporarily unavailable.", true),
      })),
    }));

    expect(await screen.findByRole("heading", { name: "Composition library unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("button", { name: "Retry library" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "No compositions yet" })).not.toBeInTheDocument();
  });

  it("omits unavailable file controls and switches only to an available provider", async () => {
    const firstView = render(
      <CompositionLibrary providers={defaultProviders} initialProviderId="indexeddb" intents={fakeIntents()} />,
    );
    await waitForLibrary();
    expect(screen.queryByRole("option", { name: "Local files" })).not.toBeInTheDocument();
    firstView.unmount();

    const providers: CompositionLibraryProviderCapability[] = [
      { descriptor: COMPOSITION_PROVIDERS.indexeddb, available: true },
      { descriptor: COMPOSITION_PROVIDERS.files, available: true },
    ];
    const switchIntents = fakeIntents({
      initialize: vi.fn(async (providerId) =>
        providerId === "files" ? ready([summary("file-a", "File composition")]) : ready([ALPHA]),
      ),
    });
    renderLibrary(switchIntents, providers);
    await screen.findByRole("button", { name: "Open Alpha layout" });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "files" },
    });
    await screen.findByRole("button", { name: "Open File composition" });
    expect(screen.getByText("Development composition files")).toBeInTheDocument();
    expect(switchIntents.initialize).toHaveBeenCalledTimes(2);
  });

  it("preserves the active provider and prior collection when a provider list fails", async () => {
    const providers: CompositionLibraryProviderCapability[] = [
      { descriptor: COMPOSITION_PROVIDERS.indexeddb, available: true },
      { descriptor: COMPOSITION_PROVIDERS.files, available: true },
    ];
    const intents = fakeIntents({
      initialize: vi.fn(async (providerId) => {
        if (providerId === "files") {
          return {
            status: "error" as const,
            error: new CompositionPersistenceError("list", "read-failed", "Files could not be listed.", true),
          };
        }
        return ready([ALPHA]);
      }),
    });
    renderLibrary(intents, providers);
    await screen.findByRole("button", { name: "Open Alpha layout" });

    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "files" },
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Open Alpha layout" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("indexeddb");
    expect(screen.getByText("IndexedDB: zudo-composer")).toBeInTheDocument();
  });

  it("shows future-schema recovery and requires safe confirmation before starting fresh", async () => {
    const recovery = {
      kind: "quarantined",
      reason: "future-schema",
      foundSchemaVersion: 9,
      sourcePreserved: true,
      message: "This library was created by a newer Composer.",
    } as const;
    const intents = fakeIntents({
      initialize: vi.fn(async () => ({ status: "recovery-required" as const, recovery })),
      startFresh: vi.fn(async () => ready([])),
    });
    renderLibrary(intents);
    await screen.findByRole("heading", { name: "Recovery required" });
    expect(screen.getByText("The original source has been preserved.")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Start fresh" });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start fresh" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    await waitFor(() => expect(intents.startFresh).toHaveBeenCalledWith("indexeddb"));
    const emptyHeading = await screen.findByRole("heading", { name: "No compositions yet" });
    await waitFor(() =>
      expect(within(emptyHeading.parentElement!).getByRole("button", { name: "New composition" })).toHaveFocus(),
    );
  });

  it("keeps the collection actionable when open reports not-found", async () => {
    const intents = fakeIntents({ open: vi.fn(async () => ({ status: "not-found" as const })) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Open Alpha layout" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("was not found");
    expect(screen.getByRole("button", { name: "Open Alpha layout" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Bravo layout" })).toBeInTheDocument();
  });
});

describe("CompositionLibrary async operations and focus", () => {
  it("opens one New dialog before creating, then sends the typed intent and opens its saved record", async () => {
    const created = summary("created", "Created composition", "2026-03-01T00:00:00.000Z");
    const intents = fakeIntents({ create: vi.fn(async () => created) });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    expect(intents.create).not.toHaveBeenCalled();
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => expect(intents.create).toHaveBeenCalledWith({
      providerId: "indexeddb",
      name: "Untitled composition",
    }));
    await waitFor(() => expect(intents.open).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "created" }));
    expect(screen.getByRole("button", { name: "Open Created composition" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("created and opened");
  });

  it("uses the selected same-provider Global-template row as the typed source choice", async () => {
    const intents = fakeIntents({
      listTemplates: vi.fn(async () => ({ status: "listed" as const, entries: [GLOBAL_TEMPLATE] })),
    });
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "Bound page" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Site shell/ }));
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => expect(intents.create).toHaveBeenCalledWith({
      providerId: "indexeddb",
      name: "Bound page",
      source: { sourceRecordId: "site-shell", outletId: "main" },
    }));
  });

  it("keeps the dialog open with its input and selection after a failed create", async () => {
    const failed = fakeIntents({ create: vi.fn(async () => { throw new Error("Create failed safely."); }) });
    renderLibrary(failed);
    await screen.findAllByRole("button", { name: "Open Alpha layout" });
    const newButtons = screen.getAllByRole("button", { name: "New composition" });
    fireEvent.click(newButtons[newButtons.length - 1]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    fireEvent.input(name, { target: { value: "Keep this name" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByText("Create failed safely.")).toBeInTheDocument();
    expect(name).toHaveValue("Keep this name");
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open Alpha layout" }).length).toBeGreaterThan(0);
  });

  it("duplicates then requests opening the copy; failed duplicate preserves rows", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Alpha layout" }));
    await waitFor(() => expect(intents.open).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "copy" }));
    expect(screen.getByRole("button", { name: "Open Alpha layout copy" })).toBeInTheDocument();

    const failed = fakeIntents({ duplicate: vi.fn(async () => { throw new Error("Duplicate failed safely."); }) });
    renderLibrary(failed);
    await screen.findAllByRole("button", { name: "Duplicate Alpha layout" });
    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate Alpha layout" }).at(-1)!);
    expect(await screen.findByText("Duplicate failed safely.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Open Alpha layout" }).length).toBeGreaterThan(0);
  });

  it("keeps successfully created and duplicated records when their follow-up open rejects", async () => {
    const intents = fakeIntents({ open: vi.fn(async () => { throw new Error("Navigation unavailable."); }) });
    renderLibrary(intents);
    await waitForLibrary();

    fireEvent.click(screen.getAllByRole("button", { name: "New composition" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New composition" });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByRole("button", { name: "Open Untitled composition" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("was saved, but opening failed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Alpha layout" }));
    expect(await screen.findByRole("button", { name: "Open Alpha layout copy" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("duplicate was saved, but opening failed");
  });

  it("delete cancel restores its trigger; confirm focuses the deterministic surviving row", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    const trigger = screen.getByRole("button", { name: "Delete Bravo layout" });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Bravo layout" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Delete Bravo layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete composition" }));
    await waitFor(() => expect(intents.delete).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "bravo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Alpha layout" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Open Bravo layout" })).not.toBeInTheDocument();
  });

  it("failed and not-found deletes preserve the row and restore its delete trigger", async () => {
    for (const deleteIntent of [
      vi.fn(async () => false),
      vi.fn(async () => { throw new Error("Delete failed safely."); }),
    ]) {
      const intents = fakeIntents({ delete: deleteIntent });
      const view = render(
        <CompositionLibrary providers={defaultProviders} initialProviderId="indexeddb" intents={intents} />,
      );
      await screen.findByRole("button", { name: "Delete Alpha layout" });
      fireEvent.click(screen.getByRole("button", { name: "Delete Alpha layout" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete composition" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Delete Alpha layout" })).toHaveFocus());
      expect(screen.getByRole("button", { name: "Open Alpha layout" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("focuses the no-match action when deleting the only row visible through a filter", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), {
      target: { value: "alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete composition" }));

    expect(await screen.findByRole("heading", { name: "No matching compositions" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear filter" })).toHaveFocus());
  });

  it("clear cancel restores its trigger; success focuses the empty-state action", async () => {
    const intents = fakeIntents();
    renderLibrary(intents);
    await waitForLibrary();
    const trigger = screen.getByRole("button", { name: "Clear library" });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear library" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Clear library" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear library" }));
    await waitFor(() => expect(intents.clear).toHaveBeenCalledWith("indexeddb"));
    const emptyState = screen.getByRole("heading", { name: "No compositions yet" }).parentElement!;
    await waitFor(() => expect(within(emptyState).getByRole("button", { name: "New composition" })).toHaveFocus());
  });

  it("failed clear preserves every row and restores the clear trigger", async () => {
    const intents = fakeIntents({ clear: vi.fn(async () => { throw new Error("Clear failed safely."); }) });
    renderLibrary(intents);
    await waitForLibrary();
    const trigger = screen.getByRole("button", { name: "Clear library" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Clear library" }));
    await screen.findByText("Clear failed safely.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear library" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Open Alpha layout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Bravo layout" })).toBeInTheDocument();
  });
});

describe("CompositionLibrary accessibility CSS contract", () => {
  const css = readFileSync(resolve(process.cwd(), "src/features/composer/styles.css"), "utf8");

  it("keeps primary controls at least 44px and provides visible focus", () => {
    expect(css).toMatch(/\.sg-composer-library-button,[\s\S]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.sg-composer-library :where\(button, input, select\):focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--color-focus\)/);
  });

  it("uses shrinking flex seams, scoped hover, tokens, and a mobile-first breakpoint without horizontal overflow", () => {
    expect(css).toMatch(/\.sg-composer-library\s*\{[\s\S]*inline-size:\s*100%[\s\S]*min-width:\s*0/);
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain("var(--color-surface)");
    expect(css).toContain("@media (min-width: 48rem)");
    expect(css).not.toMatch(/\.sg-composer-library[^{]*\{[^}]*width:\s*\d+px/);
  });
});
