import { defineComponent } from "@zudo-composer/component-contract";
import { CAPS } from "./tone";

export interface SectionHeadingProps {
  eyebrow: string;
  heading: string;
  intro: string;
  as: "h1" | "h2";
}

export function SectionHeading({ eyebrow = "", heading = "Section", intro = "", as = "h2" }: SectionHeadingProps) {
  const Heading = as === "h1" ? "h1" : "h2";
  return (
    <div class="flex flex-col gap-shop-vsp-sm pt-shop-vsp-md">
      {eyebrow !== "" && <p class={`${CAPS} text-shop-muted`}>{eyebrow}</p>}
      <Heading class={`${as === "h1" ? "text-shop-h1" : "text-shop-h2"} font-shop-semibold text-shop-fg-strong`}>{heading}</Heading>
      {intro !== "" && <p class="max-w-shop-prose whitespace-pre-line text-shop-lead text-shop-fg">{intro}</p>}
    </div>
  );
}

export const sectionHeadingComponent = defineComponent<SectionHeadingProps>()(SectionHeading, {
  id: "shop.section-heading",
  schemaVersion: 1,
  title: "Section heading",
  category: "Layout",
  description: "Eyebrow, heading and optional intro; `as` sets the heading level.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "SectionHeading" },
  defaults: { eyebrow: "", heading: "Section", intro: "", as: "h2" },
  fields: [
    { kind: "text", prop: "eyebrow", label: "Eyebrow" },
    { kind: "text", prop: "heading", label: "Heading", inlineEdit: { multiline: false } },
    { prop: "intro", label: "Intro", schema: { type: "string" }, editor: { kind: "text", multiline: true } },
    { kind: "select", prop: "as", label: "Level", options: ["h1", "h2"] },
  ],
  adapters: {
    inlineEditor: { field: "heading", resolveElement: (root: HTMLElement) => root.querySelector<HTMLHeadingElement>("h1, h2") },
  },
});
