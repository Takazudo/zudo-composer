import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { insertNewlineContinueMarkup, markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
//#region src/features/content/markdown-source.ts
var externalValue = Annotation.define();
var semanticHighlightStyle = HighlightStyle.define([
	{
		tag: tags.heading,
		color: "var(--sg-content-markdown-syntax-heading)",
		fontWeight: "700"
	},
	{
		tag: [tags.strong, tags.emphasis],
		color: "var(--sg-content-markdown-syntax-emphasis)"
	},
	{
		tag: [tags.link, tags.url],
		color: "var(--sg-content-markdown-syntax-link)"
	},
	{
		tag: [tags.monospace, tags.processingInstruction],
		color: "var(--sg-content-markdown-syntax-code)"
	},
	{
		tag: tags.quote,
		color: "var(--sg-content-markdown-syntax-quote)"
	}
]);
var editorTheme = EditorView.theme({
	"&": {
		minHeight: "12rem",
		color: "var(--sg-content-markdown-editor-fg)",
		backgroundColor: "var(--sg-content-markdown-editor-bg)",
		fontSize: "var(--text-sm)"
	},
	"&.cm-focused": {
		outline: "2px solid var(--color-focus)",
		outlineOffset: "-2px"
	},
	".cm-content": {
		minHeight: "12rem",
		padding: "var(--spacing-vsp-xs) var(--spacing-hsp-md)",
		caretColor: "var(--sg-content-markdown-editor-caret)",
		fontFamily: "var(--font-mono, ui-monospace, monospace)",
		lineHeight: "var(--leading-relaxed, 1.6)"
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--sg-content-markdown-editor-selection)" },
	".cm-cursor": { borderLeftColor: "var(--sg-content-markdown-editor-caret)" },
	".cm-gutters": {
		color: "var(--color-muted)",
		backgroundColor: "var(--sg-content-markdown-editor-bg)",
		borderRightColor: "var(--color-border)"
	}
});
/** Imperative lifecycle boundary used by the editor wrappers and focused tests. */
function createMarkdownEditor(options) {
	const themeCompartment = new Compartment();
	const validityCompartment = new Compartment();
	const validity = (invalid, describedBy) => EditorView.contentAttributes.of({
		...invalid ? { "aria-invalid": "true" } : {},
		...describedBy ? { "aria-describedby": describedBy } : {}
	});
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
				...options.required ? { "aria-required": "true" } : {},
				autocorrect: "off",
				autocomplete: "off",
				autocapitalize: "off",
				spellcheck: "true",
				writingsuggestions: "false"
			}),
			validityCompartment.of(validity(options.invalid, options.describedBy)),
			keymap.of([
				{
					key: "Enter",
					run: insertNewlineContinueMarkup
				},
				...defaultKeymap,
				...historyKeymap,
				...markdownKeymap
			]),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged || update.transactions.some((transaction) => transaction.annotation(externalValue))) return;
				options.onChange(update.state.doc.toString());
			})
		]
	});
	const view = new EditorView({
		state,
		parent: options.parent
	});
	return {
		view,
		setValue(value) {
			if (value === view.state.doc.toString()) return;
			const { anchor, head } = view.state.selection.main;
			const max = value.length;
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: value
				},
				selection: EditorSelection.single(Math.min(anchor, max), Math.min(head, max)),
				annotations: [externalValue.of(true), Transaction.addToHistory.of(false)]
			});
		},
		setTheme(theme) {
			view.dispatch({ effects: themeCompartment.reconfigure(EditorView.darkTheme.of(theme === "dark")) });
		},
		setInvalid(invalid, describedBy) {
			view.dispatch({ effects: validityCompartment.reconfigure(validity(invalid, describedBy)) });
		},
		destroy: () => view.destroy()
	};
}
//#endregion
export { createMarkdownEditor };
