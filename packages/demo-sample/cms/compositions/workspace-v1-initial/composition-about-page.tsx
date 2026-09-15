import LinkedTemplate from "./composition-site-frame";

import { AutoGrid, Callout, Card, ProseMd, ProseP, SectionHeading } from "@zudo-sg/ui";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Studio note" heading="Static about heading" intro="Static about introduction" as="h1" />
      <ProseMd markdown="Static about body" />
      <AutoGrid min="16rem" gap="sm" fill={false}>
        <Card title="Direction" variant="muted" padding="sm">
          <ProseP>{"We frame the decision before we design anything."}</ProseP>
        </Card>
        <Card title="Design" variant="muted" padding="sm">
          <ProseP>{"We shape interfaces and words together, in visible drafts."}</ProseP>
        </Card>
        <Card title="Delivery" variant="muted" padding="sm">
          <ProseP>{"We build on a fixed rhythm and hand over everything."}</ProseP>
        </Card>
      </AutoGrid>
      <Callout tone="muted" title="Office hours">
        <ProseP>{"We keep Thursday afternoons open for short calls with teams who are not yet sure what they need."}</ProseP>
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
