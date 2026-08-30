import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type MarkdownFormat = "bold" | "italic" | "code" | "heading" | "link" | "quote" | "list";

interface FormattingEdit {
  changes: TransactionSpec["changes"];
  selection: EditorSelection;
}

const WRAPS = {
  bold: { open: "**", close: "**", placeholder: "strong text" },
  italic: { open: "*", close: "*", placeholder: "emphasis" },
  code: { open: "`", close: "`", placeholder: "code" },
  link: { open: "[", close: "](https://example.com)", placeholder: "link text" },
} as const;

const PREFIXES = {
  heading: { prefix: "## ", placeholder: "Heading" },
  quote: { prefix: "> ", placeholder: "Quote" },
  list: { prefix: "- ", placeholder: "List item" },
} as const;

function wrapSelection(state: EditorState, format: keyof typeof WRAPS): FormattingEdit {
  const { anchor, head, from, to } = state.selection.main;
  const { open, close, placeholder } = WRAPS[format];
  const selected = state.sliceDoc(from, to);
  const content = selected || placeholder;
  return {
    changes: { from, to, insert: `${open}${content}${close}` },
    selection: selected
      ? EditorSelection.single(anchor + open.length, head + open.length)
      : EditorSelection.single(from + open.length, from + open.length + content.length),
  };
}

function prefixLines(state: EditorState, format: keyof typeof PREFIXES): FormattingEdit {
  const { anchor, head, from, to } = state.selection.main;
  const { prefix, placeholder } = PREFIXES[format];

  if (from === to) {
    const line = state.doc.lineAt(from);
    if (line.length === 0) {
      return {
        changes: { from: line.from, insert: `${prefix}${placeholder}` },
        selection: EditorSelection.single(line.from + prefix.length, line.from + prefix.length + placeholder.length),
      };
    }
  }

  const firstLine = state.doc.lineAt(from);
  // A selection ending at the beginning of a line does not include that line.
  const finalPosition = to > from && to === state.doc.lineAt(to).from ? to - 1 : to;
  const lastLine = state.doc.lineAt(finalPosition);
  const changes = [];
  for (let number = firstLine.number; number <= lastLine.number; number += 1) {
    changes.push({ from: state.doc.line(number).from, insert: prefix });
  }
  const changeSet = state.changes(changes);
  const mappedFrom = changeSet.mapPos(from, 1);
  const mappedTo = changeSet.mapPos(to, -1);
  return {
    changes,
    selection: from === to
      ? EditorSelection.single(mappedFrom)
      : EditorSelection.single(anchor > head ? mappedTo : mappedFrom, anchor > head ? mappedFrom : mappedTo),
  };
}

/** Calculate a formatting edit without mutating an editor or a stored Markdown string. */
export function markdownFormattingTransaction(state: EditorState, format: MarkdownFormat): TransactionSpec {
  const edit = format in WRAPS
    ? wrapSelection(state, format as keyof typeof WRAPS)
    : prefixLines(state, format as keyof typeof PREFIXES);
  return { ...edit, scrollIntoView: true, userEvent: "input.format", annotations: isolateHistory.of("full") };
}

/** Apply one formatting action as exactly one undoable CodeMirror transaction. */
export function applyMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
  view.dispatch(markdownFormattingTransaction(view.state, format));
  view.focus();
  return true;
}
