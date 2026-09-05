import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import { ContentApp } from "../content-app";
import { createMemoryContentProvider } from "../fixtures";

const stamp = "2026-01-01T00:00:00.000Z";
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/content"));

describe("Content field/path navigation", () => {
  const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [{ id: "title", key: "title", label: "Title", required: true, kind: "text" }, { id: "details", key: "details", label: "Details", required: false, kind: "object", fields: [{ id: "caption", key: "caption", label: "Caption", required: false, kind: "text" }] }] }, { id: "cards", timestamp: stamp });
  const entry = createContentEntryRecord("cards", { title: "First", details: { caption: "Focused" } }, { id: "card", timestamp: stamp });

  it("opens and focuses an exact provider/model/entry/field/path target", async () => {
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=cards&entry=card&field=details&path=%2Ff%3Acaption");
    render(<ContentApp provider={createMemoryContentProvider({ models: [model], entries: [entry] })} />);
    const caption = await screen.findByRole("textbox", { name: "Caption" });
    await waitFor(() => expect(caption).toHaveFocus());
    expect(window.location.search).toContain("field=details");
    expect(window.location.search).toContain("path=%2Ff%3Acaption");
  });

  it("keeps the Entry open and explains a stale value location", async () => {
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=cards&entry=card&field=missing");
    render(<ContentApp provider={createMemoryContentProvider({ models: [model], entries: [entry] })} />);
    expect(await screen.findByText(/requested field or structured value no longer exists/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Focused");
  });

  it("clears a prior field/path target when the navigator accepts another Entry or model", async () => {
    const second = createContentEntryRecord("cards", { title: "Second", details: { caption: "Other" } }, { id: "second", timestamp: stamp });
    const other = createContentModelRecord({ name: "Other model", kind: "collection", fields: [] }, { id: "other", timestamp: stamp });
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=cards&entry=card&field=details&path=%2Ff%3Acaption");
    render(<ContentApp provider={createMemoryContentProvider({ models: [model, other], entries: [entry, second] })} />);
    await screen.findByRole("textbox", { name: "Caption" });
    fireEvent.click(screen.getByRole("treeitem", { name: /^Second/ }));
    await waitFor(() => { expect(window.location.search).toContain("entry=second"); expect(window.location.search).not.toContain("field="); expect(window.location.search).not.toContain("path="); });
    fireEvent.click(screen.getByRole("treeitem", { name: /^Other model/ }));
    await waitFor(() => { expect(window.location.search).toContain("model=other"); expect(window.location.search).not.toContain("entry="); expect(window.location.search).not.toContain("field="); });
  });

  it("focuses the exact reference-list row named by an incoming graph location", async () => {
    const people = createContentModelRecord({ name: "People", kind: "collection", fields: [{ id: "name", key: "name", label: "Name", required: true, kind: "text" }] }, { id: "people", timestamp: stamp });
    const alice = createContentEntryRecord("people", { name: "Alice" }, { id: "alice", timestamp: stamp }), bob = createContentEntryRecord("people", { name: "Bob" }, { id: "bob", timestamp: stamp });
    const articles = createContentModelRecord({ name: "Articles", kind: "collection", fields: [{ id: "authors", key: "authors", label: "Authors", required: false, kind: "reference-list", target: { providerId: "content-indexeddb", recordId: "people" }, ordered: false }] }, { id: "articles", timestamp: stamp });
    const article = createContentEntryRecord("articles", { authors: [{ providerId: "content-indexeddb", modelId: "people", recordId: "alice" }, { providerId: "content-indexeddb", modelId: "people", recordId: "bob" }] }, { id: "article", timestamp: stamp });
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=articles&entry=article&field=authors&path=%2Fi%3A1");
    render(<ContentApp provider={createMemoryContentProvider({ models: [people, articles], entries: [alice, bob, article] })} />);
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-content-value-path", "/i:1"));
    expect(screen.queryByText(/requested field or structured value no longer exists/)).toBeNull();
  });

  it("renders the activated-baseline dependency explicitly for published Entries", async () => {
    const published = { ...entry, lifecycle: "published" as const };
    window.history.replaceState(null, "", "/content?provider=content-indexeddb&model=cards&entry=card");
    render(<ContentApp provider={createMemoryContentProvider({ models: [model], entries: [published] })} />);
    expect(await screen.findByText("Published · baseline unavailable")).toBeVisible();
    expect(screen.queryByText("Published · pending changes")).toBeNull();
  });
});
