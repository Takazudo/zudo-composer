import { defineComponent } from "@zudo-composer/component-contract";
import { AutoGrid, type AutoGridProps } from "./auto-grid";

export const autoGridDisplay = {
  title: "AutoGrid",
  category: "Layout",
  description:
    "Auto-fit/auto-fill responsive grid primitive for card-style listings, switching column density by minimum track width.",
} as const;

export const autoGridComposer = defineComponent<AutoGridProps>()(AutoGrid, {
  id: "ui.auto-grid",
  schemaVersion: 1,
  ...autoGridDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "AutoGrid" },
  defaults: { min: "15rem", fill: false, gap: "md" },
  fields: [
    {
      prop: "min",
      label: "Min track width",
      schema: { type: "string", enum: ["11rem", "13rem", "14rem", "15rem", "16rem", "18rem"] },
      editor: { kind: "select" },
    },
    { prop: "gap", label: "Gap", schema: { type: "string", enum: ["sm", "md", "split"] }, editor: { kind: "select" } },
    { prop: "fill", label: "Fill (keep empty tracks)", schema: { type: "boolean" }, editor: { kind: "boolean" } },
  ],
  slots: [{ id: "items", prop: "children", label: "Items", cardinality: "many" }],
});
