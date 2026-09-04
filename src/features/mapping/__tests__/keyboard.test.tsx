/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import type { MappingHarness } from "./harness";
import { READY_BINDING, harness, mappingRecord, openedHarness } from "./harness";

// Keyboard reach through the route's own surfaces. The roving and focus-trap
// rules belong to `PaneTabs`, `Menu` and `Dialog`; what is proved here is that
// the Mapping route wires them up rather than hand-rolling its own.

function renderApp(workspace: MappingHarness) {
  return render(
    <MappingApp
      provider={workspace.provider}
      contentCatalog={workspace.content}
      compositionCatalog={workspace.compositions}
      contentEntries={workspace.contentEntries}
      componentProvider={activeComponentProvider}
      controller={workspace.controller}
      location={{ pathname: "/mapping", search: "" }}
      navigate={vi.fn()}
    />,
  );
}

describe("Mapping keyboard and dialog behavior", () => {
  it("moves between the inspector tabs with the arrow keys", async () => {
    renderApp(await openedHarness(mappingRecord([READY_BINDING])));

    const preview = screen.getByRole("tab", { name: "Preview" });
    const diagnostics = screen.getByRole("tab", { name: /^Diagnostics/ });
    preview.focus();

    fireEvent.keyDown(preview, { key: "ArrowRight" });
    expect(diagnostics).toHaveFocus();
    expect(diagnostics).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(diagnostics, { key: "ArrowLeft" });
    expect(preview).toHaveFocus();
    expect(preview).toHaveAttribute("aria-selected", "true");
  });

  it("returns focus to the control that opened a picker", async () => {
    renderApp(await openedHarness(mappingRecord([READY_BINDING])));

    const opener = screen.getByRole("button", { name: "Content model: Articles" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Choose a Content model" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("dismisses a picker on Escape without changing the record", async () => {
    const workspace = await openedHarness(mappingRecord([READY_BINDING]));
    renderApp(workspace);

    fireEvent.click(screen.getByRole("button", { name: "Composition: Article page" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a Composition" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a Composition" })).toBeNull());
    expect(workspace.controller.state.saveStatus).toBe("saved");
  });

  it("returns focus to New mapping after the create dialog closes", async () => {
    const workspace = harness();
    await workspace.controller.initialize();
    renderApp(workspace);

    const opener = screen.getByRole("button", { name: "New mapping" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Create mapping" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps a destructive answer behind the alertdialog, not the plain dialog", async () => {
    await library();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Article Mapping" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));

    // `ConfirmDialog` is an alertdialog; a spec that looked for "dialog" here
    // would find nothing and pass by accident.
    expect(await screen.findByRole("alertdialog", { name: "Delete Article Mapping?" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Delete Article Mapping?" })).toBeNull();
  });
});

async function library() {
  const workspace = harness([mappingRecord([READY_BINDING])]);
  await workspace.controller.initialize();
  return renderApp(workspace);
}
