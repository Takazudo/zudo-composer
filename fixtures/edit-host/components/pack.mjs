import { h } from "preact";
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";

export const Paragraph = ({ text }) => h("p", {}, text);
export const List = ({ items }) => h("ul", {}, items.map((item, index) => h("li", { key: index }, item)));
export const Image = ({ src, alt }) => h("img", { src, alt });
export const Note = ({ text }) => h("aside", {}, text);
export const Frame = ({ children }) => h("main", {}, [h("header", {}, "Installed template frame"), children]);
export const Table = ({ columns, rows }) => h("table", {}, [
  h("thead", {}, h("tr", {}, columns.map((column, index) => h("th", { key: index }, column)))),
  h("tbody", {}, rows.map((row, index) => h("tr", { key: index }, row.map((cell, cellIndex) => h("td", { key: cellIndex }, cell))))),
]);
const string = { schema: { type: "string" }, editor: { kind: "text" } };
const strings = { schema: { type: "array", items: string }, editor: { kind: "list" } };
const component = (render, id, title, defaults, fields) => defineComponent()(render, {
  id, schemaVersion: 1, title, category: "Native editing", description: `${title} native editing proof`,
  source: { module: "native-edit-host/components", exportKind: "named", exportName: title },
  defaults, fields,
});
export const componentPack = defineComponentPack({
  packId: "native-edit-host", packVersion: "1.0.0", components: [
    defineComponent()(Frame, { id: "native.frame", schemaVersion: 1, title: "Frame", category: "Native editing", description: "Real template context", source: { module: "native-edit-host/components", exportKind: "named", exportName: "Frame" }, defaults: {}, fields: [], slots: [{ id: "body", prop: "children", label: "Page body", cardinality: "many", accepts: ["native.paragraph", "native.list", "native.image", "native.table"] }] }),
    component(Note, "native.note", "Note", { text: "" }, [{ prop: "text", label: "Text", ...string }]),
    component(Paragraph, "native.paragraph", "Paragraph", { text: "" }, [{ prop: "text", label: "Text", ...string }]),
    component(List, "native.list", "List", { items: [] }, [{ prop: "items", label: "Items", ...strings }]),
    component(Image, "native.image", "Image", { src: "", alt: "" }, [{ prop: "src", label: "Source", ...string }, { prop: "alt", label: "Alternative text", ...string }]),
    component(Table, "native.table", "Table", { columns: [], rows: [] }, [
      { prop: "columns", label: "Columns", ...strings },
      { prop: "rows", label: "Rows", schema: { type: "array", items: strings }, editor: { kind: "list" } },
    ]),
  ],
});
