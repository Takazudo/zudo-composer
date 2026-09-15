import LinkedTemplate from "./composition-site-frame";

import { Container, Prose, Section, SectionHeading } from "demo-landing/components";

function LocalCompositionContent() {
  return (
    <>
      <Section
        anchor=""
        band={false}
        content={
          <Container
            width="narrow"
            content={
              <>
                <SectionHeading eyebrow="Legal" heading="Terms" intro="Last updated 1 September 2026." as="h1" align="start" />
                <Prose markdown={"These terms describe a fictional service on a demo site. They are sample copy, not an offer or a contract.\n\n## Your account\n\nYou are responsible for the calendars you connect and for the people you invite. Keep your password to yourself; Org workspaces can require single sign-on instead.\n\n## Plans and billing\n\n- Solo is free. Studio and Org are billed per person, monthly or yearly.\n- Yearly plans are paid up front and cost about 20% less per month.\n- You can cancel at any time. Your plan runs to the end of the paid period.\n\n## Your data\n\nYour events stay yours. You can export everything at any time, and we delete it when you close the workspace.\n\n## Changes\n\nIf these terms change, we tell workspace owners by email 30 days before the change applies."} />
              </>
            }
          />
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
