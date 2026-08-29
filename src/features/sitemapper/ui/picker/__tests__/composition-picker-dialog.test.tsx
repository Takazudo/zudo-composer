/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../../../../../sitemapper/catalog";
import { CompositionPickerDialog } from "../composition-picker-dialog";

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
    expect(within(list).getByText("Project files layout")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /Assign Project files layout/ }));
    expect(onSelect).toHaveBeenCalledWith(files.ref);
  });

  it("shows surviving entries alongside a notice for each failed provider", async () => {
    const browser = entry("browser", "This browser");
    render(
      <CompositionPickerDialog
        open
        listCompositions={async () => ({
          entries: [browser],
          failures: [
            { providerId: "files", providerLabel: "Project files", reason: "One record is unreadable." },
            { providerId: "remote", providerLabel: "Remote", reason: "Offline." },
          ],
        })}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText("This browser layout")).toBeInTheDocument();
    const notices = screen.getByLabelText("Provider notices");
    const messages = within(notices).getAllByRole("status");
    expect(messages[0]).toHaveTextContent("Project files could not be loaded: One record is unreadable.");
    expect(messages[1]).toHaveTextContent("Remote could not be loaded: Offline.");
  });
});
