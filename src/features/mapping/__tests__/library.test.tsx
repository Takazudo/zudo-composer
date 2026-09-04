/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import type { MappingHarness } from "./harness";
import {
  COMPOSITION_REF,
  CONTENT_REF,
  NOW,
  READY_BINDING,
  harness,
  mappingRecord,
  model,
} from "./harness";

const SECOND_MODEL = { providerId: "content-indexeddb", recordId: "model-2" } as const;
const SECOND_COMPOSITION = { providerId: "indexeddb", recordId: "composition-2" } as const;

function renderApp(workspace: MappingHarness, navigate: (href: string) => void, search = "") {
  return render(
    <MappingApp
      provider={workspace.provider}
      contentCatalog={workspace.content}
      compositionCatalog={workspace.compositions}
      contentEntries={workspace.contentEntries}
      componentProvider={activeComponentProvider}
      controller={workspace.controller}
      location={{ pathname: "/mapping", search }}
      navigate={navigate}
    />,
  );
}

async function library(records = [mappingRecord([READY_BINDING])], search = "") {
  const workspace = harness(records);
  await workspace.controller.initialize();
  const navigate = vi.fn();
  return { ...renderApp(workspace, navigate, search), workspace, navigate };
}

/**
 * Two Content models and two Compositions, so a list POSITION and a record ID
 * can disagree. `reorder` flips both catalogs; re-initializing then republishes
 * them in the new order while the create dialog is still open.
 */
function twoOfEach(workspace: MappingHarness): { reorder: () => void } {
  let flipped = false;
  const models = [
    { ref: CONTENT_REF, name: model.document.name },
    { ref: SECOND_MODEL, name: "Guides" },
  ];
  const compositions = [
    { ref: COMPOSITION_REF, name: "Article page" },
    { ref: SECOND_COMPOSITION, name: "Guide page" },
  ];
  const order = <T,>(items: readonly T[]): readonly T[] => (flipped ? [...items].reverse() : items);

  workspace.content.listModels = async () => ({
    status: "listed",
    entries: order(models).map((entry) => ({
      ref: { ...entry.ref },
      providerLabel: "Browser storage",
      summary: { id: entry.ref.recordId, name: entry.name, kind: "collection" as const, fieldCount: 1, createdAt: NOW, updatedAt: NOW },
    })),
    failures: [],
  });
  workspace.compositions.list = async () => ({
    status: "listed",
    entries: order(compositions).map((entry) => ({
      ref: { ...entry.ref },
      providerLabel: "Browser storage",
      summary: { id: entry.ref.recordId, name: entry.name, createdAt: NOW, updatedAt: NOW, nodeCount: 1 },
    })),
    failures: [],
  });

  return { reorder: () => { flipped = true; } };
}

describe("Mapping library", () => {
  it("shows each Mapping's source, target, bindings and readiness on one row", async () => {
    const { container } = await library();

    const row = within(container.querySelector<HTMLElement>(".cms-table tbody tr")!);
    expect(row.getByRole("link", { name: "Article Mapping" }))
      .toHaveAttribute("href", "/mapping?provider=mapping-indexeddb&mapping=mapping-1");
    expect(row.getByText("Articles")).toBeInTheDocument();
    expect(row.getByText("Article page")).toBeInTheDocument();
    await waitFor(() => expect(row.getByText("Ready")).toBeInTheDocument());
  });

  it("reports a blocked Mapping's diagnostic count in the status column", async () => {
    const broken = mappingRecord([{
      id: "binding-gone",
      sourceFieldId: "field-removed",
      target: { nodeId: "node-removed", prop: "gone" },
      transform: { kind: "identity" },
    }], "mapping-broken", "Broken Mapping");
    const { container } = await library([broken]);

    const row = within(container.querySelector<HTMLElement>(".cms-table tbody tr")!);
    await waitFor(() => expect(row.getByText(/blocking$/)).toBeInTheDocument());
  });

  it("creates against the records the author picked, not their list positions", async () => {
    const workspace = harness();
    const catalogs = twoOfEach(workspace);
    await workspace.controller.initialize();
    const navigate = vi.fn();
    renderApp(workspace, navigate);

    fireEvent.click(screen.getByRole("button", { name: "New mapping" }));
    const dialog = await screen.findByRole("dialog", { name: "Create mapping" });

    // Pick the second entry of each list.
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Content model" }), { target: { value: "content-indexeddb/model-2" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Composition" }), { target: { value: "indexeddb/composition-2" } });

    // The catalogs reload in a different order while the dialog is still open.
    catalogs.reorder();
    await workspace.controller.initialize();
    await waitFor(() => {
      const options = within(dialog).getByRole("combobox", { name: "Content model" }).querySelectorAll("option");
      expect(options[0]!.textContent).toContain("Guides");
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(workspace.records.size).toBe(1));
    const created = [...workspace.records.values()][0]!;
    expect(created.document.contentModel).toEqual({ ...SECOND_MODEL });
    expect(created.document.composition).toEqual({ ...SECOND_COMPOSITION });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/mapping?provider=mapping-indexeddb&mapping=${created.id}`));
  });

  it("names a new Mapping and refuses an empty one", async () => {
    const workspace = harness();
    await workspace.controller.initialize();
    renderApp(workspace, vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "New mapping" }));
    const dialog = await screen.findByRole("dialog", { name: "Create mapping" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Untitled mapping");

    fireEvent.input(name, { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByText("Enter a mapping name.")).toBeInTheDocument();
    expect(workspace.records.size).toBe(0);

    fireEvent.input(name, { target: { value: "Guide Mapping" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect([...workspace.records.values()][0]!.document.name).toBe("Guide Mapping"));
  });

  it("duplicates from the row menu and opens the copy", async () => {
    const { workspace, navigate } = await library();

    fireEvent.click(screen.getByRole("button", { name: "More actions for Article Mapping" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => expect(workspace.records.size).toBe(2));
    const copy = [...workspace.records.values()].find((record) => record.id !== "mapping-1")!;
    expect(copy.document.name).toBe("Article Mapping copy");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/mapping?provider=mapping-indexeddb&mapping=${copy.id}`));
  });

  it("asks the alertdialog before a bulk delete", async () => {
    const { workspace } = await library([mappingRecord([], "mapping-1", "First"), mappingRecord([], "mapping-2", "Second")]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const confirm = await screen.findByRole("alertdialog", { name: "Delete 2 Mappings?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(workspace.records.size).toBe(0));
  });

  it("reports a deep link that could not be opened as a banner on the library", async () => {
    const workspace = harness([mappingRecord([])]);
    const navigate = vi.fn();
    renderApp(workspace, navigate, "?provider=mapping-indexeddb&mapping=missing-record");

    const banner = await screen.findByText(/was not found in provider/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mappings" })).toBeInTheDocument();

    // The library is still usable behind the notice.
    expect(screen.getByRole("link", { name: "Article Mapping" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/was not found in provider/)).toBeNull());
  });

  it("reports a malformed Mapping link without opening anything", async () => {
    const workspace = harness([mappingRecord([])]);
    renderApp(workspace, vi.fn(), "?provider=mapping-indexeddb&mapping=..%2Fmapping-1");

    expect(await screen.findByText("The Mapping record id is malformed.")).toBeInTheDocument();
    expect(workspace.controller.state.mapping).toBeNull();
  });

  it("opens the editor for a valid deep link", async () => {
    const workspace = harness([mappingRecord([READY_BINDING])]);
    renderApp(workspace, vi.fn(), "?provider=mapping-indexeddb&mapping=mapping-1");

    expect(await screen.findByRole("textbox", { name: "Mapping name" })).toHaveValue("Article Mapping");
    expect(screen.queryByRole("heading", { name: "Mappings" })).toBeNull();
  });
});
