import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { ResolvedTheme } from "../../theme/theme";

const externalValue = Annotation.define<boolean>();

const semanticHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--sg-content-markdown-syntax-heading)", fontWeight: "700" },
  { tag: [tags.strong, tags.emphasis], color: "var(--sg-content-markdown-syntax-emphasis)" },
  { tag: [tags.link, tags.url], color: "var(--sg-content-markdown-syntax-link)" },
  { tag: [tags.monospace, tags.processingInstruction], color: "var(--sg-content-markdown-syntax-code)" },
  { tag: tags.quote, color: "var(--sg-content-markdown-syntax-quote)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    minHeight: "12rem",
    color: "var(--sg-content-markdown-editor-fg)",
    backgroundColor: "var(--sg-content-markdown-editor-bg)",
    fontSize: "var(--text-sm)",
  },
  "&.cm-focused": { outline: "2px solid var(--color-focus)", outlineOffset: "-2px" },
  ".cm-content": {
    minHeight: "12rem",
    padding: "var(--spacing-vsp-xs) var(--spacing-hsp-md)",
    caretColor: "var(--sg-content-markdown-editor-caret)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "var(--leading-relaxed, 1.6)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--sg-content-markdown-editor-selection)",
  },
  ".cm-cursor": { borderLeftColor: "var(--sg-content-markdown-editor-caret)" },
  ".cm-gutters": {
    color: "var(--color-muted)",
    backgroundColor: "var(--sg-content-markdown-editor-bg)",
    borderRightColor: "var(--color-border)",
  },
});

export interface MarkdownEditorController {
  readonly view: EditorView;
  setValue(value: string): void;
  setTheme(theme: ResolvedTheme): void;
  destroy(): void;
}

export interface CreateMarkdownEditorOptions {
  parent: HTMLElement;
  value: string;
  /** Space-separated ids naming the editor — its label, and its kind hint. */
  labelledBy: string;
  required?: boolean;
  theme: ResolvedTheme;
  onChange(value: string): void;
}

/** Imperative lifecycle boundary used by the Preact wrapper and focused tests. */
export function createMarkdownEditor(options: CreateMarkdownEditorOptions): MarkdownEditorController {
  const themeCompartment = new Compartment();
  const state = EditorState.create({
    doc: options.value,
    extensions: [
      history(),
      markdown(),
      syntaxHighlighting(semanticHighlightStyle),
      EditorView.lineWrapping,
      editorTheme,
      themeCompartment.of(EditorView.darkTheme.of(options.theme === "dark")),
      EditorView.contentAttributes.of({
        "aria-labelledby": options.labelledBy,
        "aria-multiline": "true",
        ...(options.required ? { "aria-required": "true" } : {}),
        autocorrect: "off",
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "true",
        writingsuggestions: "false",
      }),
      keymap.of([
        { key: "Enter", run: insertNewlineContinueMarkup },
        ...defaultKeymap,
        ...historyKeymap,
        ...markdownKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || update.transactions.some((transaction) => transaction.annotation(externalValue))) return;
        options.onChange(update.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent: options.parent });

  return {
    view,
    setValue(value) {
      if (value === view.state.doc.toString()) return;
      const { anchor, head } = view.state.selection.main;
      const max = value.length;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: EditorSelection.single(Math.min(anchor, max), Math.min(head, max)),
        annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
      });
    },
    setTheme(theme) {
      view.dispatch({ effects: themeCompartment.reconfigure(EditorView.darkTheme.of(theme === "dark")) });
    },
    destroy: () => view.destroy(),
  };
}
