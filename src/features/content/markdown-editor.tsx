import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { ProseMd } from "@zudo-sg/ui";
import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  BoldIcon,
  HeadingIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  QuoteIcon,
} from "../../components/icons";
import type { ResolvedTheme } from "../../theme/theme";
import { useResolvedTheme } from "../../theme/use-resolved-theme";
import { applyMarkdownFormat, type MarkdownFormat } from "./markdown-formatting";

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
  labelId: string;
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
        "aria-labelledby": options.labelId,
        "aria-multiline": "true",
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

export type MarkdownEditorMode = "edit" | "preview" | "split";

export interface MarkdownEditorProps {
  /** Stable Entry/field identity. Changing it creates a fresh EditorView and history. */
  identity: string;
  value: string;
  label: string;
  required?: boolean;
  onChange(value: string): void;
  initialMode?: MarkdownEditorMode;
  theme?: ResolvedTheme;
}

const actions: readonly {
  format: MarkdownFormat;
  label: string;
  icon: typeof BoldIcon;
}[] = [
  { format: "bold", label: "Bold", icon: BoldIcon },
  { format: "italic", label: "Italic", icon: ItalicIcon },
  { format: "code", label: "Inline code", icon: InlineCodeIcon },
  { format: "heading", label: "Heading", icon: HeadingIcon },
  { format: "link", label: "Link", icon: LinkIcon },
  { format: "quote", label: "Quote", icon: QuoteIcon },
  { format: "list", label: "List", icon: ListIcon },
];

export function MarkdownEditor({
  identity,
  value,
  label,
  required = false,
  onChange,
  initialMode = "split",
  theme: suppliedTheme,
}: MarkdownEditorProps): JSX.Element {
  const observedTheme = useResolvedTheme();
  const theme = suppliedTheme ?? observedTheme;
  const labelId = `sg-content-markdown-label-${useId()}`;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<MarkdownEditorController | null>(null);
  const callbackRef = useRef(onChange);
  const [mode, setMode] = useState<MarkdownEditorMode>(initialMode);
  callbackRef.current = onChange;

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    const controller = createMarkdownEditor({
      parent,
      value,
      labelId,
      theme,
      onChange: (next) => callbackRef.current(next),
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.destroy();
    };
    // One editor/history lifetime belongs to exactly one Entry/field identity;
    // value, callback, and theme updates flow through the refs/effects below.
  }, [identity, labelId]);

  useEffect(() => controllerRef.current?.setValue(value), [identity, value]);
  useEffect(() => controllerRef.current?.setTheme(theme), [identity, theme]);

  const runFormat = (format: MarkdownFormat): void => {
    const controller = controllerRef.current;
    if (controller) applyMarkdownFormat(controller.view, format);
  };

  return (
    <section class="sg-content-markdown-editor" data-mode={mode}>
      <div class="sg-content-markdown-editor__heading">
        <span id={labelId} class="sg-content-markdown-editor__label">
          {label}{required ? " (required)" : ""}
        </span>
        <span class="sg-content-markdown-editor__kind">Rich text (Markdown)</span>
      </div>
      <div class="sg-content-markdown-editor__mode" role="group" aria-label="Markdown view">
        {(["edit", "preview", "split"] as const).map((candidate) => (
          <button key={candidate} type="button" aria-pressed={mode === candidate} onClick={() => setMode(candidate)}>
            {candidate[0]!.toUpperCase() + candidate.slice(1)}
          </button>
        ))}
      </div>
      <div class="sg-content-markdown-editor__workspace">
        <div class="sg-content-markdown-editor__source" hidden={mode === "preview"}>
          <div class="sg-content-markdown-editor__toolbar" role="toolbar" aria-label="Format Markdown">
            {actions.map(({ format, label: actionLabel, icon: Icon }) => (
              <button
                key={format}
                type="button"
                aria-label={actionLabel}
                title={actionLabel}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => runFormat(format)}
              >
                <Icon size="sm" />
                <span>{actionLabel}</span>
              </button>
            ))}
          </div>
          <div class="sg-content-markdown-editor__mount" ref={mountRef} />
        </div>
        <div class="sg-content-markdown-editor__preview" hidden={mode === "edit"} aria-label={`${label} formatted preview`}>
          <div class="sg-content-markdown-editor__preview-label">Formatted text</div>
          <ProseMd markdown={value} />
        </div>
      </div>
    </section>
  );
}
