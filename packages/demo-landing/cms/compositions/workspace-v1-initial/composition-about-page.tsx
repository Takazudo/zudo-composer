import LinkedTemplate from "./composition-site-frame";

import { ContactForm, DemoNote, Image, Prose, Section, SectionHeading, Split } from "demo-landing/components";

function LocalCompositionContent() {
  return (
    <>
      <Section
        anchor=""
        band={false}
        content={
          <>
            <SectionHeading eyebrow="About" heading="About Orrery" intro="" as="h1" align="start" />
            <Split ratio="1/1" reverse={false} media={<Image src="/uploaded-assets/asset-assets-55d857f5-fce8-4c86-827e-1de0a811a209" alt="Four abstract figures around a table beneath a large wall calendar" aspect="4/3" />} copy={<Prose markdown="" />} />
          </>
        }
      />
      <Section
        anchor="contact"
        band={false}
        content={
          <>
            <SectionHeading eyebrow="Contact" heading="Contact" intro="Questions about Org, a partnership or a bug? We answer within one working day." as="h2" align="center" />
            <ContactForm heading="Write to us" successText="Thanks — in this demo, your message was not sent anywhere." />
            <DemoNote text="Demo — no data is sent." />
          </>
        }
      />
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
