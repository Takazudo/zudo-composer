import { fireEvent, render, screen, settle, settleTasks } from "../../../test/render";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import { activeComponentProvider } from "../../composer/active-pack";
import { MappingApp } from "../mapping-app";
import { INCOMPATIBLE_BINDING, READY_BINDING, mappingRecord, openedHarness } from "./harness";

describe("Mapping binding row menu", () => {
  // Every edit re-resolves the definition. A provider that reads its records
  // from disk returns equal but fresh field arrays, which must not rebuild the
  // bindings table under an open row menu.
  it("stays open while an edit's definition re-resolve lands", async () => {
    const workspace = await openedHarness(mappingRecord([READY_BINDING, INCOMPATIBLE_BINDING]));
    const resolveModel = workspace.content.resolveModel.bind(workspace.content);
    vi.spyOn(workspace.content, "resolveModel").mockImplementation(async (ref) => structuredClone(await resolveModel(ref)));
    render(<MappingApp provider={workspace.provider} contentCatalog={workspace.content} compositionCatalog={workspace.compositions} contentEntries={workspace.contentEntries} componentProvider={activeComponentProvider} controller={workspace.controller} location={{ pathname: "/mapping", search: "" }} navigate={vi.fn()} />);
    await settle();
    const fields = workspace.controller.state.definition?.contentModel?.document.fields;
    fireEvent.click(screen.getAllByRole("button", { name: /^Binding actions for / })[0]!);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    await settle();
    fireEvent.click(screen.getAllByRole("button", { name: /^Binding actions for / })[1]!);
    await settle();
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settleTasks();
    expect(workspace.controller.state.definition?.contentModel?.document.fields).not.toBe(fields);
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeInTheDocument();
  });
});
