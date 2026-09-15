import { defineComponent } from "@zudo-composer/component-contract";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { GridRegistryContext, GridViewContext, useGridRegistry } from "./grid-context";
import { computeRelatedView } from "./grid-view";

export interface RelatedProductsProps {
  heading: string;
  limit: number;
  items?: ComponentChildren;
}

export function currentRouteSlug(pathname: string): string {
  return pathname.split("/").filter((segment) => segment !== "").at(-1) ?? "";
}

export function RelatedProducts({ heading = "", limit = 3, items }: RelatedProductsProps) {
  const { registry, ordered } = useGridRegistry();
  const [currentSlug, setCurrentSlug] = useState("");
  useEffect(() => setCurrentSlug(currentRouteSlug(location.pathname)), []);
  const views = computeRelatedView(ordered, currentSlug, Math.max(0, Math.floor(limit)));

  return (
    <GridRegistryContext.Provider value={registry}>
      <GridViewContext.Provider value={views}>
        <div class="flex flex-col gap-shop-vsp-md">
          {heading !== "" && <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>}
          <div class="grid grid-cols-1 gap-x-shop-hsp-md gap-y-shop-vsp-lg shop-sm:grid-cols-2 shop-lg:grid-cols-3 shop-lg:gap-x-shop-hsp-lg shop-xl:grid-cols-4">{items}</div>
        </div>
      </GridViewContext.Provider>
    </GridRegistryContext.Provider>
  );
}

export const relatedProductsComponent = defineComponent<RelatedProductsProps>()(RelatedProducts, {
  id: "shop.related-products",
  schemaVersion: 1,
  title: "Related products",
  category: "Product",
  description: "Strip of product cards without a toolbar; hides the card for the current product and shows at most `limit`.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "RelatedProducts" },
  defaults: { heading: "", limit: 3 },
  fields: [
    { kind: "text", prop: "heading", label: "Heading" },
    { kind: "number", prop: "limit", label: "Limit", min: 1, max: 8, step: 1 },
  ],
  slots: [{ id: "items", prop: "items", label: "Products", cardinality: "many", accepts: ["shop.product-card"] }],
});
