import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { HostInspector } from "../inspector";
import type { HostDocumentTarget } from "../../../../server/host-document/types";
afterEach(cleanup);
const definition = { component: () => null, id: "section", schemaVersion: 1, title: "Section", description: "Section", category: "Test", source: { module: "test/components", exportName: "Section", exportKind: "named" }, defaults: { title: "Title", body: "Body", count: 1 }, fields: [{ kind: "text", prop: "title", label: "Heading" }, { prop: "body", label: "Body", schema: { type: "string" }, editor: { kind: "text", multiline: true } }, { kind: "number", prop: "count", label: "Count" }] } as const;
const component = defineComponentPack({ packId: "test", packVersion: "1", components: [definition] }).manifest.components[0]!;
const target: HostDocumentTarget = { renderedNodeId: "node", parentRenderedNodeId: null, slotId: null, componentId: "section", providerId: "files", recordId: "page", nodeId: "node", props: { title: "Original", body: "Body", count: 1 }, entries: [], capabilities: { fields: { allowed: true }, structure: { allowed: true }, placement: { allowed: false }, uses: ["/"], insertSlots: [] } };
it("uses typed fields and stages edits without mutation until explicit Save; preserves draft when preview becomes stale", () => {
  const onSave = vi.fn(async () => {}), onDirty = vi.fn();
  const view = render(<HostInspector target={target} component={component} disabled={false} onDirty={onDirty} onSave={onSave} />);
  expect(view.getByRole("textbox", { name: "Body" }).tagName).toBe("TEXTAREA");
  fireEvent.input(view.getByRole("textbox", { name: "Heading" }), { target: { value: "Draft title" } });
  expect(onSave).not.toHaveBeenCalled(); expect(onDirty).toHaveBeenCalledWith(true);
  expect((view.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).disabled).toBe(true);
  view.rerender(<HostInspector target={{ ...target, props: { ...target.props, title: "Remote title" } }} component={component} disabled={true} onDirty={onDirty} onSave={onSave} />);
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Draft title");
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<HostInspector target={target} component={component} disabled={false} onDirty={onDirty} onSave={onSave} />);
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "title", value: "Draft title" });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Original");
});
it("does not turn invalid numeric input into a saved previous value", () => {
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={target} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  fireEvent.input(view.getByRole("spinbutton", { name: "Count" }), { target: { value: "" } });
  expect(view.getByRole("alert").textContent).toContain("invalid numeric");
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});
it("exposes shared ownership reasons and refuses controls instead of shadowing bound props", () => {
  const shared = { ...target, capabilities: { ...target.capabilities!, fields: { allowed: false, reason: "Shared Content owns this value." }, structure: { allowed: false, reason: "Shared Mapping source." } } };
  const view = render(<HostInspector target={shared} component={component} disabled={false} onDirty={() => {}} onSave={vi.fn()} />);
  expect(view.getByRole("status").textContent).toContain("Shared Content");
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).disabled).toBe(true);
  expect((view.getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
});

it("uses declared enum and boolean controls and preserves omitted optional fields", () => {
  const schema = { ...component, fields: [
    { prop: "mode", label: "Mode", schema: { type: "string" as const, enum: ["quiet", "loud"] }, editor: { kind: "select" as const } },
    { prop: "enabled", label: "Enabled", schema: { type: "boolean" as const }, editor: { kind: "boolean" as const } },
    { prop: "optional", label: "Optional heading", schema: { type: "string" as const }, editor: { kind: "text" as const } },
  ] };
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={{ ...target, props: { mode: "quiet", enabled: false } }} component={schema} disabled={false} onDirty={() => {}} onSave={onSave} />);
  expect(view.getByText(/Optional heading: omitted/)).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Optional heading" })).toBeNull();
  fireEvent.change(view.getByRole("combobox", { name: "Mode" }), { target: { value: "loud" } });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "mode", value: "loud" });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  fireEvent.click(view.getByRole("checkbox", { name: "Enabled" }));
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "enabled", value: true });
});
