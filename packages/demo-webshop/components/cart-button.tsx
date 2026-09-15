import { defineComponent } from "@zudo-composer/component-contract";
import { useCart } from "./cart-store";
import { HOVER_INVERT } from "./tone";

export interface CartButtonProps {
  label: string;
  href: string;
}

export function CartButton({ label = "Cart", href = "/cart" }: CartButtonProps) {
  const { count } = useCart();
  return (
    <a
      href={href}
      aria-label={count > 0 ? `${label}, ${count} ${count === 1 ? "item" : "items"}` : label}
      class={`inline-flex items-center gap-shop-hsp-xs h-shop-control-h px-shop-hsp-xs text-shop-body text-shop-fg-strong ${HOVER_INVERT}`}
    >
      {label}
      {count > 0 && (
        // The one filled-accent element per viewport (§ 2.1) and the only radius (§ 2.4).
        <span class="inline-flex items-center justify-center min-w-[1.25rem] h-[1.25rem] px-[0.3rem] rounded-shop-dot bg-shop-accent text-shop-accent-fg text-shop-caption font-shop-mono tabular-nums">
          {count}
        </span>
      )}
    </a>
  );
}

export const cartButtonComponent = defineComponent<CartButtonProps>()(CartButton, {
  id: "shop.cart-button",
  schemaVersion: 1,
  title: "Cart button",
  category: "Chrome",
  description: "Header link to the cart with the live item count.",
  source: { module: "demo-webshop/components", exportKind: "named", exportName: "CartButton" },
  defaults: { label: "Cart", href: "/cart" },
  fields: [
    { kind: "text", prop: "label", label: "Label" },
    { kind: "text", prop: "href", label: "URL" },
  ],
});
