import LinkedTemplate from "./composition-site-frame";

import { CartPage, CartSummary, DemoNote, SectionHeading } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="" heading="Your cart" intro="" as="h1" />
      <CartPage emptyText="Your cart is empty. The shelves are not." emptyHref="/products" />
      <CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly={false} />
      <DemoNote text="Demo — no data is sent." />
    </>
  );
}

export default function Composition() {
  return (
    <LinkedTemplate
      outlets={{
        "site-frame-outlet": <LocalCompositionContent />,
      }}
    />
  );
}
