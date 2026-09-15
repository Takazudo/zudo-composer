import LinkedTemplate from "./composition-site-frame";

import { ContactForm, Image, Prose, Section, SectionHeading, Split } from "demo-webshop/components";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Nightjar Supply" heading="" intro="" as="h1" />
      <Split ratio="1/1" left={<Image src="/uploaded-assets/asset-assets-b8badec4-c972-48f8-9944-b44d671723cc" alt="A dark workbench at night with a small lit brass lamp, a closed notebook and a pen" aspect="4/3" caption="The bench where the shop began." />} right={<Prose />} />
      <Section tone="bg">
        <ContactForm heading="Write to us" successText="Thanks — in a real shop we would reply within two days." />
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
