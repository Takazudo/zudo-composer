import LinkedTemplate from "./composition-site-frame";

import { AutoGrid, Callout, Card, CtaButton, Hero, PlaceholderBox, ProseP, SectionHeading, SplitLayout, Stack } from "@zudo-sg/ui";

function LocalCompositionContent() {
  return (
    <>
      <Hero eyebrow="Sample Studio" heading="Clear ideas, carefully shaped" lead="We are a four-person studio that helps small teams shape websites, tools and content. We work in short, visible cycles so every decision is easy to follow." variant="primary" actions={[{"href":"/services","label":"See our services","variant":"primary"},{"href":"/journal","label":"Read the journal","variant":"secondary"}]} />
      <SplitLayout
        ratio="40/60"
        gap="lg"
        left={<PlaceholderBox label="Studio worktable" aspect="4/3" size="lg" />}
        right={
          <Stack direction="vertical" gap="sm" align="start" justify="start">
            <ProseP>{"We turn open questions into useful systems. Most of our work is for teams of five to fifty people who need a clear next step."}</ProseP>
            <ProseP>{"Every project runs in weekly cycles with something concrete to review. You see drafts early, and nothing ships without a shared decision."}</ProseP>
            <CtaButton href="/about" variant="secondary" arrow={true}>{"How we work"}</CtaButton>
          </Stack>
        }
      />
      <SectionHeading eyebrow="Recent notes" heading="From the journal" intro="Short essays on the habits that keep our projects calm." as="h2" />
      <AutoGrid min="18rem" gap="md" fill={false}>
        <Card title="Start with the question" variant="accent" padding="md">
          <ProseP>{"Before choosing a format or feature, name the question the work must answer."}</ProseP>
          <CtaButton href="/journal/start-with-the-question" variant="secondary" arrow={true}>{"Read about questions"}</CtaButton>
        </Card>
        <Card title="Map the moving parts" variant="default" padding="md">
          <ProseP>{"A lightweight map can reveal where timing, ownership, and information need attention."}</ProseP>
          <CtaButton href="/journal/map-the-moving-parts" variant="secondary" arrow={true}>{"Read about mapping"}</CtaButton>
        </Card>
        <Card title="Review in small loops" variant="default" padding="md">
          <ProseP>{"Small reviews turn abstract agreement into specific, timely feedback."}</ProseP>
          <CtaButton href="/journal/review-in-small-loops" variant="secondary" arrow={true}>{"Read about reviews"}</CtaButton>
        </Card>
      </AutoGrid>
      <Callout tone="muted" title="Working with us">
        <ProseP>{"Most engagements begin with a one-hour call about the decision you are facing."}</ProseP>
        <CtaButton href="/about" variant="secondary" arrow={false}>{"Start a conversation"}</CtaButton>
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
