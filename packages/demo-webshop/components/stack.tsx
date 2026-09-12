import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface StackProps {
  gap: "xs" | "sm" | "md" | "lg";
  align: "start" | "center" | "stretch";
  children?: ComponentChildren;
}

const GAP = { xs: "gap-shop-vsp-xs", sm: "gap-shop-vsp-sm", md: "gap-shop-vsp-md", lg: "gap-shop-vsp-lg" } as const;
const ALIGN = { start: "items-start", center: "items-center", stretch: "items-stretch" } as const;

export function Stack({ gap = "md", align = "stretch", children }: StackProps) {
  return <div class={`flex flex-col ${GAP[gap] ?? GAP.md} ${ALIGN[align] ?? ALIGN.stretch}`}>{children}</div>;
}

export const stackComponent = defineComponent<StackProps>()(Stack, {
  id: "shop.stack",
  schemaVersion: 1,
  title: "Stack",
  category: "Layout",
  description: "Vertical rhythm on the vsp ladder.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Stack" },
  defaults: { gap: "md", align: "stretch" },
  fields: [
    { kind: "select", prop: "gap", label: "Gap", options: ["xs", "sm", "md", "lg"] },
    { kind: "select", prop: "align", label: "Align", options: ["start", "center", "stretch"] },
  ],
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});
