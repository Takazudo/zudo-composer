import { defineComponent } from "@zudo-composer/component-contract";
import { Stack, type StackProps } from "./stack";

export const stackDisplay = {
  title: "Stack",
  category: "Layout",
  description:
    "Generic flex stack — vertical or horizontal — with bounded gap, cross-axis alignment, and main-axis justification. Horizontal stacks always wrap so they never force overflow.",
} as const;

export const stackComposer = defineComponent<StackProps>()(Stack, {
  id: "ui.stack",
  schemaVersion: 1,
  ...stackDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "Stack" },
  defaults: { direction: "vertical", gap: "md", align: "stretch", justify: "start" },
  fields: [
    {
      prop: "direction",
      label: "Direction",
      schema: { type: "string", enum: ["vertical", "horizontal"] },
      editor: { kind: "select" },
    },
    { prop: "gap", label: "Gap", schema: { type: "string", enum: ["xs", "sm", "md", "lg", "xl"] }, editor: { kind: "select" } },
    {
      prop: "align",
      label: "Align",
      schema: { type: "string", enum: ["start", "center", "end", "stretch"] },
      editor: { kind: "select" },
    },
    {
      prop: "justify",
      label: "Justify",
      schema: { type: "string", enum: ["start", "center", "end", "between"] },
      editor: { kind: "select" },
    },
  ],
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});
