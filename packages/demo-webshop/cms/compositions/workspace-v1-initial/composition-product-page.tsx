import LinkedTemplate from "./composition-site-frame";

import { AddToCart, Breadcrumbs, GalleryImage, PriceTag, ProductGallery, ProductHero, Prose, RelatedProducts, Section, SectionHeading, SpecTable, StatusBadge } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <Breadcrumbs items={[{"href":"/","label":"Home"},{"href":"/products","label":"All products"}]} />
      <ProductHero
        ratio="1/1"
        media={
          <ProductGallery
            images={
              <>
                <GalleryImage />
                <GalleryImage />
              </>
            }
          />
        }
        copy={
          <>
            <SectionHeading eyebrow="" heading="" intro="" as="h1" />
            <PriceTag size="h2" />
            <StatusBadge />
            <AddToCart maxQuantity={10} />
            <Prose />
          </>
        }
      />
      <Section tone="bg">
        <SectionHeading eyebrow="Specification" heading="Details" intro="" as="h2" />
        <SpecTable />
      </Section>
      <Section tone="bg">
        <SectionHeading eyebrow="Featured" heading="More from the shelf" intro="" as="h2" />
        <RelatedProducts heading="" limit={3} />
      </Section>
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
