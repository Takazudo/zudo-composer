import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../../content";
import { ContentApp } from "../content-app";
import { createMemoryContentProvider } from "../fixtures";

const stamp = "2026-01-01T00:00:00.000Z";
afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/content"));

describe("Content field/path navigation", () => {
  const model = createContentModelRecord({ name: "Cards", kind: "collection", fields: [{ id: "details", key: "details", label: "Details", required: false, kind: "object", fields: [{ id: "caption", key: "caption", label: "Caption", required: false, kind: "text" }] }] }, { id: "cards", timestamp: stamp });
  const entry = createContentEntryRecord("cards", { details: { caption: "Focused" } }, { id: "card", timestamp: stamp });

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
});
