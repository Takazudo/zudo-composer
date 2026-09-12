import { defineComponent } from "@zudo-composer/component-contract";

export interface DemoNoteProps {
  text: string;
}

export function DemoNote({ text = "Demo — no data is sent." }: DemoNoteProps) {
  return <p class="py-shop-vsp-sm text-shop-caption text-shop-muted">{text}</p>;
}

export const demoNoteComponent = defineComponent<DemoNoteProps>()(DemoNote, {
  id: "shop.demo-note",
  schemaVersion: 1,
  title: "Demo note",
  category: "Chrome",
  description: "Muted caption saying the mock sends no data.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "DemoNote" },
  defaults: { text: "Demo — no data is sent." },
  fields: [{ kind: "text", prop: "text", label: "Text" }],
});
