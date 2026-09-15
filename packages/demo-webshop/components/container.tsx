import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface ContainerProps {
  width: "page" | "prose";
  children?: ComponentChildren;
}

const WIDTH = { page: "max-w-shop-page", prose: "max-w-shop-prose" } as const;

export function Container({ width = "page", children }: ContainerProps) {
  return <div class={`mx-auto w-full ${WIDTH[width] ?? WIDTH.page} px-shop-hsp-md shop-md:px-shop-hsp-lg shop-xl:px-shop-hsp-2xl`}>{children}</div>;
}

export const containerComponent = defineComponent<ContainerProps>()(Container, {
  id: "shop.container",
  schemaVersion: 1,
  title: "Container",
  category: "Layout",
  description: "Centred max-width wrapper with the responsive page inset.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "Container" },
  defaults: { width: "page" },
  fields: [{ kind: "select", prop: "width", label: "Width", options: ["page", "prose"] }],
  slots: [{ id: "content", prop: "children", label: "Content", cardinality: "many" }],
});
