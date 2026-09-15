import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface SectionProps {
  tone: "bg" | "surface";
  children?: ComponentChildren;
}

const TONE = { bg: "bg-shop-bg", surface: "bg-shop-surface" } as const;

export function Section({ tone = "bg", children }: SectionProps) {
  return <section class={`flex flex-col gap-shop-vsp-lg py-shop-vsp-xl ${TONE[tone] ?? TONE.bg}`}>{children}</section>;
}

export const sectionComponent = defineComponent<SectionProps>()(Section, {
  id: "shop.section",
  schemaVersion: 1,
  title: "Section",
  category: "Layout",
  description: "Block spacing wrapper between sections.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Section" },
  defaults: { tone: "bg" },
  fields: [{ kind: "select", prop: "tone", label: "Tone", options: ["bg", "surface"] }],
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});
