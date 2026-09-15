import { defineComponent } from "@zudo-composer/component-contract";
import { PlaceholderBox, type PlaceholderBoxProps } from "./placeholder-box";

// The component accepts arbitrary MDX img attributes. Narrowing to its named
// props keeps the persisted Composer surface finite and type-checkable.
export type PlaceholderBoxComposerProps = Pick<
  PlaceholderBoxProps,
  "label" | "alt" | "src" | "aspect" | "size" | "class"
>;

export const placeholderBoxDisplay = {
  title: "PlaceholderBox",
  category: "Media",
  description:
    "Labeled image stand-in used wherever the library has no real asset yet — also serves as the MDX `img` override target.",
} as const;

export const placeholderBoxComposer = defineComponent<PlaceholderBoxComposerProps>()(PlaceholderBox, {
  id: "ui.placeholder-box",
  schemaVersion: 1,
  ...placeholderBoxDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "PlaceholderBox" },
  defaults: { label: "hero-image.png", aspect: "16/9", size: "md" },
  fields: [
    { prop: "label", label: "Label", schema: { type: "string" }, editor: { kind: "text" } },
    {
      prop: "aspect",
      label: "Aspect ratio",
      schema: { type: "string", enum: ["16/9", "4/3", "1/1"] },
      editor: { kind: "select" },
    },
    { prop: "size", label: "Size", schema: { type: "string", enum: ["sm", "md", "lg"] }, editor: { kind: "select" } },
  ],
});
