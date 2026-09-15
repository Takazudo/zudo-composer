import { defineComponent } from "@zudo-composer/component-contract";
import { SectionHeading, type SectionHeadingProps } from "./section-heading";

// Keep the persisted Composer intro a string even though the runtime component
// supports MDX ComponentChildren.
type SectionHeadingComposerProps = Omit<SectionHeadingProps, "intro"> & { intro?: string };

export const sectionHeadingDisplay = {
  title: "SectionHeading",
  category: "Content",
  description: "Section header block: optional eyebrow, heading, and an optional intro paragraph.",
} as const;

export const sectionHeadingComposer = defineComponent<SectionHeadingComposerProps>()(SectionHeading, {
  id: "ui.section-heading",
  schemaVersion: 1,
  ...sectionHeadingDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "SectionHeading" },
  defaults: {
    eyebrow: "About",
    heading: "Our approach",
    intro: "A short supporting sentence.",
    as: "h2",
  },
  fields: [
    { prop: "eyebrow", label: "Eyebrow", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "heading", label: "Heading", required: true, schema: { type: "string" }, editor: { kind: "text" }, inlineEdit: true },
    { prop: "intro", label: "Intro", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "as", label: "Heading level", schema: { type: "string", enum: ["h1", "h2"] }, editor: { kind: "select" } },
  ],
  adapters: {
    inlineEditor: {
      field: "heading",
      resolveElement: (root: HTMLElement) => root.querySelector<HTMLHeadingElement>("h1, h2"),
    },
  },
});
