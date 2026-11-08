import { EditorView } from "@codemirror/view";
import { fireEvent, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { HostedPreviewError, hostedEditorLabelsJa, hostedErrorMessages, hostedErrorMessagesJa, mountHostedContentEditor } from "../editor";
import type { HostedContentEditorHandle, HostedContentEditorOptions } from "../editor";
import { HostedContentError } from "../types";
import { editorFixture, page } from "./editor-fixture";
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON() {} }) });
});
const handles: HostedContentEditorHandle[] = [];
afterEach(() => { handles.forEach((handle) => handle.dispose()); handles.length = 0; document.body.replaceChildren(); });
function mount(fixture: ReturnType<typeof editorFixture>, extra: Partial<HostedContentEditorOptions> = {}) {
  const container = document.createElement("div"); document.body.append(container);
  let key = 0; const handle = mountHostedContentEditor(container, { transport: fixture.transport, policy: fixture.policy, selection: { entry: page, fieldId: "title" }, createOperationKey: () => `feedback-${handles.length}-${++key}`, ...extra });
  handles.push(handle); return { handle, container };
}
const japanese = { labels: hostedEditorLabelsJa, errorMessages: hostedErrorMessagesJa };
async function remoteChange(fixture: ReturnType<typeof editorFixture>, values: Record<string, string | number>) {
  const state = await fixture.service.readState(fixture.actor);
  await fixture.service.execute(fixture.actor, { kind: "set-fields", operationKey: `remote-${JSON.stringify(values)}`, expected: { draftRevision: state.draftRevision, definition: state.definition, baseline: state.baseline }, entry: page, values, clear: [] });
}

describe("conflict review lists only the fields that differ", () => {
  it.each([
    ["en", {}, "Review current content", "Fields that differ from the current saved content (2)", "Unchanged fields", "Your value", "Current saved value"],
    ["ja", japanese, "現在の内容を確認", "現在保存されている内容と異なる項目 (2)", "変更のない項目", "あなたの値", "現在保存されている値"],
  ] as const)("%s", async (_, extra, review, heading, unchanged, local, server) => {
    const fixture = editorFixture(); const { handle, container } = mount(fixture, extra); await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "私の講座名" } });
    await remoteChange(fixture, { price: 12 });
    await expect(handle.flush()).rejects.toMatchObject({ code: "revision-conflict" });
    fireEvent.click(await screen.findByRole("button", { name: review }));
    await screen.findByText(heading);
    const list = screen.getByRole("group", { name: heading });
    expect([...container.querySelectorAll("[data-hosted-difference]")].map((row) => row.getAttribute("data-hosted-difference"))).toEqual(["title", "price"]);
    expect(within(list).getByText(`${local}: 私の講座名`)).toBeInTheDocument();
    expect(within(list).getByText(`${server}: 日本語の講座`)).toBeInTheDocument();
    expect(within(list).getByText(`${local}: 9`)).toBeInTheDocument();
    expect(within(list).getByText(`${server}: 12`)).toBeInTheDocument();
    // The unchanged long Markdown body is summarized by label, never printed twice.
    expect(screen.queryByText(`${local}: 初期の文章`)).toBeNull();
    expect(screen.queryByText(`${server}: 初期の文章`)).toBeNull();
    const summary = screen.getByText(new RegExp(`^${unchanged} \\(\\d+\\)$`));
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("notes")).toBeInTheDocument();
    expect(within(details).queryByText("講座名")).toBeNull();
  });
  it("says that nothing differs when the retained values already match", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture); await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "同じ値" } });
    await remoteChange(fixture, { title: "同じ値" });
    await expect(handle.flush()).rejects.toMatchObject({ code: "revision-conflict" });
    fireEvent.click(await screen.findByRole("button", { name: "Review current content" }));
    await screen.findByText("Fields that differ from the current saved content (0)");
    expect(screen.getByText("No shown field differs from the current saved content.")).toBeInTheDocument();
  });
});

describe("empty required fields are marked while drafts stay saveable", () => {
  it.each([["en", {}, "This field is required.", "Save"], ["ja", japanese, "この項目は必須です。", "保存"]] as const)("%s text control", async (_, extra, message, save) => {
    const fixture = editorFixture(); const { handle } = mount(fixture, extra); await handle.ready;
    const title = await screen.findByRole("textbox", { name: "講座名" });
    expect(title).not.toHaveAttribute("aria-invalid");
    fireEvent.input(title, { target: { value: "  " } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "講座名" })).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByRole("textbox", { name: "講座名" })).toHaveAccessibleDescription(message);
    expect(screen.getByText(message)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: save }));
    await waitFor(() => expect(handle.state.phase).toBe("saved"));
    expect(fixture.database().state.providers[0]!.entries.find((entry) => entry.id === "home")!.values.title).toBe("  ");
    fireEvent.input(screen.getByRole("textbox", { name: "講座名" }), { target: { value: "入力済み" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "講座名" })).not.toHaveAttribute("aria-invalid"));
    expect(screen.queryByText(message)).toBeNull();
  });
  it("marks an empty required Markdown source", async () => {
    const fixture = editorFixture({ requiredNotes: true }); const { handle, container } = mount(fixture); await handle.ready;
    await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    expect(content).not.toHaveAttribute("aria-invalid");
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    await waitFor(() => expect(container.querySelector(".cm-content")).toHaveAttribute("aria-invalid", "true"));
    const described = container.querySelector(".cm-content")!.getAttribute("aria-describedby")!;
    expect(document.getElementById(described)).toHaveTextContent("This field is required.");
    await handle.flush(); expect(handle.state.phase).toBe("saved");
  });
});

describe("a failed preview explains why", () => {
  const failing = (error: unknown) => ({ render: async () => { throw error; } });
  it.each([
    ["en", { errorMessages: hostedErrorMessages }, ["The preview could not be shown.", "The preview could not be rendered.", "Required content is incomplete.", "講座名 is required.", "Details: render-failed: Preview failed (409)"]],
    ["ja", japanese, ["プレビューを表示できませんでした。", "プレビューを描画できませんでした。", "必須の内容が入力されていません。", "「講座名」は必須です。", "詳細: render-failed: Preview failed (409)"]],
  ] as const)("%s render failure lists the snapshot diagnostics", async (_, extra, texts) => {
    const fixture = editorFixture();
    const { handle } = mount(fixture, { ...extra, preview: failing(new HostedPreviewError("render-failed", "Preview failed (409)")), routeId: "home" });
    await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "" } });
    await expect(handle.preview()).rejects.toMatchObject({ code: "render-failed" });
    const alert = await screen.findByRole("alert");
    expect([...alert.querySelectorAll("p, li")].map((node) => node.textContent)).toEqual([...texts]);
    expect(handle.state.previewFailure!.diagnostics.map((diagnostic) => diagnostic.fieldId)).toEqual(["title"]);
    // A later edit makes the failed attempt obsolete.
    fireEvent.input(screen.getByRole("textbox", { name: "講座名" }), { target: { value: "直した講座名" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(handle.state.previewFailure).toBeNull();
  });
  it("localizes a typed incomplete failure from the host", async () => {
    const fixture = editorFixture();
    const { handle } = mount(fixture, { ...japanese, preview: failing(new HostedContentError("incomplete", "Snapshot projection is blocked")), routeId: "home" });
    await handle.ready; await screen.findByRole("textbox", { name: "講座名" });
    await expect(handle.preview()).rejects.toMatchObject({ code: "incomplete" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("プレビューを表示できませんでした。");
    expect(alert).toHaveTextContent(hostedErrorMessagesJa.incomplete);
    expect(alert).toHaveTextContent("詳細: incomplete: Snapshot projection is blocked");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
  it("lists successful-preview diagnostics with localized field names", async () => {
    const fixture = editorFixture();
    const { handle } = mount(fixture, { ...japanese, preview: { render: async () => undefined }, routeId: "home" });
    await handle.ready;
    fireEvent.input(await screen.findByRole("textbox", { name: "講座名" }), { target: { value: "" } });
    await handle.preview();
    const alert = await screen.findByRole("alert");
    expect([...alert.querySelectorAll("p, li")].map((node) => node.textContent)).toEqual(["必須の内容が入力されていません。", "「講座名」は必須です。"]);
  });
});

describe("submission availability", () => {
  const preview = { render: async () => undefined };
  it("keeps the preview-first prompt and Submit by default", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture, { ...japanese, preview, routeId: "home" }); await handle.ready;
    await screen.findByRole("textbox", { name: "講座名" });
    expect(screen.getByText(hostedEditorLabelsJa.previewRequired)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hostedEditorLabelsJa.submit })).toBeDisabled();
  });
  it("hides Submit and its prompt when the host offers no submission", async () => {
    const fixture = editorFixture(); const { handle } = mount(fixture, { ...japanese, preview, routeId: "home", submission: false }); await handle.ready;
    await screen.findByRole("textbox", { name: "講座名" });
    expect(screen.queryByText(hostedEditorLabelsJa.previewRequired)).toBeNull();
    expect(screen.queryByRole("button", { name: hostedEditorLabelsJa.submit })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: hostedEditorLabelsJa.preview }));
    await screen.findByText(hostedEditorLabelsJa.previewCurrent);
    await expect(handle.submit()).rejects.toThrow("Submission is not offered");
    expect(fixture.requests.some((request) => request.kind === "begin-publication")).toBe(false);
  });
});
