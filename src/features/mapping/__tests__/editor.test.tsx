/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import type { MappingHarness } from "./harness";
import { INCOMPATIBLE_BINDING, READY_BINDING, mappingRecord, openedHarness } from "./harness";

async function editor(bindings = [READY_BINDING, INCOMPATIBLE_BINDING]) {
  const workspace = await openedHarness(mappingRecord(bindings));
  const navigate = vi.fn();
  const view = renderApp(workspace, navigate);
  return { ...view, workspace, navigate };
}

function renderApp(workspace: MappingHarness, navigate: (href: string) => void) {
  return render(
    <MappingApp
      provider={workspace.provider}
      contentCatalog={workspace.content}
      compositionCatalog={workspace.compositions}
      contentEntries={workspace.contentEntries}
      componentProvider={activeComponentProvider}
      controller={workspace.controller}
      location={{ pathname: "/mapping", search: "" }}
      navigate={navigate}
    />,
  );
}

/** The bindings table's data rows, excluding the header and the detail rows. */
function bindingRows(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".cms-mapping-table tbody tr")]
    .filter((row) => !row.classList.contains("cms-table__detail-row"));
}

describe("Mapping editor", () => {
  it("gives each binding one table row, not three stacked card regions", async () => {
    const { container } = await editor();

    const rows = bindingRows(container);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Title")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("SectionHeading")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Ready")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Incompatible")).toBeInTheDocument();

    // The retired shape: a per-binding card stack with its own region headings.
    expect(container.querySelector(".sg-mapping-binding__flow")).toBeNull();
    expect(container.querySelector(".sg-mapping-binding__region")).toBeNull();
  });

  it("explains a broken binding in a full-width row under it, with a Fix action", async () => {
    const { container } = await editor();

    const detail = container.querySelector<HTMLElement>(".cms-table__detail-row")!;
    expect(detail).toBeInTheDocument();
    expect(detail.querySelectorAll("td")).toHaveLength(1);
    expect(detail.querySelector("td")!.getAttribute("colspan")).toBe(String(bindingRows(container)[0]!.children.length));
    expect(detail.textContent).toContain("boolean");
    expect(within(detail).getByRole("button", { name: /^Fix Published/ })).toBeInTheDocument();

    // Only the broken binding gets one.
    expect(container.querySelectorAll(".cms-table__detail-row")).toHaveLength(1);
  });

  it("rebinds a broken row to a compatible source from its Fix menu", async () => {
    const { container, workspace } = await editor();

    fireEvent.click(within(container.querySelector<HTMLElement>(".cms-table__detail-row")!).getByRole("button", { name: /^Fix Published/ }));
    const menu = await screen.findByRole("menu", { name: /^Rebind SectionHeading.eyebrow/ });

    // A boolean source is what broke this row, so it is not on offer.
    const offered = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    expect(offered.some((label) => label?.includes("Published"))).toBe(false);
    expect(offered.some((label) => label?.includes("Release date"))).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Title/ }));

    await waitFor(() => {
      const binding = workspace.controller.state.mapping!.document.bindings
        .find((candidate) => candidate.id === INCOMPATIBLE_BINDING.id)!;
      expect(binding.sourceFieldId).toBe("field-title");
    });
    await waitFor(() => expect(container.querySelectorAll(".cms-table__detail-row")).toHaveLength(0));
  });

  it("offers unbound targets as chips whose menu lists only compatible sources", async () => {
    const { container, workspace } = await editor([READY_BINDING]);

    // The one boolean prop in the Composition; only the boolean field fits it.
    fireEvent.click(screen.getByRole("button", { name: "Bind AutoGrid.fill on grid-node" }));
    const menu = await screen.findByRole("menu", { name: "Bind AutoGrid.fill to…" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Published");

    fireEvent.click(items[0]!);
    await waitFor(() => expect(workspace.controller.state.mapping!.document.bindings).toHaveLength(2));
    const added = workspace.controller.state.mapping!.document.bindings[1]!;
    expect(added.target).toEqual({ nodeId: "grid-node", prop: "fill" });
    await waitFor(() => expect(bindingRows(container)).toHaveLength(2));
  });

  it("runs Test into the Diagnostics tab instead of a modal", async () => {
    await editor();

    // The retired surface.
    expect(screen.queryByRole("button", { name: "Test Mapping" })).toBeNull();

    const diagnostics = screen.getByRole("tab", { name: /^Diagnostics/ });
    expect(diagnostics).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(diagnostics).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("dialog", { name: "Mapping test" })).toBeNull();
    // The same message is also inline on the row, which is the point: two
    // surfaces, not the three that used to disagree with each other.
    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText(/boolean/i)).toBeInTheDocument();
  });

  it("keeps a drifted binding's stored ids on screen rather than dropping the row", async () => {
    const { container } = await editor([{
      id: "binding-gone",
      sourceFieldId: "field-removed",
      target: { nodeId: "node-removed", prop: "gone" },
      transform: { kind: "identity" },
    }]);

    const row = bindingRows(container)[0]!;
    expect(within(row).getByText("Missing field")).toBeInTheDocument();
    expect(within(row).getByText("field-removed")).toBeInTheDocument();
    expect(within(row).getByText("Missing target")).toBeInTheDocument();
    expect(within(row).getByText("node-removed.gone")).toBeInTheDocument();
    expect(within(row).getByText("Blocked")).toBeInTheDocument();
  });

  it("keeps both record pickers reachable from the always-visible overflow menu", async () => {
    // The toolbar centre that normally holds them is hidden below 64rem.
    await editor([READY_BINDING]);

    fireEvent.click(screen.getByRole("button", { name: "More Mapping actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change Composition…" }));
    expect(await screen.findByRole("dialog", { name: "Choose a Composition" })).toBeInTheDocument();
  });

  it("confirms a delete on the alertdialog and returns to the library", async () => {
    const { workspace, navigate } = await editor([]);

    fireEvent.click(screen.getByRole("button", { name: "More Mapping actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));

    const confirm = await screen.findByRole("alertdialog", { name: "Delete Article Mapping?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/mapping"));
    expect(workspace.records.size).toBe(0);
  });
});
