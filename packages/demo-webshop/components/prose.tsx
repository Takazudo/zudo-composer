import { defineComponent } from "@zudo-composer/component-contract";
import { Markdown } from "./markdown";

export interface ProseProps {
  markdown: string;
}

export function Prose({ markdown = "" }: ProseProps) {
  return (
    <div class="flex max-w-shop-prose flex-col gap-shop-vsp-sm text-shop-body text-shop-fg">
      <Markdown source={markdown} />
    </div>
  );
}

export const proseComponent = defineComponent<ProseProps>()(Prose, {
  id: "shop.prose",
  schemaVersion: 1,
  title: "Prose",
  category: "Content",
  description: "Markdown body: headings, paragraphs, lists, links, emphasis and rules.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Prose" },
  defaults: { markdown: "Write something **quiet**." },
  fields: [
    {
      prop: "markdown",
      label: "Markdown",
      schema: { type: "string" },
      editor: { kind: "text", multiline: true, mode: "markdown-source" },
    },
  ],
});
