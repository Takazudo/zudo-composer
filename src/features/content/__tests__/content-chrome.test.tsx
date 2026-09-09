import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentApp } from "../content-app";
import { createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";

// Vitest runs without `globals`, so Testing Library never installs its own
// auto-cleanup and a second render would query against both trees.
afterEach(async () => {
  cleanup();
  // Provider updates can schedule Preact's after-paint effects outside act().
  // Unmounting removes their components but does not cancel the queued RAF and
  // its timeout fallback. Let that frame and its posted effect task drain while
  // jsdom's cancelAnimationFrame still exists, before Vitest disposes the window.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
});

function visit(href: string): void {
  window.history.replaceState(null, "", href);
}

beforeEach(() => visit("/content"));

async function openArticles() {
  render(<ContentApp provider={createMemoryContentProvider()} />);
  const tree = await screen.findByRole("tree", { name: "Content" });
  fireEvent.click(within(tree).getByRole("treeitem", { name: /^Articles/ }));
  await within(tree).findByRole("treeitem", { name: /^Hello/ });
  return tree;
}

function unload(): boolean {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}

describe("Content route intents", () => {
  it("applies the pinned view field list and retains its query identity", async () => {
    const model = createContentModelRecord({ name: "People", kind: "collection", fields: [
      { id: "title", key: "title", label: "Title", kind: "text", required: true },
      { id: "summary", key: "summary", label: "Summary", kind: "text", required: false },
      { id: "private", key: "private", label: "Private detail", kind: "text", required: false },
    ] }, { id: "people", timestamp: "2026-01-01T00:00:00.000Z" });
    model.document.presentation = { groups: [], inverses: [], views: [{ id: "contact", label: "Contact", fieldIds: ["summary"] }] };
    const entry = createContentEntryRecord(model.id, { title: "Person", summary: "Visible" }, { id: "person", timestamp: model.createdAt });
    visit("/content?provider=content-filesystem&model=people&entry=person&view=contact");
    render(<ContentApp provider={createMemoryContentProvider({ models: [model], entries: [entry] })} />);
    expect(await screen.findByRole("textbox", { name: "Summary" })).toHaveValue("Visible");
    expect(screen.queryByRole("textbox", { name: "Private detail" })).toBeNull();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("view")).toBe("contact"));
  });
  it("opens the model and Entry the link names", async () => {
    visit("/content?provider=content-filesystem&model=articles&entry=entry-1");
    render(<ContentApp provider={createMemoryContentProvider()} />);

    const title = await screen.findByRole("textbox", { name: "Entry title" });
    await waitFor(() => expect(title).toHaveValue("Hello"));
    const tree = screen.getByRole("tree", { name: "Content" });
    expect(within(tree).getByRole("treeitem", { name: /^Hello/ })).toHaveAttribute("aria-selected", "true");
  });
  it("keeps an unavailable view explicit instead of rewriting it to the model route", async () => {
    visit("/content?provider=content-filesystem&model=articles&view=missing");
    render(<ContentApp provider={createMemoryContentProvider()} />);
    expect(await screen.findByText('Content view "missing" is unavailable for this model.')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("missing");
    const tree = screen.getByRole("tree", { name: "Content" });
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Hello/ }));
    expect(await screen.findByRole("textbox", { name: "Entry title" })).toHaveValue("Hello");
    await waitFor(() => expect(window.location.search).toBe("?provider=content-filesystem&model=articles&entry=entry-1"));
    expect(screen.queryByText('Content view "missing" is unavailable for this model.')).toBeNull();
  });

  it("reports a malformed link instead of quietly opening the bare route", async () => {
    visit("/content?provider=content-filesystem&model=articles&model=journal");
    render(<ContentApp provider={createMemoryContentProvider()} />);

    expect(await screen.findByText("This link must include one model id.")).toBeInTheDocument();
    expect(screen.getByText("No model selected")).toBeInTheDocument();
  });

  it("shows a failed recovery load alongside the route error until a successful retry", async () => {
    const provider = createMemoryContentProvider();
    visit("/content?provider=content-filesystem&model=articles&view=missing");
    render(<ContentApp provider={provider} />);
    await screen.findByText('Content view "missing" is unavailable for this model.');
    const load = vi.spyOn(provider.store, "getEntry").mockRejectedValueOnce(new Error("Entry provider temporarily unavailable."));
    const tree = screen.getByRole("tree", { name: "Content" });
    const entry = within(tree).getByRole("treeitem", { name: /^Hello/ });
    fireEvent.click(entry);
    const failure = await screen.findByText(/Entry provider temporarily unavailable\./);
    expect(failure).toHaveTextContent('Content view "missing" is unavailable for this model.');
    expect(window.location.search).toBe("?provider=content-filesystem&model=articles&view=missing");
    fireEvent.click(entry);
    expect(await screen.findByRole("textbox", { name: "Entry title" })).toHaveValue("Hello");
    await waitFor(() => expect(window.location.search).toBe("?provider=content-filesystem&model=articles&entry=entry-1"));
    expect(screen.queryByText(/Entry provider temporarily unavailable\./)).toBeNull();
    expect(screen.queryByText(/Content view "missing" is unavailable/)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("follows the selection in the address bar, so a copied URL reopens it", async () => {
    const tree = await openArticles();
    await waitFor(() => expect(window.location.search).toBe("?provider=content-filesystem&model=articles"));

    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Hello/ }));
    await waitFor(() => expect(window.location.search).toBe("?provider=content-filesystem&model=articles&entry=entry-1"));
  });
});

describe("Content navigator and toolbar", () => {
  it("adds a model through one dialog rather than two New buttons", async () => {
    const tree = await openArticles();
    expect(screen.queryByRole("button", { name: "New Collection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Single" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Content model" });
    fireEvent.input(within(dialog).getByRole("textbox", { name: "Model name" }), { target: { value: "Site settings" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Single" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add model" }));

    const created = await within(tree).findByRole("treeitem", { name: /^Site settings/ });
    // The `single` tag rides in the row's own metadata, not in a second column.
    expect(created).toHaveTextContent("single");
    expect(screen.queryByRole("treeitem", { name: /Untitled/ })).toBeNull();
  });

  it("offers no insert point between Entries, only the terminal Add entry row", async () => {
    const tree = await openArticles();
    expect(within(tree).queryAllByRole("button", { name: /^Insert before/ })).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    // Creation prepends, so the new Entry is the first leaf and it opens.
    await waitFor(() => expect(within(tree).getAllByRole("treeitem", { name: /Untitled Entry/ })).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Entry title" })).toHaveValue(""));
  });

  it("dots an Entry that is missing a required value, and its model with it", async () => {
    const tree = await openArticles();
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));

    const incomplete = await within(tree).findByRole("treeitem", { name: /Untitled Entry.*Incomplete/ });
    expect(incomplete).toBeInTheDocument();
    await waitFor(() => expect(within(tree).getByRole("treeitem", { name: /^Articles/ })).toHaveTextContent("1 incomplete"));
  });

  it("keeps Save disabled before the first edit, with no false Saved state", async () => {
    await openArticles();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "No changes to save");
    expect(screen.queryByRole("status")).toBeNull();
    expect(unload()).toBe(false);
  });

  it("offers the other authoring mode from the overflow menu", async () => {
    await openArticles();
    fireEvent.click(screen.getByRole("button", { name: "More Content actions" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Content actions" })).getByRole("menuitem", { name: "Edit schema" }));

    await waitFor(() => expect(within(screen.getByRole("region", { name: "Editor" })).getByText("Schema", { exact: true })).toBeVisible());
  });

  it("arms the unload guard and Save after a real edit", async () => {
    const provider = createMemoryContentProvider({ failWrites: true });
    const controller = createContentAuthoringController(provider);
    render(<ContentApp provider={provider} controller={controller} />);
    const tree = await screen.findByRole("tree", { name: "Content" });
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Articles/ }));
    const entry = await within(tree).findByRole("treeitem", { name: /^Hello/ });
    fireEvent.click(entry);
    const title = await screen.findByRole("textbox", { name: "Title", exact: true });
    fireEvent.input(title, { target: { value: "Failed edit" } });

    await waitFor(() => expect(controller.state.saveStatus).toBe("error"));
    expect(unload()).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("renames the open Entry from the toolbar title, and the navigator follows", async () => {
    const tree = await openArticles();
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^Hello/ }));
    const title = await screen.findByRole("textbox", { name: "Entry title" });
    await waitFor(() => expect(title).toHaveValue("Hello"));

    fireEvent.input(title, { target: { value: "Renamed from the toolbar" } });
    fireEvent.blur(title);

    await within(tree).findByRole("treeitem", { name: /^Renamed from the toolbar/ });
  });
});
