import LinkedTemplate from "./composition-site-frame";

import { ArticleHeader, AuthorCard, Avatar, CommentForm, CommentList, Container, DemoNote, ProseBody, RelatedArticles, Section, SectionHeading, TagList } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <ArticleHeader avatar={<Avatar />} />
      <ProseBody dropCap={true} />
      <TagList basePath="/" />
      <AuthorCard variant="inline" />
      <Section
        rule={true}
        content={
          <>
            <SectionHeading eyebrow="" heading="Keep reading" as="h2" />
            <RelatedArticles heading="" limit={3} />
          </>
        }
      />
      <Section
        rule={true}
        content={
          <Container
            width="measure"
            content={
              <>
                <SectionHeading eyebrow="" heading="Comments" as="h2" />
                <CommentList emptyText="No comments yet. Be the first." />
                <CommentForm heading="Leave a comment" buttonLabel="Post comment" successText="Posted locally — this demo keeps nothing." />
                <DemoNote text="Demo — no data is sent." />
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
