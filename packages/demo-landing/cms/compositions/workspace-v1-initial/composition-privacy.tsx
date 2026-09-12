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
                <SectionHeading eyebrow="Legal" heading="Privacy" intro="Last updated 1 September 2026." as="h1" align="start" />
                <Prose markdown={"Orrery is a fictional product, and this is a demo site. Nothing you type on it leaves your browser: the signup and contact forms only pretend to send.\n\n## What a real Orrery would collect\n\n- Your name and work email, to create your account.\n- Calendar events you connect, to show them in your week. We read titles and times; attachments stay where they are.\n- Billing details, handled by our payment processor. We never see full card numbers.\n\n## What we would never do\n\n- Sell your data or show you advertising.\n- Read the content of events you mark private.\n- Keep your data after you delete your workspace. Deletion finishes within 30 days.\n\n## Contact\n\nQuestions about privacy go to the [contact form](/about), which, on this demo, sends nothing."} />
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
