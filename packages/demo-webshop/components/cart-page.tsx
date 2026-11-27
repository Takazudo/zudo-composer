import { defineComponent } from "@zudo-composer/component-contract";
import { For, Show, computed } from "@takazudo/zfb/zudo-react";
import { cartSignal, cartStore } from "./cart-store";
import { LivePrice, PriceTag } from "./price-tag";
import { Stepper } from "./stepper";
import { SECONDARY_CTA } from "./tone";

export interface CartPageProps {
  emptyText: string;
  emptyHref: string;
}

const MAX_LINE_QTY = 99;

export function CartPage({ emptyText = "Your cart is empty.", emptyHref = "/products" }: CartPageProps) {
  const cart = cartSignal();
  const lines = computed(() => cart.value.lines);

  return (
    <Show
      when={computed(() => lines.value.length > 0)}
      fallback={() => (
        <div class="flex flex-col items-start gap-shop-vsp-md border-y border-shop-border py-shop-vsp-lg">
          <p class="text-shop-lead text-shop-fg">{emptyText}</p>
          <a href={emptyHref} class={SECONDARY_CTA}>Browse all products</a>
        </div>
      )}
    >
      {() => (
        <ul aria-label="Cart items" class="flex flex-col border-t border-shop-border">
          <For each={lines} by={(line) => line.slug}>
            {(line) => {
              const { slug, name, src, price, currency } = line.value;
              const qty = computed(() => line.value.qty);
              return (
                <li class="grid grid-cols-[5rem_1fr] gap-x-shop-hsp-md gap-y-shop-vsp-sm border-b border-shop-border py-shop-vsp-md shop-md:grid-cols-[6rem_1fr_auto_auto] shop-md:items-center">
                  <div class="aspect-square w-full bg-shop-surface shop-md:row-span-1 row-span-2">
                    {src !== "" && <img src={src} alt="" loading="lazy" class="block h-full w-full object-cover" />}
                  </div>
                  <div class="flex flex-col gap-shop-vsp-xs">
                    <a href={`/products/${slug}`} class="text-shop-h3 font-shop-semibold text-shop-fg-strong hover:bg-shop-inverse-bg hover:text-shop-inverse-fg">{name}</a>
                    <PriceTag price={price} currency={currency} size="body" />
                  </div>
                  <div class="col-start-2 flex items-center gap-shop-hsp-md shop-md:col-start-auto">
                    <Stepper value={qty} min={0} max={MAX_LINE_QTY} label={`Quantity of ${name}`} onChange={(next) => cartStore.setQuantity(slug, next)} />
                    <button type="button" on:click={() => cartStore.remove(slug)} aria-label={`Remove ${name}`} class="text-shop-caption text-shop-muted underline decoration-shop-border underline-offset-4 hover:text-shop-danger">
                      Remove
                    </button>
                  </div>
                  <p class="col-start-2 shop-md:col-start-auto shop-md:text-right" aria-label={`Line total for ${name}`}>
                    <LivePrice price={computed(() => Math.round(price * qty.value * 100) / 100)} currency={currency} size="body" />
                  </p>
                </li>
              );
            }}
          </For>
        </ul>
      )}
    </Show>
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
