import LinkedTemplate from "./composition-site-frame";

import { CartSummary, CheckoutForm, DemoNote, SectionHeading, Split } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="" heading="Checkout" intro="" as="h1" />
      <Split ratio="3/2" left={<CheckoutForm heading="Shipping and payment" successHeading="Order placed" successText="Thank you. Nothing was charged and nothing will ship — this is a demo." />} right={<CartSummary shipping={8} currency="USD" checkoutHref="/checkout" readOnly={true} />} />
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
