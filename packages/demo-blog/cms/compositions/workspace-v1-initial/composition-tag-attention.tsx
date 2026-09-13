import LinkedTemplate from "./composition-site-frame";

import { ArticleList, PageHeading } from "demo-blog/components";

function LocalCompositionContent() {
  return (
    <>
      <PageHeading eyebrow="Tag" heading="Attention" intro="Where attention goes, and the small daily habits that protect it." />
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
