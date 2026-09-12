import LinkedTemplate from "./composition-site-frame";

import { Grid, Hero, Newsletter, ProductGrid, Section, SectionHeading } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <Hero src="/uploaded-assets/asset-assets-b8badec4-c972-48f8-9944-b44d671723cc" alt="A dark workbench at night with a small lit brass lamp, a closed notebook and a pen" eyebrow="Nightjar Supply" heading="Objects for *quiet* work" lead="Twelve desk tools, carry goods and small lights, chosen for the hours after everyone else has gone home." primaryLabel="Shop all" primaryHref="/products" secondaryLabel="About" secondaryHref="/about" variant="display" />
      <Section tone="bg">
        <SectionHeading eyebrow="Featured" heading="New this season" intro="" as="h2" />
        <ProductGrid toolbar={false} chips={false} pageSize={4} defaultSort="featured" emptyText="Nothing new this week." />
      </Section>
      <Section tone="bg">
        <SectionHeading eyebrow="Browse" heading="Three shelves" intro="Four objects on each: for the desk, for the walk, and for the light after dark." as="h2" />
        <Grid columns="3" gap="lg" />
      </Section>
      <Section tone="surface">
        <Newsletter heading="Letters from the shelf" lead="One short note when something new arrives. Nothing else, and never shared." buttonLabel="Subscribe" />
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
