export default {
  pack: "native-edit-host/components",
  nativeEditing: {
    source: "workspace",
    paragraph: { componentId: "native.paragraph", textProp: "text" },
    list: { componentId: "native.list", itemsProp: "items" },
    image: { componentId: "native.image", srcProp: "src", altProp: "alt" },
    table: { componentId: "native.table", columnsProp: "columns", rowsProp: "rows" },
  },
};
