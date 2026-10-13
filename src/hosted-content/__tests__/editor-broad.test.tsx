import { EditorView } from "@codemirror/view";
import { fireEvent, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountHostedContentEditor } from "../editor";
import type { HostedContentEditorHandle, HostedContentEditorOptions } from "../editor";
import type { HostedRecoveryCheckpoint } from "../session";
import { editorFixture, page } from "./editor-fixture";
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON() {} }) });
});
const handles: HostedContentEditorHandle[] = [];
afterEach(() => { handles.forEach((handle) => handle.dispose()); handles.length = 0; document.body.replaceChildren(); });
function mount(fixture: ReturnType<typeof editorFixture>, extra: Partial<HostedContentEditorOptions> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  let key = 0; const handle = mountHostedContentEditor(container, { transport: fixture.transport, policy: fixture.policy, selection: { entry: page, fieldId: "title" }, createOperationKey: () => `editor-${handles.length}-${++key}`, ...extra });
  handles.push(handle); return { handle, container };
}
const input = async (name: string, value: string) => fireEvent.input(await screen.findByRole("textbox", { name }), { target: { value } });
const values = (fixture: ReturnType<typeof editorFixture>) => fixture.database().state.providers[0]!.entries.find((entry) => entry.id === "home")!.values;
describe("hosted permitted record controls", () => {
  it("uses real scalar controls, saves Japanese/zero/false and keeps protected metadata", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    await input("講座名", "日本語をそのまま保存");
    fireEvent.input(screen.getByRole("spinbutton", { name: "price" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("switch", { name: "enabled" })); await handle.flush();
    expect(values(fixture)).toMatchObject({ title: "日本語をそのまま保存", price: 0, enabled: false, slug: "fixed-route" });
    expect(fixture.database().state.providers[0]!.entries[0]!.lifecycle).toBe("published");
    expect(screen.queryByRole("textbox", { name: "slug" })).toBeNull();
    expect(screen.getByLabelText("date")).toHaveAttribute("type", "date"); expect(screen.getByLabelText("url")).toHaveAttribute("type", "url"); expect(screen.getByLabelText("color")).toHaveAttribute("type", "color");
    fireEvent.change(screen.getByRole("combobox", { name: "choice" }), { target: { value: "next" } }); await handle.flush(); expect(values(fixture).choice).toBe("next");
  });
  it("retains incomplete non-clearable number input and blocks flush until a negative decimal is complete", async () => {
    const fixture = editorFixture(); fixture.policy.models[0]!.fields.find((permission) => permission.fieldId === "price")!.clear = false;
    const { handle } = mount(fixture, { preview: { render: async () => undefined }, routeId: "home" }); await handle.ready;
    const number = screen.getByRole("spinbutton", { name: "price" });
    fireEvent.input(number, { target: { value: "" } });
    await waitFor(() => expect(number).toHaveValue(null)); expect(handle.state.dirty).toBe(true); expect(handle.state.reviewedSnapshot).toBeNull();
    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(handle.flush()).rejects.toThrow("incomplete number"); await expect(handle.preview()).rejects.toThrow("incomplete number");
    await expect(handle.navigate({ entry: { providerId: "content", modelId: "faq", recordId: "faq-a" }, fieldId: "question" })).rejects.toThrow("incomplete number");
    expect(values(fixture).price).toBe(9);
    fireEvent.input(number, { target: { value: "-1.25" } }); await handle.flush(); expect(values(fixture).price).toBe(-1.25); expect(handle.state.dirty).toBe(false);
  });
  it("supports clear-only scalar and nested permissions without granting replacement controls", async () => {
    const fixture = editorFixture(); fixture.policy.models[0]!.fields.find((permission) => permission.fieldId === "title")!.replace = false;
    fixture.policy.models[0]!.fields.find((permission) => permission.fieldId === "details")!.children![0]!.replace = false;
    const { handle } = mount(fixture); await handle.ready;
    expect(screen.queryByRole("textbox", { name: "講座名" })).toBeNull(); expect(screen.getByLabelText("講座名")).toHaveTextContent("日本語の講座");
    expect(screen.queryByRole("textbox", { name: "details: label" })).toBeNull(); expect(screen.getByLabelText("details: label")).toHaveTextContent("Visible");
    expect(screen.queryByRole("button", { name: "Clear: details", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear: details: label" })); fireEvent.click(screen.getByRole("button", { name: "Clear: 講座名" })); await handle.flush();
    expect(values(fixture)).not.toHaveProperty("title"); expect(values(fixture).details).toEqual({ secret: "Locked" }); expect(values(fixture).slug).toBe("fixed-route");
  });
  it("blocks nested object clearing while a numeric descendant is incomplete, then clears without orphan markers", async () => {
    const fixture = editorFixture({ nestedNumeric: true }); const { handle } = mount(fixture); await handle.ready;
    const number = screen.getByRole("spinbutton", { name: "details: nested: number" });
    Object.defineProperty(number, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.input(number, { target: { value: "" } });
    const clear = screen.getByRole("button", { name: "Clear: details: nested", exact: true });
    expect(clear).toBeDisabled(); fireEvent.click(clear); expect(handle.state.content!.providers[0]!.entries.find((entry) => entry.id === "home")!.values.details).toMatchObject({ nested: { number: 9 }, secret: "Locked" }); expect(values(fixture).details).toMatchObject({ nested: { number: 9 }, secret: "Locked" });
    await expect(handle.flush()).rejects.toThrow("incomplete number"); expect(handle.state.invalidInputs).toHaveLength(1);
    Object.defineProperty(number, "validity", { configurable: true, value: { badInput: false } });
    fireEvent.input(number, { target: { value: "0" } }); expect(clear).not.toBeDisabled();
    fireEvent.click(clear); await handle.flush(); expect(values(fixture).details).toEqual({ label: "Visible", secret: "Locked" });
    expect(handle.state.invalidInputs).toEqual([]); expect(handle.state.dirty).toBe(false);
  });
  it("blocks numeric list shape actions during incomplete input and leaves no orphan marker after correction", async () => {
    const fixture = editorFixture({ numericResults: true }); const { handle } = mount(fixture); await handle.ready;
    const number = screen.getByRole("spinbutton", { name: "results: Item 2" }); fireEvent.input(number, { target: { value: "" } });
    expect(number).toHaveAttribute("aria-invalid", "true"); expect(handle.state.dirty).toBe(true); await expect(handle.flush()).rejects.toThrow("incomplete number"); expect(values(fixture).results).toEqual([9, 5]);
    expect(screen.getByRole("button", { name: "Remove item: results 1" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Remove item: results 2" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Move up: results 2" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Add item: results" })).toBeDisabled();
    fireEvent.input(number, { target: { value: "-2.5" } }); await handle.flush(); expect(values(fixture).results).toEqual([9, -2.5]); expect(handle.state.invalidInputs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove item: results 2" })); await handle.flush(); expect(values(fixture).results).toEqual([9]); expect(handle.state.dirty).toBe(false);
  });
  it("distinguishes an empty replacement from a clear and keeps incomplete drafts savable", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture, { preview: { render: async () => undefined }, routeId: "home" }); await handle.ready;
    await input("講座名", ""); await handle.flush(); expect(values(fixture).title).toBe("");
    expect(fixture.requests.at(-1)).toMatchObject({ values: { title: "" }, clear: [] });
    fireEvent.click(screen.getByRole("button", { name: "Clear: summary" })); await handle.flush(); expect(values(fixture)).not.toHaveProperty("summary");
    expect(fixture.requests.at(-1)).toMatchObject({ values: {}, clear: ["summary"] });
    await handle.preview(); expect(handle.state.reviewedSnapshot!.diagnostics.some((diagnostic) => diagnostic.fieldId === "title")).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled()); await expect(handle.submit()).rejects.toThrow("complete");
  });
  it("changes only permitted nested leaves and enforces list cardinality independently of text length", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    await input("details: label", "変えた表示"); await input("rows: Item 1: label", "Changed row");
    expect(screen.queryByRole("textbox", { name: /secret/ })).toBeNull(); expect(screen.queryByRole("button", { name: "Add item: rows" })).toBeNull();
    const result = screen.getByRole("textbox", { name: "results: Item 1" }); expect(result).not.toHaveAttribute("maxlength", "3");
    fireEvent.input(result, { target: { value: "A long permitted item with more than three characters" } }); await handle.flush();
    expect(values(fixture)).toMatchObject({ details: { label: "変えた表示", secret: "Locked" }, rows: [{ label: "Changed row", secret: "protected" }], results: ["A long permitted item with more than three characters"] });
    fireEvent.click(screen.getByRole("button", { name: "Add item: results" })); await screen.findByRole("textbox", { name: "results: Item 2" });
    fireEvent.click(screen.getByRole("button", { name: "Add item: results" })); await screen.findByRole("textbox", { name: "results: Item 3" });
    expect(screen.getByRole("button", { name: "Add item: results" })).toBeDisabled(); await handle.flush(); expect(values(fixture).results).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Move down: results 1" })); await handle.flush(); expect((values(fixture).results as string[])[1]).toContain("long permitted");
    fireEvent.click(screen.getByRole("button", { name: "Remove item: results 2" })); await handle.flush(); expect(values(fixture).results).toHaveLength(2);
  });
  it("selects only approved assets and edits only allowed descriptive properties", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    const select = screen.getByRole("combobox", { name: "image: Approved asset" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["None", "first", "second"]);
    fireEvent.change(select, { target: { value: JSON.stringify(["assets", "asset", "second"]) } });
    await input("image: Alternative text", "承認された画像の説明"); await input("image: Caption", "日本語のキャプション"); await handle.flush();
    expect(values(fixture).image).toMatchObject({ kind: "image", asset: { providerId: "assets", assetId: "second" }, alt: "承認された画像の説明", caption: "日本語のキャプション", decorative: false });
    expect(screen.queryByRole("switch", { name: /Decorative/ })).toBeNull(); expect(screen.queryByRole("link")).toBeNull(); expect(screen.queryByRole("button", { name: /upload|open in assets/i })).toBeNull();
  });
  it("mounts the extracted CodeMirror source editor without evaluating content", async () => {
    const fixture = editorFixture(); const { handle, container } = mount(fixture); await handle.ready;
    const content = await screen.findByRole("textbox", { name: "notes" }); expect(content).toHaveAttribute("contenteditable", "true");
    const dom = container.querySelector<HTMLElement>(".cm-editor")!; const view = EditorView.findFromDOM(dom)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "**日本語**\n[詳細](https://example.com)" } }); await handle.flush();
    view.focus(); expect(document.activeElement).toBe(view.contentDOM);
    await handle.flush(); expect(document.activeElement).toBe(view.contentDOM);
    expect(values(fixture).notes).toBe("**日本語**\n[詳細](https://example.com)"); expect(container.querySelector(".sg-content-markdown-preview")).toBeNull();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<script>globalThis.executed=true</script>" } }); await expect(handle.flush()).rejects.toMatchObject({ code: "invalid-value" });
    expect(view.state.doc.toString()).toContain("<script>"); expect(container.querySelector("script")).toBeNull(); expect(values(fixture).notes).not.toContain("script");
    const destroy = vi.spyOn(view, "destroy"); handle.dispose(); expect(destroy).toHaveBeenCalledOnce(); expect(container.querySelector(".cm-editor")).toBeNull(); destroy.mockRestore();
  });
  it("gives Markdown labels document-unique ids across separately mounted editors", async () => {
    const first = mount(editorFixture()); const second = mount(editorFixture()); await first.handle.ready; await second.handle.ready;
    await waitFor(() => expect(document.querySelectorAll(".cm-content")).toHaveLength(2));
    const ids = [first.container, second.container].map((container) => container.querySelector(".cm-content")!.getAttribute("aria-labelledby")!);
    expect(new Set(ids).size).toBe(2); ids.forEach((id) => expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1));
  });
  it("creates with server IDs, navigates new members, adds existing entries and preserves reorder membership", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    fireEvent.click(screen.getByRole("button", { name: "Create item: questions" })); await input("question", "新しい質問"); await input("answer", "新しい回答");
    fireEvent.click(screen.getByRole("button", { name: "Create item", exact: true }));
    await waitFor(() => expect(fixture.database().state.providers[0]!.entries.some((entry) => entry.id === "server-1")).toBe(true));
    await screen.findByRole("textbox", { name: "question" }); await input("question", "作成後の編集"); await handle.flush();
    expect(fixture.database().state.providers[0]!.entries.find((entry) => entry.id === "server-1")!.values.question).toBe("作成後の編集");
    expect(fixture.policy.models[1]!.entryIds).not.toContain("server-1");
    await handle.navigate({ entry: page, fieldId: "title" }); await screen.findByRole("textbox", { name: "講座名" });
    fireEvent.change(screen.getByRole("combobox", { name: "Add existing item: questions" }), { target: { value: "faq-detached" } }); fireEvent.click(screen.getByRole("button", { name: "Add existing item", exact: true }));
    await waitFor(() => expect(values(fixture).questions).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Move up: Detached question" }));
    await waitFor(() => expect((values(fixture).questions as unknown as { recordId: string }[]).map((ref) => ref.recordId)).toEqual(["faq-a", "faq-detached", "server-1"]));
    expect(screen.queryByRole("button", { name: /remove.*question/i })).toBeNull(); expect(screen.queryByText("Private question")).toBeNull();
  });
  it("retains a staged creation on disposal/reopen and prevents navigation from discarding it", async () => {
    const fixture = editorFixture(); let checkpoint!: HostedRecoveryCheckpoint;
    const first = mount(fixture, { persistRecovery: (saved) => { checkpoint = saved; } }); await first.handle.ready;
    fireEvent.click(screen.getByRole("button", { name: "Create item: questions" })); await input("question", "保存前の質問");
    await waitFor(() => expect(checkpoint.creationDraft?.values.question).toBe("保存前の質問"));
    await expect(first.handle.navigate({ entry: { providerId: "content", modelId: "faq", recordId: "faq-a" }, fieldId: "question" })).rejects.toThrow("Save or cancel");
    first.handle.dispose(); const reopened = mount(fixture, { recovery: checkpoint }); await reopened.handle.ready;
    expect(await screen.findByRole("textbox", { name: "question" })).toHaveValue("保存前の質問");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await waitFor(() => expect(reopened.handle.state.dirty).toBe(false)); expect(fixture.database().state.providers[0]!.entries).toHaveLength(4);
  });
  it("recovers the original creation after a lost response and saves newer B on the same server ID", async () => {
    const fixture = editorFixture(); const execute = fixture.transport.execute; let checkpoint!: HostedRecoveryCheckpoint;
    let release!: () => void; const gate = new Promise<void>((ready) => { release = ready; }); let lose = true;
    fixture.transport.execute = async (request) => { const result = await execute(request); if (request.kind === "create-entry" && lose) { lose = false; await gate; throw new Error("lost creation response"); } return result; };
    const first = mount(fixture, { persistRecovery: (saved) => { checkpoint = saved; } }); await first.handle.ready;
    fireEvent.click(screen.getByRole("button", { name: "Create item: questions" })); await input("question", "質問A"); fireEvent.click(screen.getByRole("button", { name: "Create item", exact: true }));
    await waitFor(() => expect(fixture.database().state.providers[0]!.entries.some((entry) => entry.id === "server-1")).toBe(true));
    await input("question", "質問B"); release(); await waitFor(() => expect(first.handle.state.phase).toBe("recovering"));
    await waitFor(() => expect(checkpoint.creationDraft?.values.question).toBe("質問B"));
    const original = checkpoint.pending!.request; first.handle.dispose();
    const reopened = mount(fixture, { recovery: checkpoint }); await reopened.handle.ready;
    expect(screen.getByRole("button", { name: "Create item", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); await waitFor(() => expect(reopened.handle.state.pending).toBeNull());
    await waitFor(() => expect(reopened.handle.state.dirty).toBe(false));
    const creates = fixture.requests.filter((request) => request.kind === "create-entry"); expect(creates).toHaveLength(2); expect(creates[0]).toEqual(original); expect(creates[1]).toEqual(original);
    expect(fixture.database().state.providers[0]!.entries.filter((entry) => entry.id.startsWith("server-"))).toHaveLength(1);
    expect(fixture.database().state.providers[0]!.entries.find((entry) => entry.id === "server-1")!.values.question).toBe("質問B");
    fireEvent.click(screen.getByRole("button", { name: "Edit: 質問B" })); expect(await screen.findByRole("textbox", { name: "question" })).toHaveValue("質問B");
  });
  it("keeps a rejected creation dirty after explicit review/reapply and only then creates afresh", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    fireEvent.click(screen.getByRole("button", { name: "Create item: questions" })); await input("question", "Retained question");
    const state = await fixture.service.readState(fixture.actor); await fixture.service.execute(fixture.actor, { kind: "set-fields", operationKey: "other", expected: { draftRevision: state.draftRevision, definition: state.definition, baseline: state.baseline }, entry: page, values: { title: "Changed by another editor" }, clear: [] });
    fireEvent.click(screen.getByRole("button", { name: "Create item", exact: true })); await waitFor(() => expect(handle.state.phase).toBe("conflict"));
    fireEvent.click(screen.getByRole("button", { name: "Review current content" })); await screen.findByRole("button", { name: "Reapply my changes" });
    fireEvent.click(screen.getByRole("button", { name: "Reapply my changes" })); await waitFor(() => expect(handle.state.pending).toBeNull());
    expect(handle.state.phase).toBe("dirty"); expect(handle.state.dirty).toBe(true); expect(screen.getByRole("textbox", { name: "question" })).toHaveValue("Retained question");
    fireEvent.click(screen.getByRole("button", { name: "Create item", exact: true })); await waitFor(() => expect(fixture.database().state.providers[0]!.entries.some((entry) => entry.id.startsWith("server-") && entry.modelId === "faq")).toBe(true));
  });
  it("shows refreshed publication facts and restores last-confirmed status when the host is unavailable", async () => {
    const fixture = editorFixture(); let checkpoint!: HostedRecoveryCheckpoint;
    const first = mount(fixture, { persistRecovery: (saved) => { checkpoint = saved; }, preview: { render: async () => undefined }, routeId: "home" }); await first.handle.ready;
    await first.handle.preview(); const submitted = await first.handle.submit();
    await fixture.service.recordStatus({ publicationId: submitted.id, snapshotId: submitted.snapshotId, statusVersion: 2, status: "building" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh submission status" })); await screen.findByText("Building");
    await waitFor(() => expect(checkpoint.publication!.status).toBe("building")); first.handle.dispose();
    fixture.transport.getPublication = async () => { throw new Error("provider unavailable"); };
    const reopened = mount(fixture, { recovery: checkpoint, preview: { render: async () => undefined }, routeId: "home" }); await reopened.handle.ready;
    expect(screen.getByText("Last confirmed status: Building")).toBeInTheDocument();
    expect(screen.getByText("Submission status is unavailable. The saved draft is retained.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit", exact: true })).toBeDisabled(); expect(screen.queryByText("Deployed", { exact: true })).toBeNull();
  });
  it("requires explicit conflict review/reapply and refreshes a clean durable revision", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready; await input("講座名", "私の変更");
    const authoritative = await fixture.service.readState(fixture.actor);
    await fixture.service.execute(fixture.actor, { kind: "set-fields", operationKey: "other", expected: { draftRevision: authoritative.draftRevision, definition: authoritative.definition, baseline: authoritative.baseline }, entry: page, values: { title: "他の変更" }, clear: [] });
    await expect(handle.flush()).rejects.toMatchObject({ code: "revision-conflict" });
    fireEvent.click(await screen.findByRole("button", { name: "Review current content" })); await screen.findByText("Current saved value: 他の変更");
    expect(screen.getByRole("textbox", { name: "講座名" })).toHaveValue("私の変更");
    fireEvent.click(screen.getByRole("button", { name: "Reapply my changes" })); await waitFor(() => expect(handle.state.pending).toBeNull()); await handle.flush(); expect(values(fixture).title).toBe("私の変更");
    const changed = fixture.database(); changed.state.draftRevision = "integrated-r"; changed.state.baseline = { gitSha: "g1", contentDigest: "a" }; fixture.replace(changed);
    await handle.refresh(); expect(handle.state.content!.baseline.gitSha).toBe("g1"); expect(handle.state.content!.draftRevision).toBe("integrated-r");
  });
});
