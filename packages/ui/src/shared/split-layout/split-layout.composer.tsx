import { defineComponent } from "@zudo-composer/component-contract";
import { SplitLayout, type SplitLayoutProps } from "./split-layout";

export const splitLayoutDisplay = {
  title: "SplitLayout",
  category: "Layout",
  description:
    "Two-pane layout: stacked full-width panes below md, ratio-controlled side-by-side panes at md and above.",
} as const;

export const splitLayoutComposer = defineComponent<SplitLayoutProps>()(SplitLayout, {
  id: "ui.split-layout",
  schemaVersion: 1,
  ...splitLayoutDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "SplitLayout" },
  defaults: { ratio: "50/50", gap: "md" },
  fields: [
    {
      prop: "ratio",
      label: "Ratio",
      schema: { type: "string", enum: ["50/50", "40/60", "60/40", "33/67", "67/33"] },
      editor: { kind: "select" },
    },
    { prop: "gap", label: "Gap", schema: { type: "string", enum: ["sm", "md", "lg"] }, editor: { kind: "select" } },
  ],
  slots: [
    { id: "left", prop: "left", label: "Left", cardinality: "single" },
    { id: "right", prop: "right", label: "Right", cardinality: "many" },
  ],
});
