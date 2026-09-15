import LinkedTemplate from "./composition-site-frame";

import { ArticleList, AuthorCard, Section, SectionHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <AuthorCard variant="hero" />
      <Section
        rule={true}
        content={
          <>
            <SectionHeading eyebrow="" heading="Essays" as="h2" />
            <ArticleList chips={false} columns="2" mode="by-route-author" />
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
