import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface CategoryBodyProps {
  children?: ComponentChildren;
}

export function CategoryBody({ children }: CategoryBodyProps) {
  return <div class="flex flex-col gap-shop-vsp-lg py-shop-vsp-lg">{children}</div>;
}

export const categoryBodyComponent = defineComponent<CategoryBodyProps>()(CategoryBody, {
  id: "shop.category-body",
  schemaVersion: 1,
  title: "Category body",
  category: "Layout",
  description: "Main region of a category page — the slot rule is the point of this component.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CategoryBody" },
  defaults: {},
  fields: [],
  slots: [
    {
      id: "content",
      prop: "children",
      label: "Content",
      cardinality: "many",
      min: 1,
      accepts: ["shop.hero", "shop.section-heading", "shop.product-grid", "shop.demo-note"],
    },
  ],
});
