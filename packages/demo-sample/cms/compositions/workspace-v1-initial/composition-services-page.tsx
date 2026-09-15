import LinkedTemplate from "./composition-site-frame";

import { AutoGrid, Callout, Card, CtaButton, ProseMd, ProseP, SectionHeading, SplitLayout, Stack } from "@zudo-sg/ui";

function LocalCompositionContent() {
  return (
    <>
      <SectionHeading eyebrow="Services" heading="Ways to work together" intro="Three fixed-shape offers, from a two-week framing sprint to a steady delivery rhythm." as="h1" />
      <SplitLayout
        ratio="60/40"
        gap="lg"
        left={<ProseMd markdown={"## What an engagement looks like\n\nEvery engagement starts with a short call and a written note about the decision you are facing. We reply with a proposal that names one outcome, one team and one first cycle.\n\nFrom there we work in weekly loops. Each week ends with something you can open, read or click, and a short list of open questions. You decide what moves forward.\n\nWe keep all drafts, notes and decisions in one shared place. When the engagement ends, your team keeps everything, and nobody needs us to find their way around it."} />}
        right={
          <Stack direction="vertical" gap="md" align="start" justify="start">
            <ProseP>{"Four people: a strategist, a designer, a writer and a developer."}</ProseP>
            <ProseP>{"Most engagements last between two and twelve weeks."}</ProseP>
            <ProseP>{"We bill a fixed fee per cycle, agreed before each cycle starts."}</ProseP>
          </Stack>
        }
      />
      <AutoGrid min="16rem" gap="split" fill={true}>
        <Card title="Direction" variant="accent" padding="lg">
          <ProseP>{"A two-week framing sprint that ends in a written brief your team can act on."}</ProseP>
          <ProseP>{"Starts from two weeks, one fixed fee."}</ProseP>
          <CtaButton href="/about" variant="secondary" arrow={true}>{"Ask about Direction"}</CtaButton>
        </Card>
        <Card title="Design" variant="default" padding="md">
          <ProseP>{"Interface and content design in weekly visible cycles, reviewed with the people who will use it."}</ProseP>
          <ProseP>{"Starts from four weekly cycles."}</ProseP>
          <CtaButton href="/about" variant="secondary" arrow={true}>{"Ask about Design"}</CtaButton>
        </Card>
        <Card title="Delivery" variant="muted" padding="md">
          <ProseP>{"Build, handoff and review points on a fixed rhythm, so your team can maintain the result."}</ProseP>
          <ProseP>{"Starts from six weekly cycles."}</ProseP>
          <CtaButton href="/about" variant="secondary" arrow={true}>{"Ask about Delivery"}</CtaButton>
        </Card>
      </AutoGrid>
      <Callout tone="note" title="A flexible starting point">
        <ProseP>{"Not sure which offer fits? Start with a single Direction sprint. It stands on its own, and nothing after it is assumed."}</ProseP>
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
