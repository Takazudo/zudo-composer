import LinkedTemplate from "./composition-site-frame";

import { Hero, ProductGrid } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <Hero src="/uploaded-assets/asset-assets-449340b8-78fd-4646-97e1-20cbb6949a87" alt="Charcoal linen A5 notebook with a black elastic band" eyebrow="Shelf" heading="Desk" lead="Paper, brass and stone for the surface you work on. Tools that stay where you put them and get better with handling." primaryLabel="" primaryHref="#" secondaryLabel="" secondaryHref="#" variant="compact" />
      <ProductGrid toolbar={true} chips={false} pageSize={8} defaultSort="featured" emptyText="Nothing on the desk shelf matches." />
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
