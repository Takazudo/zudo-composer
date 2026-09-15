import { defineComponent } from "@zudo-composer/component-contract";
import { useCart } from "./cart-store";
import { PriceTag } from "./price-tag";
import { PRIMARY_CTA } from "./tone";

export interface CartSummaryProps {
  shipping: number;
  currency: string;
  checkoutHref: string;
  readOnly: boolean;
}

export function cartTotals(subtotal: number, count: number, shipping: number) {
  const shippingCost = count > 0 ? Math.max(0, shipping) : 0;
  return { subtotal, shipping: shippingCost, total: Math.round((subtotal + shippingCost) * 100) / 100 };
}

export function CartSummary({ shipping = 8, currency = "USD", checkoutHref = "/checkout", readOnly = false }: CartSummaryProps) {
  const { count, subtotal } = useCart();
  const totals = cartTotals(subtotal, count, shipping);
  const row = "flex items-baseline justify-between gap-shop-hsp-md";
  return (
    <section aria-label="Order summary" class="flex flex-col gap-shop-vsp-md bg-shop-surface p-shop-hsp-md">
      <h2 class="text-shop-h3 font-shop-semibold text-shop-fg-strong">
        Summary <span class="text-shop-body font-shop-normal text-shop-muted">({count} {count === 1 ? "item" : "items"})</span>
      </h2>
      <dl class="flex flex-col gap-shop-vsp-xs text-shop-body text-shop-fg">
        <div class={row}>
          <dt>Subtotal</dt>
          <dd data-total="subtotal"><PriceTag price={totals.subtotal} currency={currency} size="body" /></dd>
        </div>
        <div class={row}>
          <dt>Shipping</dt>
          <dd data-total="shipping"><PriceTag price={totals.shipping} currency={currency} size="body" /></dd>
        </div>
        <div class={`${row} border-t border-shop-border pt-shop-vsp-sm`}>
          <dt class="text-shop-h2 font-shop-semibold text-shop-fg-strong">Total</dt>
          <dd data-total="total"><PriceTag price={totals.total} currency={currency} size="h2" /></dd>
        </div>
      </dl>
      {!readOnly && count > 0 && <a href={checkoutHref} class={`${PRIMARY_CTA} justify-center`}>Checkout</a>}
    </section>
  );
}

export const cartSummaryComponent = defineComponent<CartSummaryProps>()(CartSummary, {
  id: "shop.cart-summary",
  schemaVersion: 1,
  title: "Cart summary",
  category: "Cart",
  description: "Subtotal, flat shipping and total from the cart store, with an optional checkout button.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CartSummary" },
  defaults: { shipping: 8, currency: "USD", checkoutHref: "/checkout", readOnly: false },
  fields: [
    { kind: "number", prop: "shipping", label: "Flat shipping", min: 0, step: 0.01 },
    { kind: "text", prop: "currency", label: "Currency" },
    { kind: "text", prop: "checkoutHref", label: "Checkout URL" },
    { kind: "boolean", prop: "readOnly", label: "Read only" },
  ],
});
