import { defineComponent } from "@zudo-composer/component-contract";
import { ProseP, type ProsePProps } from "./prose-p";

// Composer edits plain text. The runtime component still accepts the broader
// MDX children and paragraph attributes, but the authoring contract
// intentionally narrows this persisted surface to a JSON string.
type ProsePComposerProps = Pick<ProsePProps, "class"> & { children?: string };

export const prosePDisplay = {
  title: "ProseP",
  category: "Typography",
  description:
    "MDX `p` element override — plain paragraph; flow spacing is owned by the consumer's content-flow stylesheet.",
} as const;

export const prosePComposer = defineComponent<ProsePComposerProps>()(ProseP, {
  id: "ui.prose-p",
  schemaVersion: 1,
  ...prosePDisplay,
  source: { module: "@zudo-composer/ui", exportKind: "named", exportName: "ProseP" },
  defaults: { children: "Body copy." },
  fields: [
    {
      prop: "children",
      label: "Text",
      schema: { type: "string" },
      editor: { kind: "text", multiline: true },
      inlineEdit: true,
    },
  ],
  adapters: { inlineEditor: { field: "children", resolveElement: (root: HTMLElement) => root } },
});
