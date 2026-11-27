import { defineComponent } from "@zudo-composer/component-contract";
import { Show, computed, getScope, signal } from "@takazudo/zfb/zudo-react";
import { cartStore } from "./cart-store";
import { Stepper } from "./stepper";
import type { Availability } from "./status-badge";
import { DISABLED_CTA, PRIMARY_CTA } from "./tone";

export interface AddToCartProps {
  slug: string;
  name: string;
  price: number;
  currency: string;
  src: string;
  availability: Availability;
  maxQuantity: number;
}

export const ADDED_MS = 2000;

export function AddToCart({ slug = "", name = "Product", price = 0, currency = "USD", src = "", availability = "in-stock", maxQuantity = 10 }: AddToCartProps) {
  const qty = signal(1);
  const added = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  getScope().onCleanup(() => clearTimeout(timer));
  const soldOut = availability === "sold-out";
  const max = Math.max(1, Math.floor(maxQuantity) || 1);
  const shownQty = computed(() => Math.min(qty.value, max));

  const add = () => {
    if (soldOut) return;
    cartStore.add({ slug: slug || name, name, price, currency, src }, qty.value);
    added.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      added.value = false;
    }, ADDED_MS);
  };

  return (
    <div class="flex flex-col gap-shop-vsp-sm">
      <div class="flex flex-wrap items-center gap-shop-hsp-sm">
        {!soldOut && <Stepper value={shownQty} min={1} max={max} label="Quantity" onChange={(next) => (qty.value = next)} />}
        <button type="button" disabled={soldOut} on:click={add} class={soldOut ? DISABLED_CTA : `${PRIMARY_CTA} justify-center`}>
          {soldOut ? "Sold out" : "Add to cart"}
        </button>
      </div>
      <p role="status" class="min-h-[1.5em] text-shop-body text-shop-success">
        <Show when={added}>
          {() => (
            <>
              Added — <a href="/cart" class="underline decoration-shop-border underline-offset-4 hover:bg-shop-inverse-bg hover:text-shop-inverse-fg">view cart</a>
            </>
          )}
        </Show>
      </p>
    </div>
  );
}

export const addToCartComponent = defineComponent<AddToCartProps>()(AddToCart, {
  id: "shop.add-to-cart",
  schemaVersion: 1,
  title: "Add to cart",
  category: "Product",
  description: "Quantity stepper and primary button that write to the cart; disabled when sold out.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "AddToCart" },
  defaults: { slug: "", name: "Product", price: 0, currency: "USD", src: "", availability: "in-stock", maxQuantity: 10 },
  fields: [
    { kind: "text", prop: "slug", label: "Slug" },
    { kind: "text", prop: "name", label: "Name" },
    { kind: "number", prop: "price", label: "Price", min: 0, step: 0.01 },
    { kind: "text", prop: "currency", label: "Currency" },
    { kind: "text", prop: "src", label: "Image" },
    { kind: "select", prop: "availability", label: "Availability", options: ["in-stock", "low-stock", "sold-out"] },
    { kind: "number", prop: "maxQuantity", label: "Max quantity", min: 1, max: 99, step: 1 },
  ],
});
