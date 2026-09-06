import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { Note, Panel, type NoteProps, type PanelProps } from "./components";

const panelComposer = defineComponent<PanelProps>()(Panel, {
  id: "themeset.panel",
  schemaVersion: 1,
  title: "Panel",
  category: "Layout",
  description: "A titled region with one tone switch.",
  source: { module: "@zudo-composer/fixture-themeset", exportKind: "named", exportName: "Panel" },
  defaults: { title: "Panel", tone: "plain" },
  fields: [
    { prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } },
    { prop: "tone", label: "Tone", schema: { type: "string", enum: ["plain", "loud"] }, editor: { kind: "select" } },
  ],
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});

const noteComposer = defineComponent<NoteProps>()(Note, {
  id: "themeset.note",
  schemaVersion: 1,
  title: "Note",
  category: "Content",
  description: "A single paragraph of body text.",
  source: { module: "@zudo-composer/fixture-themeset", exportKind: "named", exportName: "Note" },
  defaults: { body: "Note" },
  fields: [{ prop: "body", label: "Body", schema: { type: "string" }, editor: { kind: "text", multiline: true } }],
});

export const componentPack = defineComponentPack({
  packId: "@zudo-composer/fixture-themeset",
  packVersion: "1.0.0",
  components: [panelComposer, noteComposer],
});
