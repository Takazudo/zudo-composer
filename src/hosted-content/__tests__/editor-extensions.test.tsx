import { fireEvent, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { mountHostedContentEditor } from "../editor";
import { editorFixture, page } from "./editor-fixture";
import type { HostedContentEditorHandle, HostedFieldRenderContext, HostedFieldRenderer } from "../editor";

const handles: HostedContentEditorHandle[] = [];
afterEach(() => { handles.forEach((handle) => handle.dispose()); handles.length = 0; document.body.replaceChildren(); });
function mount(fixture: ReturnType<typeof editorFixture>, fieldRenderers?: HostedFieldRenderer[]) {
  const container = document.createElement("div"); document.body.append(container);
  let key = 0;
  const handle = mountHostedContentEditor(container, { transport: fixture.transport, policy: fixture.policy, selection: { entry: page, fieldId: "title" }, createOperationKey: () => `op${++key}`, fieldRenderers });
  handles.push(handle); return handle;
}
/** A host counter beside the built-in control: the default-renderer path. */
const counter = (seen: HostedFieldRenderContext[] = []): HostedFieldRenderer => ({
  matches: (field) => field.id === "title",
  mount(element, context) {
    seen.push(context);
    const control = document.createElement("div"), count = document.createElement("output");
    count.setAttribute("aria-label", "Title length");
    element.append(control, count);
    const builtIn = context.renderDefault(control);
    const show = (next: HostedFieldRenderContext) => { count.textContent = `${typeof next.value === "string" ? next.value.length : 0}/40`; };
    show(context);
    return { update(next) { seen.push(next); builtIn.update(next); show(next); }, destroy() { builtIn.destroy(); element.replaceChildren(); } };
  },
});

describe("hosted editor extension points", () => {
  it("lets a host control wrap the built-in control and save through the same command", async () => {
    const fixture = editorFixture(), seen: HostedFieldRenderContext[] = [];
    const handle = mount(fixture, [counter(seen)]); await handle.ready;
    const input = await screen.findByRole("textbox", { name: "講座名" });
    expect(screen.getByRole("status", { name: "Title length" })).toHaveTextContent("6/40");
    fireEvent.input(input, { target: { value: "新しい講座名です" } });
    await waitFor(() => expect(screen.getByRole("status", { name: "Title length" })).toHaveTextContent("8/40"));
    await handle.flush();
    expect(fixture.requests.at(-1)).toMatchObject({ kind: "set-fields", entry: page, values: { title: "新しい講座名です" } });
    // Unmatched fields keep the built-in control.
    expect(screen.getByRole("spinbutton", { name: "price" })).toBeInTheDocument();
    expect(Object.keys(seen[0]!).sort()).toEqual(["disabled", "entry", "field", "labels", "permission", "renderDefault", "setValue", "value"]);
  });

  it("validates a fully custom control's value on the server like any edit", async () => {
    const fixture = editorFixture();
    let current: HostedFieldRenderContext | undefined;
    const custom: HostedFieldRenderer = { matches: (field) => field.id === "price", mount(_element, context) { current = context; return { update(next) { current = next; }, destroy() { current = undefined; } }; } };
    const handle = mount(fixture, [custom]); await handle.ready;
    await waitFor(() => expect(current?.value).toBe(9));
    current!.setValue("not a number");
    await expect(handle.flush()).rejects.toMatchObject({ code: "invalid-value" });
    expect((await fixture.service.readEntry(fixture.actor, { perspective: "working", entry: page })).values.price).toBe(9);
  });

  it("restores an exact revision through the handle as a new working revision", async () => {
    const fixture = editorFixture();
    const handle = mount(fixture); await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "変更後" } });
    await handle.flush();
    const [latest, original] = (await fixture.service.listRevisions(fixture.actor, { entry: page })).revisions;
    expect([latest!.values.title, original!.operation.kind]).toEqual(["変更後", "initial"]);
    await handle.restore(page, original!.id);
    expect(fixture.requests.at(-1)).toMatchObject({ kind: "restore-revision", entry: page, revisionId: original!.id });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "講座名" })).toHaveValue("日本語の講座"));
    const history = (await fixture.service.listRevisions(fixture.actor, { entry: page })).revisions;
    expect(history.map((revision) => [revision.sequence, revision.restoredFrom ?? null])).toEqual([[3, original!.id], [2, null], [1, null]]);
    expect(handle.state.pending).toBeNull();
  });

  it("leaves no stuck operation when a restore is refused with diagnostics", async () => {
    const fixture = editorFixture();
    const handle = mount(fixture); await handle.ready;
    const state = await fixture.service.readState(fixture.actor);
    // A collection change records the owner's history; its membership can only change through the collection.
    await fixture.service.execute(fixture.actor, { kind: "add-entry", operationKey: "add", expected: { draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition }, collectionId: "questions", entry: { providerId: "content", modelId: "faq", recordId: "faq-detached" }, before: null });
    await handle.refresh();
    const original = (await fixture.service.listRevisions(fixture.actor, { entry: page })).revisions.at(-1)!;
    await expect(handle.restore(page, original.id)).rejects.toMatchObject({ code: "restore-incompatible", restoreDiagnostics: [{ fieldId: "questions", code: "collection-owned" }] });
    expect(handle.state.pending).toBeNull();
    await handle.refresh();
    expect(handle.state.phase).toBe("clean");
  });
});
