import { defineComponent } from "@zudo-composer/component-contract";
import { ProseMd, type ProseMdProps } from "./prose-md";

export const SAMPLE_MARKDOWN = [
  "## Getting started",
  "",
  "Install the package, then render markdown straight from a string.",
  "",
  "- Zero-config defaults",
  "- Full **TypeScript** support",
  "",
  "```ts",
  "export function greet(name: string): string {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
  "> Edits to this field re-render live once wired into the canvas inspector.",
  "",
].join("\n");

export const proseMdDisplay = {
  title: "ProseMd",
  category: "Typography",
  description: "Renders a markdown string client-side (fence highlighting, sanitized output).",
} as const;

export const proseMdComposer = defineComponent<ProseMdProps>()(ProseMd, {
  id: "ui.prose-md",
  schemaVersion: 1,
  ...proseMdDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "ProseMd" },
  defaults: { markdown: SAMPLE_MARKDOWN },
  fields: [
    {
      prop: "markdown",
      label: "Markdown",
      required: true,
      schema: { type: "string" },
      editor: { kind: "text", multiline: true, mode: "markdown-source" },
      inlineEdit: true,
    },
  ],
  adapters: { inlineEditor: { field: "markdown", resolveElement: (root: HTMLElement) => root } },
});
