import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";

export interface ProductHeroProps {
  ratio: "1/1" | "3/2";
  media?: ComponentChildren;
  copy?: ComponentChildren;
}

const RATIO = { "1/1": "shop-lg:grid-cols-[1fr_1fr]", "3/2": "shop-lg:grid-cols-[3fr_2fr]" } as const;

export function ProductHero({ ratio = "1/1", media, copy }: ProductHeroProps) {
  return (
    <section class={`grid grid-cols-1 gap-shop-vsp-lg ${RATIO[ratio] ?? RATIO["1/1"]} shop-lg:gap-shop-hsp-xl`}>
      <div>{media}</div>
      <div class="flex flex-col gap-shop-vsp-md">{copy}</div>
    </section>
  );
}

export const productHeroComponent = defineComponent<ProductHeroProps>()(ProductHero, {
  id: "shop.product-hero",
  schemaVersion: 1,
  title: "Product hero",
  category: "Product",
  description: "Product page split: gallery on the left from lg, copy on the right.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "ProductHero" },
  defaults: { ratio: "1/1" },
  fields: [{ kind: "select", prop: "ratio", label: "Ratio", options: ["1/1", "3/2"] }],
  slots: [
    { id: "media", prop: "media", label: "Gallery", cardinality: "single", accepts: ["shop.product-gallery"] },
    { id: "copy", prop: "copy", label: "Copy", cardinality: "many" },
  ],
});
