import { EditorSelection } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, within } from "@testing-library/preact";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, createMarkdownEditor } from "../markdown-editor";

beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON() {} }),
  });
});

function editorFrom(container: Element): EditorView {
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  if (!dom) throw new Error("CodeMirror did not mount");
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("CodeMirror view was not associated with its DOM");
  return view;
}

describe("MarkdownEditor lifecycle", () => {
  it("labels the multiline editor and does not echo the initial value", () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor identity="entry-1:body" label="Body" required value={"exact\n🙂"} onChange={onChange} />);
    const content = container.querySelector(".cm-content");
    expect(content).toHaveAttribute("aria-multiline", "true");
    // The kind rides in the name the way `Field` puts its own kind hint inside
    // the label, so the whole Entry form announces its controls the same way.
    expect(content).toHaveAccessibleName("Body Rich text (Markdown)");
    expect(content).toHaveAttribute("aria-required", "true");
    expect(content).toHaveAttribute("contenteditable", "true");
    expect(onChange).not.toHaveBeenCalled();
    expect(editorFrom(container).state.doc.toString()).toBe("exact\n🙂");
  });

  it("uses the freshest callback and replaces the EditorView only when identity changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const destroy = vi.spyOn(EditorView.prototype, "destroy");
    const rendered = render(<MarkdownEditor identity="entry-1:body" label="Body" value="a" onChange={first} />);
    const initial = editorFrom(rendered.container);

    rendered.rerender(<MarkdownEditor identity="entry-1:body" label="Body" value="a" onChange={second} />);
    expect(editorFrom(rendered.container)).toBe(initial);
    initial.dispatch({ changes: { from: 1, insert: "b" } });
    expect(second).toHaveBeenLastCalledWith("ab");
    expect(first).not.toHaveBeenCalled();

    rendered.rerender(<MarkdownEditor identity="entry-2:body" label="Body" value={"次\n"} onChange={second} />);
    expect(editorFrom(rendered.container)).not.toBe(initial);
    expect(editorFrom(rendered.container).state.doc.toString()).toBe("次\n");
    expect(destroy).toHaveBeenCalledTimes(1);
    rendered.unmount();
    expect(destroy).toHaveBeenCalledTimes(2);
    destroy.mockRestore();
  });

  it("applies external bytes without echoing or resetting a valid selection", () => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    const controller = createMarkdownEditor({ parent, value: "abcdef", labelledBy: "label", theme: "light", onChange });
    controller.view.dispatch({ selection: EditorSelection.single(2, 4) });
    controller.setValue("αβγδεζ\n<script>x</script>");
    expect(controller.view.state.doc.toString()).toBe("αβγδεζ\n<script>x</script>");
    expect(controller.view.state.selection.main).toMatchObject({ from: 2, to: 4 });
    expect(onChange).not.toHaveBeenCalled();
    expect(undo(controller.view)).toBe(false);
    controller.destroy();
  });

  it("persists user edits as the exact Unicode, newline, and HTML-looking string", () => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    const controller = createMarkdownEditor({ parent, value: "old", labelledBy: "label", theme: "light", onChange });
    const exact = "一行目🙂\n\n<img src=\"x\" onerror=\"bad()\">\n";
    controller.view.dispatch({ changes: { from: 0, to: controller.view.state.doc.length, insert: exact } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(exact);
    controller.destroy();
  });

  it("reconfigures the dark facet without losing selection or scroll", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = createMarkdownEditor({ parent, value: "line\n".repeat(80), labelledBy: "label", theme: "light", onChange() {} });
    controller.view.dispatch({ selection: EditorSelection.single(5, 9) });
    controller.view.scrollDOM.scrollTop = 37;
    controller.setTheme("dark");
    expect(controller.view.state.facet(EditorView.darkTheme)).toBe(true);
    expect(controller.view.state.selection.main).toMatchObject({ from: 5, to: 9 });
    expect(controller.view.scrollDOM.scrollTop).toBe(37);
    controller.setTheme("light");
    expect(controller.view.state.facet(EditorView.darkTheme)).toBe(false);
    controller.destroy();
    parent.remove();
  });
});

describe("MarkdownEditor authoring surface", () => {
  it("preserves the editor selection on toolbar pointer-down and formats on click", () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor identity="entry-1:body" label="Body" value="word" onChange={onChange} />);
    const view = editorFrom(container);
    view.dispatch({ selection: EditorSelection.single(0, 4) });
    const bold = within(container as HTMLElement).getByRole("button", { name: "Bold" });
    expect(fireEvent.pointerDown(bold)).toBe(false);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 4 });
    fireEvent.click(bold);
    expect(view.state.doc.toString()).toBe("**word**");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("word");
    expect(onChange).toHaveBeenCalledOnce();
    expect(view.hasFocus).toBe(true);
  });

  it("leaves Tab available for ordinary focus navigation", () => {
    const { container } = render(<MarkdownEditor identity="entry-1:body" label="Body" value="" onChange={() => undefined} />);
    const content = container.querySelector<HTMLElement>(".cm-content")!;
    expect(fireEvent.keyDown(content, { key: "Tab", code: "Tab" })).toBe(true);
  });

  it("continues Markdown list markup on Enter", () => {
    const { container } = render(<MarkdownEditor identity="entry-1:body" label="Body" value="- item" onChange={() => undefined} />);
    const view = editorFrom(container);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    view.focus();
    fireEvent.keyDown(view.contentDOM, { key: "Enter", code: "Enter" });
    expect(view.state.doc.toString()).toBe("- item\n- ");
  });

  it("offers Edit, Preview, and responsive Split views on the shared segmented control", () => {
    const { container } = render(<MarkdownEditor identity="entry-1:body" label="Story" value="## Title" onChange={() => undefined} />);
    const surface = within(container as HTMLElement);
    expect(surface.getByText("Rich text (Markdown)")).toBeInTheDocument();
    expect(surface.getByText("Formatted text")).toBeInTheDocument();
    const view = surface.getByRole("group", { name: "Markdown view" });
    expect(within(view).getAllByRole("button").map((option) => option.textContent)).toEqual(["Edit", "Split", "Preview"]);
    expect(within(view).getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(view).getByRole("button", { name: "Preview" }));
    expect(container.querySelector(".sg-content-markdown-editor")).toHaveAttribute("data-mode", "preview");
    expect(container.querySelector(".sg-content-markdown-editor__source")).toHaveAttribute("hidden");
    // Preview hides the source, so formatting it would land out of sight.
    expect(surface.getByRole("button", { name: "Bold" })).toBeDisabled();

    fireEvent.click(within(view).getByRole("button", { name: "Edit" }));
    expect(container.querySelector(".sg-content-markdown-editor")).toHaveAttribute("data-mode", "edit");
    expect(container.querySelector(".sg-content-markdown-editor__preview")).toHaveAttribute("hidden");
    expect(surface.getByRole("button", { name: "Bold" })).not.toBeDisabled();

    fireEvent.click(within(view).getByRole("button", { name: "Split" }));
    expect(container.querySelector(".sg-content-markdown-editor")).toHaveAttribute("data-mode", "split");
  });
});
