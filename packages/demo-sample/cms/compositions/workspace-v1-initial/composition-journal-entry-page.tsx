import LinkedTemplate from "./composition-site-frame";

import { Callout, CtaButton, ProseMd, ProseP, SectionHeading } from "@zudo-sg/ui";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Studio journal" heading="Static journal heading" intro="Static journal introduction" as="h1" />
      <ProseP>{"Static publication date"}</ProseP>
      <ProseMd markdown="Static journal body" />
      <Callout tone="muted" title="More notes">
        <CtaButton href="/journal" variant="secondary" arrow={false}>{"Back to the journal"}</CtaButton>
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
