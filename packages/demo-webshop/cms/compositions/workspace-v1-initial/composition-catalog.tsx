import LinkedTemplate from "./composition-site-frame";

import { ProductGrid, SectionHeading } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Nightjar Supply" heading="All products" intro="Twelve objects for quiet work. Filter by shelf, sort by price or search by name." as="h1" />
      <ProductGrid toolbar={true} chips={true} pageSize={8} defaultSort="featured" emptyText="No products match. Try another shelf or a shorter search." />
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
