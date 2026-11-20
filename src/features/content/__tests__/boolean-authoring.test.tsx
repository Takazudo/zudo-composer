import { Field } from "../../../components/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "preact/hooks";
import { createContentModelRecord, diagnoseContentEntryCompleteness, type ContentFieldDefinition } from "../../../content";
import { ContentEntryAuthor } from "../content-author";
import { ContentScalarControl } from "../scalar-control";
import { createContentAuthoringController, type ContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Harness({ controller }: { controller: ContentAuthoringController }) {
  const [state, setState] = useState(controller.state);
  useEffect(() => controller.subscribe(setState), [controller]);
  return <ContentEntryAuthor state={state} controller={controller} run={action => void action()} />;
}
describe("explicit Content boolean values", () => {
  it("keeps inherited field help and error alongside the unset description", () => {
    const onChange = vi.fn();
    const content = (value: boolean | undefined) => <Field label="Featured" help="Shown on Home" error="Choose a value"><ContentScalarControl schema={{ kind: "boolean" }} value={value} label="Featured" onChange={onChange} /></Field>;
    const view = render(content(undefined));
    expect(screen.getByRole("switch", { name: "Featured" })).toHaveAccessibleDescription("Shown on Home Choose a value Not set");
    fireEvent.click(screen.getByRole("button", { name: "Set Featured to No" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
    view.rerender(content(false));
    expect(screen.getByRole("switch", { name: "Featured" })).toHaveAccessibleDescription("Shown on Home Choose a value");
  });

  for (const nested of [false, true]) it(`saves missing required boolean directly as false and reloads (${nested ? "nested" : "top-level"})`, async () => {
    const booleans: ContentFieldDefinition[] = [
      { id: "featured", key: "featured", label: "Featured", kind: "boolean", required: true },
      { id: "optional", key: "optional", label: "Optional", kind: "boolean", required: false },
    ];
    const model = createContentModelRecord({ name: "Courses", kind: "collection", fields: nested ? [{ id: "settings", key: "settings", label: "Settings", kind: "object", required: true, fields: booleans }] : booleans }, { id: "courses" });
    const provider = createMemoryContentProvider({ models: [model], entries: [] });
    const controller = createContentAuthoringController(provider);
    await controller.initialize(); await controller.openModel(model.id); await controller.createEntry();
    const id = controller.state.entry!.id;
    const put = vi.spyOn(provider.store, "putEntry");
    render(<Harness controller={controller} />);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Featured" })).toHaveAccessibleDescription("Not set");
    await controller.flushSessions(); expect(put).not.toHaveBeenCalled();
    expect(controller.state.entry!.values).toEqual({});
    fireEvent.click(screen.getByRole("button", { name: "Set Featured to No" }));
    await controller.flushSessions();
    expect(put).toHaveBeenCalledTimes(1);
    const expected = nested ? { settings: { featured: false } } : { featured: false };
    expect(put.mock.calls[0][0].values).toEqual(expected);
    expect(diagnoseContentEntryCompleteness(model, controller.state.entry!)).toEqual([]);
    cleanup();
    const reopened = createContentAuthoringController(provider);
    await reopened.initialize(); await reopened.openModel(model.id); await reopened.openEntry(id);
    render(<Harness controller={reopened} />);
    expect(reopened.state.entry!.values).toEqual(expected);
    expect(screen.getByRole("switch", { name: "Featured" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Set Featured to No" })).toBeNull();
    expect(screen.getByRole("button", { name: "Set Optional to No" })).toBeVisible();
    await reopened.flushSessions(); expect(put).toHaveBeenCalledTimes(1);
  });

  it("preserves known true/false toggles and disabled unset controls without mount writes", async () => {
    const onChange = vi.fn();
    const view = render(<ContentScalarControl schema={{ kind: "boolean" }} value={false} label="Featured" onChange={onChange} />);
    expect(screen.queryByText("Not set")).toBeNull(); expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Featured" })); expect(onChange).toHaveBeenLastCalledWith(true);
    view.rerender(<ContentScalarControl schema={{ kind: "boolean" }} value={true} label="Featured" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Featured" })); expect(onChange).toHaveBeenLastCalledWith(false);
    onChange.mockClear();
    view.rerender(<ContentScalarControl schema={{ kind: "boolean" }} value={undefined} label="Featured" disabled onChange={onChange} />);
    expect(screen.getByRole("switch", { name: "Featured" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set Featured to No" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set Featured to No" }));
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });
});
