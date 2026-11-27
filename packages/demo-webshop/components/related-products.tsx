import { defineComponent } from "@zudo-composer/component-contract";
import { computed, getScope, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { GRID_ITEM_LINK } from "./grid-link";
import { computeRelatedView, type GridItemData, type GridItemView } from "./grid-view";
import { createItemRegistry } from "./item-registry";
import { answerLink } from "./slot-link";

export interface RelatedProductsProps {
  heading: string;
  limit: number;
  items?: Child | object;
}

export function currentRouteSlug(pathname: string): string {
  return pathname.split("/").filter((segment) => segment !== "").at(-1) ?? "";
}

export function RelatedProducts({ heading = "", limit = 3, items }: RelatedProductsProps) {
  const currentSlug = signal("");
  const { ordered, host } = createItemRegistry<GridItemData, GridItemView>(() => views.value);
  const views: ReadonlySignal<ReadonlyMap<string, GridItemView>> = computed(() => computeRelatedView(ordered.value, currentSlug.value, Math.max(0, Math.floor(limit))));
  getScope().onActivate(() => {
    currentSlug.value = currentRouteSlug(location.pathname);
  });

  return (
    <div class="flex flex-col gap-shop-vsp-md" on:shop-grid-item={answerLink(GRID_ITEM_LINK, host)}>
      {heading !== "" && <h2 class="text-shop-h2 font-shop-semibold text-shop-fg-strong">{heading}</h2>}
      <div class="grid grid-cols-1 gap-x-shop-hsp-md gap-y-shop-vsp-lg shop-sm:grid-cols-2 shop-lg:grid-cols-3 shop-lg:gap-x-shop-hsp-lg shop-xl:grid-cols-4">{items as Child}</div>
    </div>
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
