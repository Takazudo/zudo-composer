/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../../../../../sitemapper/catalog";
import { CompositionPickerDialog } from "../composition-picker-dialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(cleanup);

function entry(providerId: string, providerLabel: string): CatalogEntry {
  return {
    ref: { providerId, recordId: "same-record" },
    providerLabel,
    name: `${providerLabel} layout`,
    updatedAt: "2026-08-28T01:00:00.000Z",
    nodeCount: 3,
  };
}

describe("CompositionPickerDialog", () => {
  it("keeps same-id records from different providers as two independently assignable rows", async () => {
    const browser = entry("browser", "This browser");
    const files = entry("files", "Project files");
    const onSelect = vi.fn();
    render(
      <CompositionPickerDialog
        open
        listCompositions={async () => ({ entries: [browser, files], failures: [] })}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    const list = await screen.findByRole("list", { name: "Saved compositions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("This browser layout")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /Assign Project files layout/ }));
    expect(onSelect).toHaveBeenCalledWith(files.ref);
  });

  it("filters the list without hiding the providers that failed", async () => {
    render(
      <CompositionPickerDialog
        open
        listCompositions={async () => ({
          entries: [entry("browser", "This browser"), entry("files", "Project files")],
          failures: [{ providerId: "remote", providerLabel: "Remote", reason: "Offline." }],
        })}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    await screen.findByRole("list", { name: "Saved compositions" });
    expect(screen.getByRole("status")).toHaveTextContent("Remote could not be loaded.");

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), { target: { value: "project" } });
    expect(screen.queryByText("This browser layout")).toBeNull();
    expect(screen.getByText("Project files layout")).toBeInTheDocument();

    fireEvent.input(screen.getByRole("searchbox", { name: "Filter compositions" }), { target: { value: "nothing" } });
    expect(screen.getByText("No matches for “nothing”")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Remote could not be loaded.");
  });

  it("offers a retry when the catalog itself fails", async () => {
    const listCompositions = vi.fn()
      .mockRejectedValueOnce(new Error("Catalog offline."))
      .mockResolvedValue({ entries: [entry("browser", "This browser")], failures: [] });
    render(<CompositionPickerDialog open listCompositions={listCompositions} onSelect={() => {}} onClose={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog offline.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("This browser layout")).toBeInTheDocument();
  });
});
