import LinkedTemplate from "./composition-site-frame";

import { Hero, ProductGrid } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <Hero src="/uploaded-assets/asset-assets-7e6a524b-3b9a-4f89-a763-6949cd5c84bc" alt="Small lit brass oil lamp with a glass chimney" eyebrow="Shelf" heading="Light" lead="Low, warm light for late work. A lamp for the desk, a torch for the pocket, candles for the evening after." primaryLabel="" primaryHref="#" secondaryLabel="" secondaryHref="#" variant="compact" />
      <ProductGrid toolbar={true} chips={false} pageSize={8} defaultSort="featured" emptyText="Nothing on the light shelf matches." />
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
