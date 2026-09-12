// This host's component pack. `pack` and every `source.module` are
// "demo-blog/components": the package's own name plus an exported subpath,
// which Node and Vite both resolve without anything installed.
import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
import { Hello, type HelloProps } from "./hello";

const hello = defineComponent<HelloProps>()(Hello, {
  id: "blog.hello",
  schemaVersion: 1,
  title: "Hello",
  category: "Content",
  description: "Placeholder paragraph until the real blog components land.",
  source: { module: "demo-blog/components", exportKind: "named", exportName: "Hello" },
  defaults: { text: "Hello" },
  fields: [{ prop: "text", label: "Text", schema: { type: "string" }, editor: { kind: "text" } }],
});

export const componentPack = defineComponentPack({
  packId: "demo-blog",
  packVersion: "1.0.0",
  components: [hello],
});

export { Hello };
export type { HelloProps };
