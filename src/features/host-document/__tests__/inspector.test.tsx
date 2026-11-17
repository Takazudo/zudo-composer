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
    { prop: "mode", label: "Mode", schema: { type: "string" as const, enum: ["quiet", "loud"] as const }, editor: { kind: "select" as const } },
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

it("saves the typed multiline value when draft observers render before the input event finishes", async () => {
  const { useState } = await import("preact/hooks");
  const { flushSync } = await import("preact/compat");
  const onSave = vi.fn(async () => {});
  function ObservedInspector() {
    const [notifications, setNotifications] = useState(0);
    return <div data-draft-notifications={notifications}><HostInspector target={{ ...target, props: { ...target.props, body: "" } }} component={component} disabled={false} onDirty={() => flushSync(() => setNotifications(value => value + 1))} onSave={onSave} /></div>;
  }
  const view = render(<ObservedInspector />);
  const textarea = view.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
  textarea.focus();
  fireEvent.input(textarea, { target: { value: "Typed multiline proof\nSecond line" } });
  expect(onSave).not.toHaveBeenCalled();
  expect(view.getByRole("textbox", { name: "Body" })).toBe(textarea);
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe("Typed multiline proof\nSecond line");
  fireEvent.blur(textarea);
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "body", value: "Typed multiline proof\nSecond line" });
});


it("accepts schema-valid decimals with no step and retains explicit step constraints", () => {
  const onSave = vi.fn(async () => {});
  const view = render(<HostInspector target={target} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  const number = view.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement;
  number.focus();
  fireEvent.input(number, { target: { value: "1.25" } });
  expect(number.validity.valid).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "count", value: 1.25 });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  const constrained = { ...component, fields: [{ prop: "count", label: "Count", schema: { type: "number" as const, step: 0.5 }, editor: { kind: "number" as const } }] };
  view.rerender(<HostInspector target={target} component={constrained} disabled={false} onDirty={() => {}} onSave={onSave} />);
  const stepped = view.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement;
  stepped.focus();
  fireEvent.input(stepped, { target: { value: "1.25" } });
  expect(stepped.validity.stepMismatch).toBe(true);
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.input(stepped, { target: { value: "1.5" } });
  expect(stepped.validity.valid).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "count", value: 1.5 });
});
it("removes only a server-qualified local child and keeps dirty drafts protected", () => {
  const eligible = { ...target, capabilities: { ...target.capabilities!, remove: { allowed: true } } };
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={eligible} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  fireEvent.input(view.getByRole("textbox", { name: "Heading" }), { target: { value: "Unsaved" } });
  expect((view.getByRole("button", { name: "Remove component" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  fireEvent.click(view.getByRole("button", { name: "Remove component" }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "remove" });
  view.rerender(<HostInspector target={{ ...eligible, capabilities: { ...eligible.capabilities, remove: { allowed: false, reason: "Root components cannot be removed here." } } }} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  expect((view.getByRole("button", { name: "Remove component" }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText("Root components cannot be removed here.")).toBeTruthy();
});

it("shows field-specific shared source uses separately from local capabilities and hides stale source actions", () => {
  const shared: HostDocumentTarget = { ...target, fieldSources: [{ prop: "title", label: "Heading", sources: [{ entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, fieldId: "course-price", fieldLabel: "Price", affectedUses: [{ pathname: "/", renderedNodeId: "home-price", prop: "price" }, { pathname: "/lessons", renderedNodeId: "price", prop: "title" }] }] }], capabilities: { ...target.capabilities!, fields: { allowed: false, reason: "Shared Mapping source." }, uses: ["/lessons"] } };
  const onSave = vi.fn(async () => {});
  const view = render(<HostInspector target={shared} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  expect(view.getByRole("region", { name: "Heading source" }).textContent).toContain("content-filesystem/course/consultation/course-price");
  expect(view.getByText("/")).toBeTruthy(); expect(view.getByText("/lessons")).toBeTruthy();
  expect(view.getByRole("link", { name: "Open Price source" }).getAttribute("href")).toBe("/content?provider=content-filesystem&model=course&entry=consultation");
  expect(onSave).not.toHaveBeenCalled();
  view.rerender(<HostInspector target={shared} component={component} disabled={true} onDirty={() => {}} onSave={onSave} />);
  expect(view.queryByRole("link", { name: "Open Price source" })).toBeNull();
  expect(view.getByText("/")).toBeTruthy();
});
