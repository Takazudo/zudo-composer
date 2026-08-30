import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { applyMarkdownFormat, markdownFormattingTransaction, type MarkdownFormat } from "../markdown-formatting";

function apply(doc: string, from: number, to: number, format: MarkdownFormat) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  return state.update(markdownFormattingTransaction(state, format)).state;
}

describe("Markdown formatting transactions", () => {
  it.each([
    ["bold", "**文🙂字**"],
    ["italic", "*文🙂字*"],
    ["code", "`文🙂字`"],
    ["link", "[文🙂字](https://example.com)"],
  ] as const)("wraps a Unicode selection for %s and deliberately keeps the content selected", (format, expected) => {
    const next = apply("文🙂字", 0, 4, format);
    expect(next.doc.toString()).toBe(expected);
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("文🙂字");
  });

  it("preserves a backwards selection while wrapping", () => {
    const state = EditorState.create({ doc: "word", selection: EditorSelection.single(4, 0) });
    const next = state.update(markdownFormattingTransaction(state, "bold")).state;
    expect(next.selection.main).toMatchObject({ anchor: 6, head: 2 });
  });

  it.each([
    ["bold", "**strong text**", "strong text"],
    ["italic", "*emphasis*", "emphasis"],
    ["code", "`code`", "code"],
    ["heading", "## Heading", "Heading"],
    ["link", "[link text](https://example.com)", "link text"],
    ["quote", "> Quote", "Quote"],
    ["list", "- List item", "List item"],
  ] as const)("inserts and selects the %s placeholder", (format, expected, selected) => {
    const next = apply("", 0, 0, format);
    expect(next.doc.toString()).toBe(expected);
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe(selected);
  });

  it("prefixes every selected line without normalizing source bytes", () => {
    const source = "α\n<img onclick=\"x\">\n終\n";
    const next = apply(source, 0, source.length, "quote");
    expect(next.doc.toString()).toBe("> α\n> <img onclick=\"x\">\n> 終\n");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("α\n> <img onclick=\"x\">\n> 終\n");
  });

  it("preserves selection direction while prefixing lines", () => {
    const state = EditorState.create({ doc: "one\ntwo", selection: EditorSelection.single(7, 0) });
    const next = state.update(markdownFormattingTransaction(state, "list")).state;
    expect(next.doc.toString()).toBe("- one\n- two");
    expect(next.selection.main.anchor).toBeGreaterThan(next.selection.main.head);
  });

  it("keeps an empty selection a cursor when prefixing a non-empty line", () => {
    const next = apply("Body", 0, 0, "heading");
    expect(next.doc.toString()).toBe("## Body");
    expect(next.selection.main).toMatchObject({ empty: true, from: 3, to: 3 });
  });

  it("is one history step and refocuses after a toolbar action", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "word",
        selection: EditorSelection.single(0, 4),
        extensions: [history()],
      }),
      parent,
    });
    applyMarkdownFormat(view, "bold");
    expect(view.state.doc.toString()).toBe("**word**");
    applyMarkdownFormat(view, "italic");
    expect(view.state.doc.toString()).toBe("***word***");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("**word**");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("word");
    expect(view.hasFocus).toBe(true);
    view.destroy();
    parent.remove();
  });
});
