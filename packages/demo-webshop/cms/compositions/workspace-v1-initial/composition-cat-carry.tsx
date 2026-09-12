import LinkedTemplate from "./composition-site-frame";

import { Hero, ProductGrid } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <Hero src="/uploaded-assets/asset-assets-27d2cd6e-0874-455b-91a5-784bf79c8d14" alt="Small black waxed-canvas sling pouch" eyebrow="Shelf" heading="Carry" lead="Small goods for the walk between places. Waxed canvas, full-grain leather and nothing that rattles." primaryLabel="" primaryHref="#" secondaryLabel="" secondaryHref="#" variant="compact" />
      <ProductGrid toolbar={true} chips={false} pageSize={8} defaultSort="featured" emptyText="Nothing on the carry shelf matches." />
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
