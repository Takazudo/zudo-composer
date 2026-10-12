import type { JSX } from "preact";
import { MarkdownPreview } from "./markdown-preview";
import { MarkdownSourceEditor, type MarkdownEditorProps } from "./markdown-source-editor";

export * from "./markdown-source-editor";

/** The local tool's editor: source plus the configured pack's formatted preview. */
export function renderMarkdownPreview(markdown: string): JSX.Element {
  return <MarkdownPreview markdown={markdown} />;
}

export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  return <MarkdownSourceEditor {...props} renderPreview={renderMarkdownPreview} />;
}
