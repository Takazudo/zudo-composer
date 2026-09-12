import { defineComponent } from "@zudo-composer/component-contract";

export interface PriceTagProps {
  price: number;
  currency: string;
  size: "body" | "h2";
}

export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}

export function PriceTag({ price = 0, currency = "USD", size = "body" }: PriceTagProps) {
  return (
    <span class={`font-shop-mono tabular-nums text-shop-price ${size === "h2" ? "text-shop-h2" : "text-shop-body"}`}>
      {formatPrice(price, currency)}
    </span>
  );
}

export const priceTagComponent = defineComponent<PriceTagProps>()(PriceTag, {
  id: "shop.price-tag",
  schemaVersion: 1,
  title: "Price tag",
  category: "Catalog",
  description: "Currency-formatted price in mono with tabular numerals.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "PriceTag" },
  defaults: { price: 0, currency: "USD", size: "body" },
  fields: [
    { kind: "number", prop: "price", label: "Price", min: 0, step: 0.01 },
    { kind: "text", prop: "currency", label: "Currency" },
    { kind: "select", prop: "size", label: "Size", options: ["body", "h2"] },
  ],
});
