import { defineComponent } from "@zudo-composer/component-contract";
import { Callout, type CalloutProps } from "./callout";

export const calloutDisplay = {
  title: "Callout",
  category: "Feedback",
  description: "Call-out box for notes/asides in body copy, in an accent-tinted or neutral tone.",
} as const;

export const calloutComposer = defineComponent<CalloutProps>()(Callout, {
  id: "ui.callout",
  schemaVersion: 1,
  ...calloutDisplay,
  source: { module: "@zudo-sg/ui", exportKind: "named", exportName: "Callout" },
  defaults: { tone: "note", title: "Note" },
  fields: [
    { prop: "tone", label: "Tone", schema: { type: "string", enum: ["note", "muted"] }, editor: { kind: "select" } },
    { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
  ],
  slots: [{ id: "body", prop: "children", label: "Body", cardinality: "many" }],
});
