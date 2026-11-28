import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, settle } from "../../../test/render";
import { expect, it, vi } from "vitest";
import { defineComponentPack } from "@zudo-composer/component-contract";
import { HostInspector } from "../inspector";
import type { HostDocumentTarget } from "../../../../server/host-document/types";
const definition = { component: () => null, id: "section", schemaVersion: 1, title: "Section", description: "Section", category: "Test", source: { module: "test/components", exportName: "Section", exportKind: "named" }, defaults: { title: "Title", body: "Body", count: 1 }, fields: [{ kind: "text", prop: "title", label: "Heading" }, { prop: "body", label: "Body", schema: { type: "string" }, editor: { kind: "text", multiline: true } }, { kind: "number", prop: "count", label: "Count" }] } as const;
const component = defineComponentPack({ packId: "test", packVersion: "1", components: [definition] }).manifest.components[0]!;
const target: HostDocumentTarget = { renderedNodeId: "node", parentRenderedNodeId: null, slotId: null, componentId: "section", providerId: "files", recordId: "page", nodeId: "node", props: { title: "Original", body: "Body", count: 1 }, entries: [], capabilities: { fields: { allowed: true }, structure: { allowed: true }, placement: { allowed: false }, uses: ["/"], insertSlots: [] } };
it("uses typed fields and stages edits without mutation until explicit Save; preserves draft when preview becomes stale", async () => {
  const onSave = vi.fn(async () => {}), onDirty = vi.fn();
  const current = signal(target), disabled = signal(false);
  const view = render(<HostInspector target={current} component={component} disabled={disabled} onDirty={onDirty} onSave={onSave} />);
  expect(view.getByRole("textbox", { name: "Body" }).tagName).toBe("TEXTAREA");
  fireEvent.input(view.getByRole("textbox", { name: "Heading" }), { target: { value: "Draft title" } });
  await settle();
  expect(onSave).not.toHaveBeenCalled(); expect(onDirty).toHaveBeenCalledWith(true);
  expect((view.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).disabled).toBe(true);
  current.value = { ...target, props: { ...target.props, title: "Remote title" } }; disabled.value = true; await settle();
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Draft title");
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  current.value = target; disabled.value = false; await settle();
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "title", value: "Draft title" });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  await settle();
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Original");
});
it("does not turn invalid numeric input into a saved previous value", async () => {
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={target} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  fireEvent.input(view.getByRole("spinbutton", { name: "Count" }), { target: { value: "" } });
  await settle();
  expect(view.getByRole("alert").textContent).toContain("invalid numeric");
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
});
it("exposes shared ownership reasons and refuses controls instead of shadowing bound props", async () => {
  const shared = { ...target, capabilities: { ...target.capabilities!, fields: { allowed: false, reason: "Shared Content owns this value." }, structure: { allowed: false, reason: "Shared Mapping source." } } };
  const view = render(<HostInspector target={shared} component={component} disabled={false} onDirty={() => {}} onSave={vi.fn()} />);
  expect(view.getByRole("status").textContent).toContain("Shared Content");
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).disabled).toBe(true);
  expect((view.getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
});

it("uses declared enum and boolean controls and preserves omitted optional fields", async () => {
  const schema = { ...component, fields: [
    { prop: "mode", label: "Mode", schema: { type: "string" as const, enum: ["quiet", "loud"] as const }, editor: { kind: "select" as const } },
    { prop: "enabled", label: "Enabled", schema: { type: "boolean" as const }, editor: { kind: "boolean" as const } },
    { prop: "optional", label: "Optional heading", schema: { type: "string" as const }, editor: { kind: "text" as const } },
  ] };
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={{ ...target, props: { mode: "quiet", enabled: false } }} component={schema} disabled={false} onDirty={() => {}} onSave={onSave} />);
  expect(view.getByText(/Optional heading: omitted/)).toBeTruthy();
  expect(view.queryByRole("textbox", { name: "Optional heading" })).toBeNull();
  fireEvent.change(view.getByRole("combobox", { name: "Mode" }), { target: { value: "loud" } });
  await settle();
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "mode", value: "loud" });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  await settle();
  fireEvent.click(view.getByRole("checkbox", { name: "Enabled" }));
  await settle();
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "enabled", value: true });
});

it("saves the typed multiline value when draft observers render before the input event finishes", async () => {
  const onSave = vi.fn(async () => {});
  const notifications = signal(0);
  const view = render(<div data-draft-notifications={notifications}><HostInspector target={{ ...target, props: { ...target.props, body: "" } }} component={component} disabled={false} onDirty={() => { notifications.value += 1; }} onSave={onSave} /></div>);
  const textarea = view.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
  textarea.focus();
  fireEvent.input(textarea, { target: { value: "Typed multiline proof\nSecond line" } });
  await settle();
  expect(onSave).not.toHaveBeenCalled();
  expect(view.getByRole("textbox", { name: "Body" })).toBe(textarea);
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe("Typed multiline proof\nSecond line");
  fireEvent.blur(textarea);
  await settle();
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "body", value: "Typed multiline proof\nSecond line" });
});


it("accepts schema-valid decimals with no step and retains explicit step constraints", async () => {
  const onSave = vi.fn(async () => {});
  const view = render(<HostInspector target={target} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  const number = view.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement;
  number.focus();
  fireEvent.input(number, { target: { value: "1.25" } });
  await settle();
  expect(number.validity.valid).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  expect((view.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "field", prop: "count", value: 1.25 });
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  await settle();
  const constrained = { ...component, fields: [{ prop: "count", label: "Count", schema: { type: "number" as const, step: 0.5 }, editor: { kind: "number" as const } }] };
  view.unmount();
  const constrainedView = render(<HostInspector target={target} component={constrained} disabled={false} onDirty={() => {}} onSave={onSave} />);
  const stepped = constrainedView.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement;
  stepped.focus();
  fireEvent.input(stepped, { target: { value: "1.25" } });
  await settle();
  expect(stepped.validity.stepMismatch).toBe(true);
  expect((constrainedView.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.input(stepped, { target: { value: "1.5" } });
  await settle();
  expect(stepped.validity.valid).toBe(true);
  fireEvent.click(constrainedView.getByRole("button", { name: "Save field" }));
  await settle();
  expect(onSave).toHaveBeenLastCalledWith({ kind: "field", prop: "count", value: 1.5 });
});
it("removes only a server-qualified local child and keeps dirty drafts protected", async () => {
  const eligible: HostDocumentTarget = { ...target, capabilities: { ...target.capabilities!, remove: { allowed: true } } };
  const current = signal(eligible);
  const onSave = vi.fn(async () => {}), view = render(<HostInspector target={current} component={component} disabled={false} onDirty={() => {}} onSave={onSave} />);
  fireEvent.input(view.getByRole("textbox", { name: "Heading" }), { target: { value: "Unsaved" } });
  await settle();
  expect((view.getByRole("button", { name: "Remove component" }) as HTMLButtonElement).disabled).toBe(true);
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  await settle();
  fireEvent.click(view.getByRole("button", { name: "Remove component" }));
  await settle();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "remove" });
  current.value = { ...eligible, capabilities: { ...eligible.capabilities!, remove: { allowed: false, reason: "Root components cannot be removed here." } } }; await settle();
  expect((view.getByRole("button", { name: "Remove component" }) as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByText("Root components cannot be removed here.")).toBeTruthy();
});

it("shows field-specific shared source uses separately from local capabilities and hides stale source actions", async () => {
  const shared: HostDocumentTarget = { ...target, fieldSources: [{ prop: "title", label: "Heading", sources: [{ entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, fieldId: "course-price", fieldLabel: "Price", affectedUses: [{ pathname: "/", renderedNodeId: "home-price", prop: "price" }, { pathname: "/lessons", renderedNodeId: "price", prop: "title" }] }] }], capabilities: { ...target.capabilities!, fields: { allowed: false, reason: "Shared Mapping source." }, uses: ["/lessons"] } };
  const onSave = vi.fn(async () => {});
  const disabled = signal(false);
  const view = render(<HostInspector target={shared} component={component} disabled={disabled} onDirty={() => {}} onSave={onSave} />);
  expect(view.getByRole("region", { name: "Heading source" }).textContent).toContain("content-filesystem/course/consultation/course-price");
  expect(view.getByText("/")).toBeTruthy(); expect(view.getByText("/lessons")).toBeTruthy();
  expect(view.getByRole("link", { name: "Open Price source" }).getAttribute("href")).toBe("/content?provider=content-filesystem&model=course&entry=consultation");
  expect(onSave).not.toHaveBeenCalled();
  disabled.value = true; await settle();
  expect(view.queryByRole("link", { name: "Open Price source" })).toBeNull();
  expect(view.getByText("/")).toBeTruthy();
});

it("withholds shared source navigation while a different local field has an unsaved draft", async () => {
  const mixed: HostDocumentTarget = { ...target, fieldSources: [{ prop: "body", label: "Body", sources: [{ entry: { providerId: "content-filesystem", modelId: "course", recordId: "consultation" }, fieldId: "course-price", fieldLabel: "Price", affectedUses: [] }] }] };
  const view = render(<HostInspector target={mixed} component={component} disabled={false} onDirty={() => {}} onSave={async () => {}} />);
  expect(view.getByRole("link", { name: "Open Price source" })).toBeTruthy();
  fireEvent.input(view.getByRole("textbox", { name: "Heading" }), { target: { value: "Pending local title" } });
  await settle();
  expect(view.queryByRole("link", { name: "Open Price source" })).toBeNull();
  expect((view.getByRole("textbox", { name: "Heading" }) as HTMLInputElement).value).toBe("Pending local title");
  fireEvent.click(view.getByRole("button", { name: "Discard local draft" }));
  await settle();
  expect(view.getByRole("link", { name: "Open Price source" })).toBeTruthy();
});
