import LinkedTemplate from "./composition-site-frame";

import { ComparisonNote, CtaBand, FaqAccordion, PricingTable, Section, SectionHeading } from "demo-landing/components";

function LocalCompositionContent() {
  return (
    <>
      <Section
        anchor=""
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Plans" heading="Pricing" intro="Every plan includes the full calendar. You pay for sharing it." as="h1" align="center" />
            <PricingTable defaultBilling="monthly" currency="USD" yearlyNote="Save 20% when billed yearly" />
          </>
        }
      />
      <Section anchor="" band={false} content={<ComparisonNote markdown="All plans include **unlimited events**, two-way sync and export to iCal at any time. Prices are per person per month in US dollars, before tax. Need more than 250 seats? [Talk to us](/about)." />} />
      <Section
        anchor=""
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Billing" heading="Billing questions" intro="" as="h2" align="center" />
            <FaqAccordion allowMultiple={false} />
          </>
        }
      />
      <CtaBand heading="Plan next week in ten minutes" lead="Free for one person, forever. No card needed." buttonLabel="Start free" buttonHref="/#signup" />
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
