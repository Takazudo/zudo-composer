import LinkedTemplate from "./composition-site-frame";

import { AutoGrid, Callout, Card, CtaButton, ProseP, SectionHeading } from "@zudo-sg/ui";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Journal" heading="Working notes" intro="Short essays on how we frame, map and review work, each drawn from a real kind of project." as="h1" />
      <AutoGrid min="18rem" gap="md" fill={false}>
        <Card title="Start with the question" variant="default" padding="md">
          <ProseP>{"Published on 5 August 2026. Before choosing a format or feature, name the question the work must answer."}</ProseP>
          <CtaButton href="/journal/start-with-the-question" variant="secondary" arrow={true}>{"Read Start with the question"}</CtaButton>
        </Card>
        <Card title="Map the moving parts" variant="accent" padding="md">
          <ProseP>{"Published on 12 August 2026. A lightweight map can reveal where timing, ownership, and information need attention."}</ProseP>
          <CtaButton href="/journal/map-the-moving-parts" variant="secondary" arrow={true}>{"Read Map the moving parts"}</CtaButton>
        </Card>
        <Card title="Review in small loops" variant="muted" padding="md">
          <ProseP>{"Published on 19 August 2026. Small reviews turn abstract agreement into specific, timely feedback."}</ProseP>
          <CtaButton href="/journal/review-in-small-loops" variant="secondary" arrow={true}>{"Read Review in small loops"}</CtaButton>
        </Card>
      </AutoGrid>
      <Callout tone="muted" title="Get the notes">
        <ProseP>{"We publish one note every few weeks and share it with clients in our monthly project letter."}</ProseP>
      </Callout>
    </>
  );
}

export default function Composition() {
  return (
    <LinkedTemplate
      outlets={{
        "main-content": <LocalCompositionContent />,
      }}
    />
  );
}
