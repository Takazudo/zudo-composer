import { defineComponent } from "@zudo-composer/component-contract";
import { useCart } from "./cart-store";
import { PriceTag } from "./price-tag";
import { Stepper } from "./stepper";
import { SECONDARY_CTA } from "./tone";

export interface CartPageProps {
  emptyText: string;
  emptyHref: string;
}

const MAX_LINE_QTY = 99;

export function CartPage({ emptyText = "Your cart is empty.", emptyHref = "/products" }: CartPageProps) {
  const { lines, setQuantity, remove } = useCart();

  if (lines.length === 0) {
    return (
      <div class="flex flex-col items-start gap-shop-vsp-md border-y border-shop-border py-shop-vsp-lg">
        <p class="text-shop-lead text-shop-fg">{emptyText}</p>
        <a href={emptyHref} class={SECONDARY_CTA}>Browse all products</a>
      </div>
    );
  }

  return (
    <ul aria-label="Cart items" class="flex flex-col border-t border-shop-border">
      {lines.map((line) => (
        <li key={line.slug} class="grid grid-cols-[5rem_1fr] gap-x-shop-hsp-md gap-y-shop-vsp-sm border-b border-shop-border py-shop-vsp-md shop-md:grid-cols-[6rem_1fr_auto_auto] shop-md:items-center">
          <div class="aspect-square w-full bg-shop-surface shop-md:row-span-1 row-span-2">
            {line.src !== "" && <img src={line.src} alt="" loading="lazy" class="block h-full w-full object-cover" />}
          </div>
          <div class="flex flex-col gap-shop-vsp-xs">
            <a href={`/products/${line.slug}`} class="text-shop-h3 font-shop-semibold text-shop-fg-strong hover:bg-shop-inverse-bg hover:text-shop-inverse-fg">{line.name}</a>
            <PriceTag price={line.price} currency={line.currency} size="body" />
          </div>
          <div class="col-start-2 flex items-center gap-shop-hsp-md shop-md:col-start-auto">
            <Stepper value={line.qty} min={0} max={MAX_LINE_QTY} label={`Quantity of ${line.name}`} onChange={(qty) => setQuantity(line.slug, qty)} />
            <button type="button" onClick={() => remove(line.slug)} aria-label={`Remove ${line.name}`} class="text-shop-caption text-shop-muted underline decoration-shop-border underline-offset-4 hover:text-shop-danger">
              Remove
            </button>
          </div>
          <p class="col-start-2 shop-md:col-start-auto shop-md:text-right" aria-label={`Line total for ${line.name}`}>
            <PriceTag price={Math.round(line.price * line.qty * 100) / 100} currency={line.currency} size="body" />
          </p>
        </li>
      ))}
    </ul>
  );
}

export const cartPageComponent = defineComponent<CartPageProps>()(CartPage, {
  id: "shop.cart-page",
  schemaVersion: 1,
  title: "Cart lines",
  category: "Cart",
  description: "Line items from the cart store with quantity, remove and line totals; an empty state links back to the catalog.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CartPage" },
  defaults: { emptyText: "Your cart is empty.", emptyHref: "/products" },
  fields: [
    { kind: "text", prop: "emptyText", label: "Empty text" },
    { kind: "text", prop: "emptyHref", label: "Empty-state link" },
  ],
});
