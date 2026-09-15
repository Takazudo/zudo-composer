import LinkedTemplate from "./composition-site-frame";

import { ArticleList, DemoNote, HomeHero, Newsletter, Section, SectionHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <HomeHero heading="Notes from the margin" lead="Short essays on craft, focus and the tools that hold up — written slowly, by two people who would rather do one thing well." linkLabel="About the journal" linkHref="/about" />
      <Section
        rule={true}
        content={
          <>
            <SectionHeading eyebrow="Latest" heading="Recent essays" as="h2" />
            <ArticleList chips={false} columns="2" mode="all" />
          </>
        }
      />
      <Section rule={true} content={<Newsletter heading="The Sunday note" lead="One short letter a week with the newest essay and one thing worth reading slowly. Nothing else." buttonLabel="Subscribe" successText="Subscribed locally — this demo keeps nothing." />} />
      <DemoNote text="Demo — no data is sent." />
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
