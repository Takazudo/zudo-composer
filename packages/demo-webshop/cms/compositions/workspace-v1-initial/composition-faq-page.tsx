import LinkedTemplate from "./composition-site-frame";

import { FaqAccordion, SectionHeading } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Help" heading="Questions" intro="Short answers about the shop, the cart and this demo." as="h1" />
      <FaqAccordion allowMultiple={false} />
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
