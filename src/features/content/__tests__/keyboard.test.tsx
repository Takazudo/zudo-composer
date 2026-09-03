import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { ContentApp } from "../content-app";
import { createMemoryContentProvider } from "../fixtures";

async function openArticles() {
  render(<ContentApp provider={createMemoryContentProvider()} />);
  const tree = await screen.findByRole("tree", { name: "Content" });
  const model = within(tree).getByRole("treeitem", { name: /^Articles/ });
  fireEvent.click(model);
  // Loading a model resets the work mode, so every test waits for its Entries
  // to arrive before touching the chrome — otherwise the load lands on top of
  // whatever the test just did.
  await within(tree).findByRole("treeitem", { name: /^Hello/ });
  return { tree, model };
}

// Vitest runs without `globals`, so Testing Library never installs its own
// auto-cleanup and a second render would query against both trees.
afterEach(cleanup);

describe("Content chrome keyboard behavior", () => {
  it("moves between Entry and Schema with the arrow keys and switches the authored record", async () => {
    await openArticles();
    const mode = await screen.findByRole("radiogroup", { name: "Editor mode" });
    const entry = within(mode).getByRole("radio", { name: "Entry" });
    const schema = within(mode).getByRole("radio", { name: "Schema" });

    entry.focus();
    fireEvent.keyDown(entry, { key: "ArrowRight" });
    expect(schema).toHaveFocus();
    await waitFor(() => expect(schema).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByRole("textbox", { name: "Key" })).toBeInTheDocument();
    expect(entry).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(schema, { key: "ArrowLeft" });
    expect(entry).toHaveFocus();
    await waitFor(() => expect(entry).toHaveAttribute("aria-checked", "true"));
  });

  it("walks the navigator with the arrow keys and opens an Entry from the tree", async () => {
    const { tree, model } = await openArticles();
    model.focus();
    fireEvent.keyDown(model, { key: "ArrowDown" });
    const leaf = within(tree).getByRole("treeitem", { name: /^Hello/ });
    expect(leaf).toHaveFocus();

    fireEvent.keyDown(leaf, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Entry title" })).toHaveValue("Hello"));
  });

  it("asks a destructive question in the shared alertdialog and restores focus on Escape", async () => {
    const { tree } = await openArticles();
    const trigger = await within(tree).findByRole("button", { name: "More actions for Articles" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete model/ }));

    // `ConfirmDialog` is an `alertdialog`, never a `dialog`.
    const dialog = await screen.findByRole("alertdialog", { name: "Delete model?" });
    expect(screen.queryByRole("dialog", { name: "Delete model?" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
