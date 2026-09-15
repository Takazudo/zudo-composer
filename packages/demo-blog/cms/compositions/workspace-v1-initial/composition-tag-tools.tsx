import LinkedTemplate from "./composition-site-frame";

import { ArticleList, PageHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="Tag" heading="Tools" intro="Choosing, maintaining and repairing the things we work with." />
      <ArticleList chips={false} columns="2" mode="all" />
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
