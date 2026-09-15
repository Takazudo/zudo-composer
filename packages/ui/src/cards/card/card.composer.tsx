import { defineComponent } from "@zudo-composer/component-contract";
import { Card, type CardProps } from "./card";

export const cardDisplay = {
  title: "Card",
  category: "Data Display",
  description:
    "Flat surface container with a border and rounded corners, in three variants and three padding sizes.",
} as const;

export const cardComposer = defineComponent<CardProps>()(Card, {
  id: "ui.card",
  schemaVersion: 1,
  ...cardDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "Card" },
  defaults: { title: "Card heading", variant: "default", padding: "md" },
  fields: [
    { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
    {
      prop: "variant",
      label: "Variant",
      schema: { type: "string", enum: ["default", "accent", "muted"] },
      editor: { kind: "select" },
    },
    { prop: "padding", label: "Padding", schema: { type: "string", enum: ["sm", "md", "lg"] }, editor: { kind: "select" } },
  ],
  slots: [{ id: "body", prop: "children", label: "Body", cardinality: "many" }],
});
