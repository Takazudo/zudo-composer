import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentEntryRecord, createContentModelRecord, type ContentEntryRecord, type ContentFieldDefinition } from "../../../content";
import { ContentApp } from "../content-app";
import { ContentEntryAuthor, ContentSchemaAuthor, contentFieldKeyError } from "../content-author";
import { createContentAuthoringController, type ContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

// Vitest runs without `globals`, so Testing Library never installs its own
// auto-cleanup and a second render would query against both trees.
afterEach(cleanup);

const STAMP = "2026-01-01T00:00:00.000Z";

/**
 * A model with one field of every kind the author draws itself. Markdown is
 * deliberately absent — it is a CodeMirror surface with its own suite, and
 * mounting one here would only make these assertions slower.
 */
function authorModel() {
  return createContentModelRecord({
    name: "Journal",
    kind: "collection",
    fields: [
      { id: "title", key: "title", label: "Title", required: true, kind: "text" },
      { id: "slug", key: "slug", label: "Slug", required: false, kind: "slug" },
      { id: "summary", key: "summary", label: "Summary", required: false, kind: "long-text" },
      { id: "rank", key: "rank", label: "Rank", required: false, kind: "number" },
      { id: "published", key: "published", label: "Published", required: false, kind: "boolean" },
      { id: "review-date", key: "reviewDate", label: "Review date", required: false, kind: "date" },
      { id: "source", key: "source", label: "Source", required: false, kind: "url" },
    ],
  }, { id: "journal", timestamp: STAMP });
}

async function openAuthoring(values: ContentEntryRecord["values"] = {}): Promise<ContentAuthoringController> {
  const model = authorModel();
  const entry = createContentEntryRecord(model.id, values, { id: "entry-1", timestamp: STAMP });
  const controller = createContentAuthoringController(createMemoryContentProvider({ models: [model], entries: [entry] }));
  await controller.initialize();
  await controller.openModel(model.id);
  await controller.openEntry(entry.id);
  return controller;
}

function useControllerState(controller: ContentAuthoringController) {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return state;
}

/** Mirrors the route's own reporter: a failed action is caught, never thrown. */
const run = (action: () => void | Promise<void>) => void Promise.resolve(action()).catch(() => undefined);

function EntryHarness({ controller }: { controller: ContentAuthoringController }): JSX.Element | null {
  const state = useControllerState(controller);
  return state.model && state.entry ? <ContentEntryAuthor state={state} controller={controller} run={run} /> : null;
}

function SchemaHarness({ controller, onRemove }: { controller: ContentAuthoringController; onRemove?: (field: ContentFieldDefinition) => void }): JSX.Element | null {
  const state = useControllerState(controller);
  return state.model ? (
    <ContentSchemaAuthor
      state={state}
      controller={controller}
      run={run}
      onRemove={onRemove ?? (() => undefined)}
    />
  ) : null;
}

function fieldRow(label: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(`^${label}\\b`) });
}

async function openFieldMenu(label: string): Promise<HTMLElement> {
  fireEvent.click(within(fieldRow(label)).getByRole("button", { name: `Field actions for ${label}` }));
  return await screen.findByRole("menu", { name: `${label} field actions` });
}

describe("Entry author widgets", () => {
  it("draws one real control per field kind, each named by its label", async () => {
    const controller = await openAuthoring({ title: "Hello", rank: 3 });
    render(<EntryHarness controller={controller} />);

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Hello");
    expect(screen.getByRole("textbox", { name: "Title" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Summary" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("spinbutton", { name: "Rank" })).toHaveValue(3);
    expect(screen.getByRole("switch", { name: "Published" })).not.toBeChecked();
    expect(screen.getByLabelText(/^Review date/)).toHaveAttribute("type", "date");
    expect(screen.getByRole("textbox", { name: "Source" })).toHaveAttribute("type", "url");
  });

  it("writes a number as a number and an emptied number as no value at all", async () => {
    const controller = await openAuthoring({ title: "Hello", rank: 3 });
    render(<EntryHarness controller={controller} />);
    const rank = screen.getByRole("spinbutton", { name: "Rank" });

    fireEvent.input(rank, { target: { value: "12" } });
    await waitFor(() => expect(controller.state.entry?.values.rank).toBe(12));
    fireEvent.input(rank, { target: { value: "" } });
    await waitFor(() => expect(controller.state.entry?.values).not.toHaveProperty("rank"));
  });

  it("reports its id and timestamps, and claims nothing it cannot resolve", async () => {
    const controller = await openAuthoring({ title: "Hello" });
    render(<EntryHarness controller={controller} />);

    const metadata = screen.getByRole("heading", { name: "Metadata" }).parentElement!;
    expect(within(metadata).getByText("entry-1")).toBeInTheDocument();
    expect(within(metadata).getByText("Created")).toBeInTheDocument();
    expect(within(metadata).getByText("Updated")).toBeInTheDocument();
    // "Used by" is the Mapping catalogue's answer, and the inspector's Usage
    // tab is where it is resolved — the form does not invent one.
    expect(within(metadata).queryByText("Used by")).toBeNull();
  });
});

describe("Auto-derived slug", () => {
  it("starts on for an Entry with no slug yet and follows the title", async () => {
    const controller = await openAuthoring({});
    render(<EntryHarness controller={controller} />);
    expect(screen.getByRole("switch", { name: "Auto from title" })).toBeChecked();

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Map the Moving Parts!" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Slug" })).toHaveValue("map-the-moving-parts"));
    expect(controller.state.entry?.values.slug).toBe("map-the-moving-parts");
  });

  it("retires itself the moment the slug is edited by hand, and keeps what was typed", async () => {
    const controller = await openAuthoring({});
    render(<EntryHarness controller={controller} />);
    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "First title" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Slug" })).toHaveValue("first-title"));

    fireEvent.input(screen.getByRole("textbox", { name: "Slug" }), { target: { value: "chosen-by-hand" } });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Auto from title" })).not.toBeChecked());

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Second title" } });
    await waitFor(() => expect(controller.state.entry?.values.title).toBe("Second title"));
    expect(screen.getByRole("textbox", { name: "Slug" })).toHaveValue("chosen-by-hand");
  });

  it("starts off for an Entry that already has a slug, and leaves it alone", async () => {
    const controller = await openAuthoring({ title: "Hello", slug: "hand-written" });
    render(<EntryHarness controller={controller} />);
    expect(screen.getByRole("switch", { name: "Auto from title" })).not.toBeChecked();

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Renamed" } });
    await waitFor(() => expect(controller.state.entry?.values.title).toBe("Renamed"));
    expect(controller.state.entry?.values.slug).toBe("hand-written");
  });

  it("catches up when it is switched back on", async () => {
    const controller = await openAuthoring({ title: "Some Long Title", slug: "hand-written" });
    render(<EntryHarness controller={controller} />);

    fireEvent.click(screen.getByRole("switch", { name: "Auto from title" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Slug" })).toHaveValue("some-long-title"));
  });
});

describe("Schema field table", () => {
  it("lists every field as one row of real controls", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);

    expect(screen.getByRole("table", { name: "Fields of Journal" })).toBeInTheDocument();
    const row = fieldRow("Title");
    expect(within(row).getByRole("textbox", { name: "Label for Title" })).toHaveValue("Title");
    expect(within(row).getByRole("textbox", { name: "Key for Title" })).toHaveValue("title");
    expect(within(row).getByRole("button", { name: "Type for Title" })).toHaveTextContent("Short text");
    expect(within(row).getByRole("switch", { name: "Required for Title" })).toBeChecked();
    // The nine inline type cards are gone.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("has no second Model name control — the toolbar's record title owns it", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);
    expect(screen.queryByLabelText(/Model name/)).toBeNull();
    expect(screen.getByText(/^Collection · locked after creation$/)).toBeInTheDocument();
  });

  it("toggles Required through the row's switch", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);

    fireEvent.click(within(fieldRow("Slug")).getByRole("switch", { name: "Required for Slug" }));
    await waitFor(() => expect(controller.state.model?.document.fields[1]?.required).toBe(true));
  });

  it("moves a field from its own row menu, and pins the ends", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);

    const first = await openFieldMenu("Title");
    expect(within(first).getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    fireEvent.click(within(first).getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(controller.state.model?.document.fields.map((field) => field.key).slice(0, 2)).toEqual(["slug", "title"]));

    const last = await openFieldMenu("Source");
    expect(within(last).getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  });

  it("asks the host to confirm a removal rather than removing the field itself", async () => {
    const controller = await openAuthoring({});
    const onRemove = vi.fn();
    render(<SchemaHarness controller={controller} onRemove={onRemove} />);

    fireEvent.click(within(await openFieldMenu("Rank")).getByRole("menuitem", { name: "Remove…" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRemove.mock.calls[0]![0]).toMatchObject({ id: "rank", label: "Rank" });
    expect(controller.state.model?.document.fields).toHaveLength(7);
  });

  it("adds a field to the end of the table", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    await screen.findByRole("row", { name: /^New field\b/ });
    expect(controller.state.model?.document.fields.at(-1)).toMatchObject({ label: "New field", kind: "text" });
  });

  it("locks the type once a stored Entry holds a value for the field", async () => {
    const controller = await openAuthoring({ title: "Hello" });
    render(<SchemaHarness controller={controller} />);

    const locked = within(fieldRow("Title")).getByRole("button", { name: "Type for Title" });
    expect(locked.getAttribute("title")).toMatch(/stored Entries hold values/);
    fireEvent.click(locked);
    const menu = await screen.findByRole("menu", { name: "Type for Title" });
    expect(within(menu).getByText("Type locked · stored Entries use it")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: /^Date/ })).toBeDisabled();

    // A field no Entry has filled in is still free to change.
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(within(fieldRow("Rank")).getByRole("button", { name: "Type for Rank" }));
    const open = await screen.findByRole("menu", { name: "Type for Rank" });
    expect(within(open).getByRole("menuitemradio", { name: /^Date/ })).not.toBeDisabled();
    fireEvent.click(within(open).getByRole("menuitemradio", { name: /^Date/ }));
    await waitFor(() => expect(controller.state.model?.document.fields.find((field) => field.id === "rank")?.kind).toBe("date"));
  });
});

describe("Field key validation", () => {
  it("names every way a key can be unstorable", () => {
    const fields = authorModel().document.fields;
    expect(contentFieldKeyError("reviewDate", "review-date", fields)).toBeNull();
    expect(contentFieldKeyError("", "review-date", fields)).toBe("Key is required.");
    expect(contentFieldKeyError("Review", "review-date", fields)).toMatch(/lowercase letter/);
    expect(contentFieldKeyError("review date", "review-date", fields)).toMatch(/lowercase letter/);
    expect(contentFieldKeyError("a".repeat(65), "review-date", fields)).toMatch(/lowercase letter/);
    expect(contentFieldKeyError("title", "review-date", fields)).toMatch(/already uses the key/);
    // Its own key is not a duplicate of itself.
    expect(contentFieldKeyError("title", "title", fields)).toBeNull();
  });

  it("shows the problem inline and holds the key back until it is storable", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);
    const key = within(fieldRow("Review date")).getByRole("textbox", { name: "Key for Review date" });

    // The store validates the whole model on write and throws on a bad key, so
    // an unfinished one must never reach the save queue.
    fireEvent.input(key, { target: { value: "Review" } });
    expect(await screen.findByText(/Start with a lowercase letter/)).toBeInTheDocument();
    expect(key).toHaveAttribute("aria-invalid", "true");
    expect(controller.state.model?.document.fields.find((field) => field.id === "review-date")?.key).toBe("reviewDate");

    fireEvent.input(key, { target: { value: "title" } });
    expect(await screen.findByText(/Another field already uses the key/)).toBeInTheDocument();
    expect(controller.state.model?.document.fields.find((field) => field.id === "review-date")?.key).toBe("reviewDate");

    fireEvent.input(key, { target: { value: "checkedOn" } });
    await waitFor(() => expect(controller.state.model?.document.fields.find((field) => field.id === "review-date")?.key).toBe("checkedOn"));
    expect(screen.queryByText(/Start with a lowercase letter/)).toBeNull();
  });

  it("holds an emptied label back too, so a blank one cannot fail the save", async () => {
    const controller = await openAuthoring({});
    render(<SchemaHarness controller={controller} />);
    const label = within(fieldRow("Summary")).getByRole("textbox", { name: "Label for Summary" });

    fireEvent.input(label, { target: { value: "" } });
    expect(await screen.findByText("Label is required.")).toBeInTheDocument();
    expect(controller.state.model?.document.fields.find((field) => field.id === "summary")?.label).toBe("Summary");
  });
});

describe("Content pane header", () => {
  beforeEach(() => window.history.replaceState(null, "", "/content?model=articles&entry=entry-1"));

  it("carries completeness beside the record's chips instead of a panel in the form", async () => {
    render(<ContentApp provider={createMemoryContentProvider()} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Entry title" })).toHaveValue("Hello"));

    const completeness = document.querySelector(".sg-content-completeness")!;
    expect(completeness).toHaveTextContent("Complete");
    expect(completeness.closest(".cms-pane__header")).not.toBeNull();

    fireEvent.input(screen.getByRole("textbox", { name: "Title" }), { target: { value: "" } });
    await waitFor(() => expect(document.querySelector(".sg-content-completeness")).toHaveTextContent("Incomplete draft · 1 missing"));
  });

  it("names the model exactly once in Schema mode", async () => {
    render(<ContentApp provider={createMemoryContentProvider()} />);
    // The link opens the model, and loading it resets the work mode — so the
    // switch to Schema waits for the record to arrive first.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Entry title" })).toHaveValue("Hello"));
    const mode = screen.getByRole("radiogroup", { name: "Editor mode" });
    fireEvent.click(within(mode).getByRole("radio", { name: "Schema" }));

    // #169 left the form and the toolbar sharing the name "Model name"; the
    // form's copy is gone, so this is unambiguous again.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Model name" })).toHaveValue("Articles"));
    expect(screen.getAllByRole("textbox", { name: "Model name" })).toHaveLength(1);
  });
});
