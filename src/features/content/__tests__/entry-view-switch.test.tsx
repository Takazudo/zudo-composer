import { cleanup, fireEvent, render, screen, settleTasks } from "../../../test/render";
import { afterEach, describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import { ContentApp } from "../content-app";
import { createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

afterEach(cleanup);

const timestamp = "2026-01-01T00:00:00.000Z";

async function fixture() {
  window.history.replaceState(null, "", "/content");
  const authors = createContentModelRecord({ name: "Authors", kind: "collection", fields: [{ id: "name", key: "name", label: "Name", required: true, kind: "text" }] }, { id: "authors", timestamp });
  const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [
    { id: "title", key: "title", label: "Title", required: true, kind: "text" },
    { id: "author", key: "author", label: "Author", required: false, kind: "reference", target: { providerId: "content-filesystem", recordId: "authors" } },
  ] }, { id: "articles", timestamp });
  const ada = createContentEntryRecord("authors", { name: "Ada" }, { id: "author-ada", timestamp });
  const quiet = createContentEntryRecord("articles", { title: "The quiet hour", author: { providerId: "content-filesystem", modelId: "authors", recordId: "author-missing" } }, { id: "article-quiet", timestamp });
  const known = createContentEntryRecord("articles", { title: "Known author", author: { providerId: "content-filesystem", modelId: "authors", recordId: "author-ada" } }, { id: "article-known", timestamp });
  const provider = createMemoryContentProvider({ models: [authors, articles], entries: [ada, quiet, known] });
  const controller = createContentAuthoringController(provider);
  await controller.initialize();
  return { provider, controller };
}

describe("Content main pane view switch", () => {
  // The browser sequence: open a model (the Entries table), then select an
  // Entry. The Entry editor replaces the table even when a reference field
  // renders an `<option>` whose label mixes text and an interpolated value.
  it("replaces the Entries table with the Entry editor when an Entry is selected", async () => {
    const { provider, controller } = await fixture();
    const view = render(<ContentApp provider={provider} controller={controller} />);
    await controller.openModel("articles");
    await settleTasks();
    expect(await screen.findByRole("table", { name: "Entries in Articles" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("treeitem", { name: /The quiet hour/ }));
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("The quiet hour");
    expect(screen.queryByRole("table", { name: "Entries in Articles" })).toBeNull();
    expect(screen.getByRole("option", { name: "Missing Entry · author-missing" })).toBeInTheDocument();

    await controller.openEntry("article-known");
    await settleTasks();
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Known author");
    expect(screen.getByRole("option", { name: /^Ada · / })).toBeInTheDocument();
    expect(view.diagnostics).toEqual([]);
  });
});
